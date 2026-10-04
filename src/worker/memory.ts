import { SWITCHES, checkSoftSwitches } from "./softswitches"
import { s6502 } from "./instructions"
import { romBase64 as romBase64p } from "./roms/rom_2+"
import { romBase64 as romBase64e } from "./roms/rom_2e"
import { romBase64 as romBase64u } from "./roms/rom_2e_unenhanced"
import { romBase64 as romBase64gs } from "./roms/rom_gs"
import { romGsSystemBase64 } from "./roms/rom_gs_system"
// import { edmBase64 } from "./roms/edm_2e"
import { Buffer } from "buffer"
// import { isDebugging } from "./motherboard";
import { RamWorksMemoryStart, RamWorksPage, ROMpage, ROMmemoryStart, hiresLineToAddress } from "../common/utility"
import { isWatchpoint, observeMemoryWrite, setWatchpointBreak } from "./cpu6502"
import { noSlotClock } from "./nsc"
import { videoTerm } from "./devices/videoterm"
import { vidhd } from "./devices/vidhd"
import { isDebugging } from "./motherboard"
import { iigsClock } from "./iigs_clock"
import { iigsADB } from "./iigs_adb"

// 0x00000: main memory
// 0x10000...13FFF: ROM (including page $C0 soft switches)
// 0x14000...146FF: Peripheral card ROM $C100-$C7FF
// 0x14700...17EFF: Slots 1-7 (8*256 byte $C800-$CFFF range for each card)
// 0x17F00...: AUX/RamWorks memory (AUX is RamWorks bank 0)
// Bank1 of $D000-$DFFF is stored at 0x*D000-0x*DFFF (* 0 for main, 1 for aux)
// Bank2 of $D000-$DFFF is stored at 0x*C000-0x*CFFF (* 0 for main, 1 for aux)

const SLOTindex = 0x140
const SLOTC8index = 0x147
const SLOTstart = 256 * SLOTindex
const SLOTC8start = 256 * SLOTC8index

// Start out with only 64K of AUX memory.
// This is the maximum bank number. Each index represents 64K.
export let RamWorksMaxBank = 0
const BaseMachineMemory = RamWorksMemoryStart
export let memory = (new Uint8Array(BaseMachineMemory + (RamWorksMaxBank + 1) * 0x10000)).fill(0)

const slotHasCard = (new Uint8Array(8)).fill(0)

// Fake status flag indicating which slot has access to $C800-$CFFF.
//   0: No slot selected but INTC8ROM is off
// 1-7: Slot number for peripheral ROM
// 255: No slot: INTC8ROM was forced on by SLOTC3ROM switch and access to $C3xx
export const C800SlotGet = () => {
  return memGetC000(0xC02A)
}

const C800SlotSet = (slot: number) => {
  memSetC000(0xC02A, slot)
}

export const RamWorksBankGet = () => {
  return memGetC000(0xC073)
}

const RamWorksBankSet = (bank: number) => {
  memSetC000(0xC073, bank)
}

// Mappings from real Apple II address to memory array above.
// 256 pages of memory, from $00xx to $FFxx.
// Include one extra slot, to avoid needing memory checks for > 65535.
export const addressGetTable = new Uint32Array(257)
const addressSetTable = new Uint32Array(257)
const ADDRESS_GUARD = 0xFFFFFF

let currentMachineName: MACHINE_NAME = "APPLE2EE"

export const heatMapMemGet = new Float64Array(0x10000)
export const heatMapMemSet = new Float64Array(0x10000)
// Tracked incrementally as the heat maps are written, so the UI never has to
// rescan all 65536 entries per frame just to find the peak.
let heatMapMemGetMaxValue = 0
let heatMapMemGetMaxIndex = 0
let heatMapMemSetMaxValue = 0
let heatMapMemSetMaxIndex = 0

export const getHeatMapMemGet = (): Float64Array => {
  if (isDebugging) {
    return heatMapMemGet
  }
  return new Float64Array()
}

export const getHeatMapMemSet = (): Float64Array => {
  if (isDebugging) {
    return heatMapMemSet
  }
  return new Float64Array()
}

export const getHeatMapMemGetMax = () => {
  return { value: heatMapMemGetMaxValue, index: heatMapMemGetMaxIndex }
}

export const getHeatMapMemSetMax = () => {
  return { value: heatMapMemSetMaxValue, index: heatMapMemSetMaxIndex }
}

export const resetHeatMapMemGet = () => {
  heatMapMemGet.fill(0)
  heatMapMemGetMaxValue = 0
  heatMapMemGetMaxIndex = 0
}

export const resetHeatMapMemSet = () => {
  heatMapMemSet.fill(0)
  heatMapMemSetMaxValue = 0
  heatMapMemSetMaxIndex = 0
}

export const getCurrentMachineName = () => {
  return currentMachineName
}

export let gsROM = new Uint8Array(0);
// Apple IIgs ROM 01 system ROM (128KB, banks $FE-$FF). gsROM is the Mega II
// (IIe) ROM used by the //e machines; the IIgs boots from gsSystemROM.
export let gsSystemROM = new Uint8Array(0);
export const iigsRegisters = new Uint8Array(256);
iigsRegisters[0x36] = 0x80; // Default fast speed
// IIgs interrupt state, mirroring web-a2e's iigs_memory: $C046 reports which
// sources are pending (bit3 VBL, bit4 quarter-second) plus bit7 = "a source
// is pending AND enabled". The flags survive reads; only $C047 clears them.
let vblPending = false;
let quarterSecondPending = false;
export const iigsSignalVbl = () => { vblPending = true; };
export const iigsClearInterrupts = () => { vblPending = false; quarterSecondPending = false; };

export const doSetRom = (machineName: MACHINE_NAME) => {
  currentMachineName = machineName
  let romStr = ""
  switch (machineName) {
    case "APPLE2P":
      romStr = romBase64p
      break
    case "APPLE2EU":
      romStr = romBase64u
      break
    case "APPLE2EE":
      romStr = romBase64e
      break
    case "APPLE2GS":
      const rom64_gs = romBase64gs.replace(/[\n\r\s]/g, "");
      gsROM = new Uint8Array(Buffer.from(rom64_gs, "base64"));
      const rom64_sys = romGsSystemBase64.replace(/[\n\r\s]/g, "");
      gsSystemROM = new Uint8Array(Buffer.from(rom64_sys, "base64"));
      console.log(`[DEBUG] gsROM (Mega II) length: ${gsROM.length}`);
      console.log(`[DEBUG] gsSystemROM length: ${gsSystemROM.length}`);
      console.log(`[DEBUG] Reset vector at FF:FFFC = ${gsSystemROM[0x1FFFC]?.toString(16).padStart(2,'0')} ${gsSystemROM[0x1FFFD]?.toString(16).padStart(2,'0')}`);
      return // Skip standard Apple IIe ROM mapping setup
  }
  // For now, comment out the use of the Extended Debugging Monitor
  // It's unclear what the benefit is, especially since we have a separate
  // TypeScript debugger. And there is a risk that some programs might
  // behave differently with the EDM.
  // if (isDebugging) romStr = edmBase64
  const rom64 = romStr.replace(/\n/g, "")
  const rom = new Uint8Array(
    Buffer.from(rom64, "base64")
  )
  // Hack: The IIe enhanced checks 3 bytes in each slot to determine if there
  // is a disk drive. If memory locations $Cx01, $Cx03, and $Cx05 contain
  // the values $20, $00, $03 then it's a disk drive (hard drive or floppy).
  // The II+ and IIe unenhanced checks 4 bytes. The last byte checked is at
  // $C707 and is expected to be $3C. However, the value will only be $3C for a
  // floppy drive. A SmartPort hard drive will have the value $00.
  // The result is that on a II+ or unenhanced IIe, the SmartPort hard drive
  // will be skipped and the machine will always try to boot slot 6.
  // To work around this, hack the monitor ROM to only check the first
  // 3 bytes. This will allow the SmartPort hard drive to be booted.
  // Change LDA #$07 to LDA #$05, do for all ROMs.
  rom[0xFABB - 0xC000] = 0x05
  memory.set(rom, ROMmemoryStart)
}

export let gsRAM = new Uint8Array(8 * 1024 * 1024);

export const memGet24 = (address: number): number => {
    let bank = (address >> 16) & 0xFF;
    const offset = address & 0xFFFF;
    
    // Apple IIgs ROM 01 mapping: the 128KB system ROM lives in banks $FE-$FF
    // (FE at image offset 0, FF at 0x10000). The Mega II banks $E0/$E1 and the
    // shadowed banks $00/$01 read the fast ROM in bank FF through their
    // language-card window when RDROM is set — matching gssquared/web-a2e.
    if (gsSystemROM && gsSystemROM.length > 0) {
        if (bank >= 0xFE) {
            return gsSystemROM[((bank & 1) << 16) | offset];
        }
        if ((bank === 0xE0 || bank === 0xE1) && offset >= 0xD000) {
            if (!SWITCHES.BSRREADRAM.isSet) return gsSystemROM[0x10000 + offset];
        }
        if (bank === 0x00 || bank === 0x01) {
            if (offset >= 0xD000 && !SWITCHES.BSRREADRAM.isSet) {
                return gsSystemROM[0x10000 + offset];
            }
            // $C071-$C07F: BRK/IRQ firmware (JML to the interrupt manager).
            // $C100-$CFFF: internal ROM pages, served from bank FF.
            if (offset >= 0xC071 && offset <= 0xC07F) return gsSystemROM[0x10000 + offset];
            if (offset >= 0xC100 && offset <= 0xCFFF) return gsSystemROM[0x10000 + offset];
        }
    }

    // Bank E0/E1: Mega II (the Apple IIe inside the IIgs)
    // These are NOT simple linear RAM - they go through the IIe's memory system
    // which includes soft switches, language card, etc.
    if (bank === 0xE0 || bank === 0xE1) {
        // For $C000-$CFFF I/O region, use memGet which handles soft switches
        if (offset >= 0xC000 && offset < 0xD000) {
            return memGet(offset, false);
        }
        // For $D000-$FFFF, check if ROM is enabled via language card switches
        if (offset >= 0xD000) {
            // If RDROM is set, read from ROM
            if (!SWITCHES.BSRREADRAM.isSet) {
                return gsROM[(bank << 16) | offset] || 0;
            }
            // Otherwise read from language card RAM
            // Bank E0 = main, Bank E1 = aux
            const auxOffset = (bank === 0xE1) ? RamWorksMemoryStart : 0;
            if (!SWITCHES.BSRBANK2.isSet) {
                // Bank 1: $D000-$DFFF stored at offset-0x1000
                return memory[auxOffset + offset - 0x1000];
            }
            // Bank 2: $D000-$FFFF stored normally
            return memory[auxOffset + offset];
        }
        // For $0000-$BFFF, direct RAM access
        // Bank E0 = main RAM, Bank E1 = aux RAM
        const auxOffset = (bank === 0xE1) ? RamWorksMemoryStart : 0;
        return memory[auxOffset + offset];
    }

    // Bank 00: Standard Apple IIe memory map (including ROM and Soft Switches)
    if (bank === 0x00) {
        return memGet(offset, false);
    }
    
    // Bank 01: Direct, absolute access to Aux Memory (in IIgs, Bank 01 is subject to soft switches, but typically we can treat it similarly to Aux memory. Wait, IIgs Bank 01 respects some soft switches? Actually, let's treat Bank 01 exactly like E1 for now, but Apple IIe only has Bank 00.)
    if (bank === 0x01) {
        if (offset >= 0xC000 && offset < 0xD000) {
            return memGet(offset, false); // I/O
        }
        return memory[RamWorksMemoryStart + offset];
    }
    
    // Bank 02-7F: 8MB of pure, linear 65816 Fast RAM
    if (bank >= 0x02 && bank < 0x80) {
        return gsRAM[(bank << 16) | offset];
    }
    
    return 0;
}

export const memSet24 = (address: number, data: number) => {
    let bank = (address >> 16) & 0xFF;
    const offset = address & 0xFFFF;
    
    // Bank E0/E1: Mega II (Apple IIe inside IIgs)
    if (bank === 0xE0 || bank === 0xE1) {
        // I/O region
        if (offset >= 0xC000 && offset < 0xD000) {
            memSet(offset, data);
            return;
        }
        // Language card region
        if (offset >= 0xD000) {
            // Check if language card RAM is writable
            if (SWITCHES.BSR_WRITE.isSet) {
                const auxOffset = (bank === 0xE1) ? RamWorksMemoryStart : 0;
                if (!SWITCHES.BSRBANK2.isSet) {
                    // Bank 1
                    memory[auxOffset + offset - 0x1000] = data;
                } else {
                    // Bank 2
                    memory[auxOffset + offset] = data;
                }
            }
            return;
        }
        // Regular RAM
        const auxOffset = (bank === 0xE1) ? RamWorksMemoryStart : 0;
        memory[auxOffset + offset] = data;
        return;
    }

    // Bank 00: Standard Apple IIe memory map
    if (bank === 0x00) {
        memSet(offset, data);
        return;
    }

    // Bank 01: Direct, absolute access to Aux Memory
    if (bank === 0x01) {
        if (offset >= 0xC000 && offset < 0xD000) {
            memSet(offset, data); // I/O
            return;
        }
        memory[RamWorksMemoryStart + offset] = data;
        return;
    }
    
    // Bank 02-7F: 8MB of pure, linear 65816 Fast RAM
    if (bank >= 0x02 && bank < 0x80) {
        gsRAM[(bank << 16) | offset] = data;
    }
}

// The IIgs ROM installs its interrupt manager (JML $FF79C8) into E1:$0010-$0013
// and enables VBL interrupts during its interrupt-init routine (ff:78 region).
// That routine is never reached by the observed boot path, so the ROM's own
// BRKs (ff:a0ef/ff:b61d) storm into E1:$0010=0. Installing the manager + INTEN
// here mirrors what the ROM would do, so interrupts are serviced instead.
export const iigsInitInterrupts = () => {
    // The IIgs ROM's interrupt-init (ff:78a0-7927) and interrupt manager read
    // bank $00 zero-page / low memory, which memoryReset() fills with 0xFF.
    // With 0xFF in those locations the ROM's interrupt-init installs the full
    // interrupt manager (JML $FFB7CC) whose dispatch loop spins and never
    // reaches the OS event loop. Zero the low memory the boot path reads so
    // the machine proceeds like the harness (which starts from a zeroed
    // memory array).
    for (let i = 0; i < 0x2000; i++) memSet24(0x000000 + i, 0);
    // Bank $00:$7000-$70FF is the interrupt manager's scratch area.
    for (let i = 0; i < 0x100; i++) memSet24(0x007000 + i, 0);
    // The ROM's interrupt-init reads $700C (JML low) / $7008 (mid) / $700A
    // (high) and writes them to E1:0011-13, so E1:0010 becomes JML <that
    // address>. Pre-set them to $FF79C8 so that routine produces the same
    // interrupt manager entry we install below, instead of JML $FFFFFF.
    memSet24(0x00700c, 0xc8);
    memSet24(0x007008, 0x79);
    memSet24(0x00700a, 0xff);
    // E1:$0010-$0013 = JML $FF79C8 (the ROM's minimal interrupt manager: it
    // reads $C023 / $7006 and RTIs, acknowledging the IRQ without re-entering)
    memSet24(0xE10010, 0x5c);
    memSet24(0xE10011, 0xc8);
    memSet24(0xE10012, 0x79);
    memSet24(0xE10013, 0xff);
    // INTEN = $08: enable the VBL interrupt source
    iigsRegisters[0x41] = 0x08;
}


export const setRamWorks = (size: number) => {
  // Clamp to 64K...16M and make sure it is a multiple of 64K
  size = Math.max(64, Math.min(8192, size))
  const oldMaxBank = RamWorksMaxBank
  // For 64K this will be zero
  RamWorksMaxBank = Math.floor(size / 64) - 1

  // Nothing to do?
  if (RamWorksMaxBank === oldMaxBank) return

  // If our current bank index is out of range, just reset it
  if (RamWorksBankGet() > RamWorksMaxBank) {
    RamWorksBankSet(0)
    updateAddressTables()
  }

  // Reallocate memory and copy the old memory
  const newMemSize = BaseMachineMemory + (RamWorksMaxBank + 1) * 0x10000
  if (RamWorksMaxBank < oldMaxBank) {
    // We are shrinking memory, just keep the first part
    memory = memory.slice(0, newMemSize)
  } else {
    // We are expanding memory, copy the old memory
    const memtemp = memory
    memory = (new Uint8Array(newMemSize)).fill(0xFF)
    memory.set(memtemp)
  }
}

let auxCardEnabled = true
export const setAuxCardEnabled = (enabled: boolean) => {
  auxCardEnabled = enabled
  updateAddressTables()
}
export const getAuxCardEnabled = () => auxCardEnabled

const updateMainAuxMemoryTable = () => {
  const offsetAuxRead = (auxCardEnabled && SWITCHES.AUXRAMREAD.isSet) ? (RamWorksPage + RamWorksBankGet() * 256) : 0
  const offsetAuxWrite = (auxCardEnabled && SWITCHES.AUXRAMWRITE.isSet) ? (RamWorksPage + RamWorksBankGet() * 256) : 0
  const offsetPage2 = (auxCardEnabled && SWITCHES.PAGE2.isSet) ? (RamWorksPage + RamWorksBankGet() * 256) : 0
  const offsetTextPageRead = (auxCardEnabled && SWITCHES.STORE80.isSet) ? offsetPage2 : offsetAuxRead
  const offsetTextPageWrite = (auxCardEnabled && SWITCHES.STORE80.isSet) ? offsetPage2 : offsetAuxWrite
  const offsetHgrPageRead = (auxCardEnabled && SWITCHES.STORE80.isSet && SWITCHES.HIRES.isSet) ? offsetPage2 : offsetAuxRead
  const offsetHgrPageWrite = (auxCardEnabled && SWITCHES.STORE80.isSet && SWITCHES.HIRES.isSet) ? offsetPage2 : offsetAuxWrite
  for (let i = 2; i < 256; i++) {
    addressGetTable[i] = i + offsetAuxRead
    addressSetTable[i] = i + offsetAuxWrite
  }
  for (let i = 4; i <= 7; i++) {
    addressGetTable[i] = i + offsetTextPageRead
    addressSetTable[i] = i + offsetTextPageWrite
  }
  for (let i = 0x20; i <= 0x3F; i++) {
    addressGetTable[i] = i + offsetHgrPageRead
    addressSetTable[i] = i + offsetHgrPageWrite
  }
}

const updateReadBankSwitchedRamTable = () => {
  // if (SWITCHES.ALTZP.isSet) {  // DEBUG
  //   console.log(`RamWorksPage: ${toHex(RamWorksPage)}, RamWorksBankGet(): ${RamWorksBankGet()}`)
  // }
  const offsetZP = (auxCardEnabled && SWITCHES.ALTZP.isSet) ? (RamWorksPage + RamWorksBankGet() * 256) : 0
  addressGetTable[0] = offsetZP
  addressGetTable[1] = 1 + offsetZP
  addressSetTable[0] = offsetZP
  addressSetTable[1] = 1 + offsetZP
  if (SWITCHES.BSRREADRAM.isSet) {
    for (let i = 0xD0; i <= 0xFF; i++) {
      addressGetTable[i] = i + offsetZP
    }
    if (!SWITCHES.BSRBANK2.isSet) {
      // Bank1 of $D000-$DFFF is actually in 0xC0...0xCF
      for (let i = 0xD0; i <= 0xDF; i++) {
        addressGetTable[i] = i - 0x10 + offsetZP
      }
    }
  } else {
    // ROM ($D000...$FFFF)
    for (let i = 0xD0; i <= 0xFF; i++) {
      addressGetTable[i] = ROMpage + i - 0xC0
    }
  }
}

const updateWriteBankSwitchedRamTable = () => {
  const offsetZP = (auxCardEnabled && SWITCHES.ALTZP.isSet) ? (RamWorksPage + RamWorksBankGet() * 256) : 0
  const writeRAM = SWITCHES.BSR_WRITE.isSet
  // Start out with Slot ROM and regular ROM as not writeable
  for (let i = 0xC0; i <= 0xFF; i++) {
    addressSetTable[i] = ADDRESS_GUARD
  }
  if (writeRAM) {
    for (let i = 0xD0; i <= 0xFF; i++) {
      addressSetTable[i] = i + offsetZP
    }
    if (!SWITCHES.BSRBANK2.isSet) {
      // Bank1 of $D000-$DFFF is actually in 0xC0...0xCF
      for (let i = 0xD0; i <= 0xDF; i++) {
        addressSetTable[i] = i - 0x10 + offsetZP
      }
    }
  }
}

const slotIsActive = (slot: number) => {
  if (SWITCHES.INTCXROM.isSet) return false
  // SLOTC3ROM switch only has an effect if INTCXROM is off
  return (slot !== 3) ? true : SWITCHES.SLOTC3ROM.isSet
}

// Understanding the Apple IIe, Jim Sather, p. 5-28
// INTC8ROM: Unreadable soft switch
//   Set:   On access to $C3XX with SLOTC3ROM reset
//			- "From this point, $C800-$CFFF will stay assigned to motherboard ROM until
//			   an access is made to $CFFF or until the MMU detects a system reset."
//   Reset: On access to $CFFF or an MMU reset
//
// This is like a fake peripheral card in slot 3 (the 80-column card),
// where the internal $C800-$CFFF ROM is the fake card's peripheral ROM.
//
// INTCXROM   INTC8ROM   $C800-CFFF
//    0           0         slot   
//    0           1       internal 
//    1           0       internal 
//    1           1       internal 
//
const internalC8ROMIsActive = () => {
  if (SWITCHES.INTCXROM.isSet || SWITCHES.INTC8ROM.isSet) {
    return true
  }
  return false
}

const manageC800 = (slot: number) => {

  if (slot <= 7) {
    if (SWITCHES.INTCXROM.isSet) {
      return
    }
    // This combination forces INTC8ROM on.
    if (slot === 3 && !SWITCHES.SLOTC3ROM.isSet) {
      if (!SWITCHES.INTC8ROM.isSet) {
        SWITCHES.INTC8ROM.isSet = true
        C800SlotSet(255)
        updateAddressTables()
      }
    }

    // If C800Slot is zero, then possibly set it to first card accessed
    if (C800SlotGet() === 0) {
      // Only switch C8 space if slot has extended ROM
      // In a real system, not all cards respond to /IOSTROBE
      if (slotIOC8Space[slot])
      {
        C800SlotSet(slot)
        updateAddressTables()
      }
    }
  } else {
    // If slot > 7 then it was an access to $CFFF.
    // Accessing $CFFF resets our fake INTC8ROM to peripheral ROM.
    SWITCHES.INTC8ROM.isSet = false
    C800SlotSet(0)
    updateAddressTables()
  }
}

const updateSlotRomTable = () => {
  // ROM ($C000...$CFFF) is in 0x100...0x10F
  addressGetTable[0xC0] = ROMpage
  for (let slot = 1; slot <= 7; slot++) {
    const page = 0xC0 + slot
    addressGetTable[page] = slot +
      (slotIsActive(slot) ? (SLOTindex - 1) : ROMpage)
  }

  // Fill in $C800-CFFF for cards
  if (internalC8ROMIsActive()) {
    for (let i = 0xC8; i <= 0xCF; i++) {
      addressGetTable[i] = ROMpage + i - 0xC0
    }
  } else {
    const slotC8 = SLOTC8index + 8 * (C800SlotGet() - 1)
    for (let i = 0; i <= 7; i++) {
      const page = 0xC8 + i
      addressGetTable[page] = slotC8 + i
    }
  }
}

export const updateAddressTables = () => {
  updateMainAuxMemoryTable()
  updateReadBankSwitchedRamTable()
  updateWriteBankSwitchedRamTable()
  updateSlotRomTable()
  // Scale all of our mappings up by 256 to get to offsets in memory array.
  for (let i = 0; i < 256; i++) {
    addressGetTable[i] = 256 * addressGetTable[i]
    addressSetTable[i] = 256 * addressSetTable[i]
  }
}

// Used for jumping to custom TS functions when program counter hits an address.
export const specialJumpTable = new Map<number, () => void>()

// Custom callbacks for mem get/set to $C090-$C0FF slot I/O and $C100-$C7FF.
const slotIOCallbackTable = new Array<AddressCallback | undefined>(8)

// Determines whether slot has C800 space ROM or not
const slotIOC8Space = new Uint8Array(8)

const checkSlotIO = (addr: number, value = -1) => {
  const slot = ((addr >> 8) === 0xC0) ? ((addr - 0xC080) >> 4) : ((addr >> 8) - 0xC0)
  if (addr >= 0xC100) {
    manageC800(slot)
    if (!slotIsActive(slot))
      return
  }
  const fn = slotIOCallbackTable[slot]
  if (fn !== undefined) {
    const result = fn(addr, value)
    if (result >= 0) {
      // Set value in either slot memory or $C000 softswitch memory
      const offset = (addr >= 0xC100) ? (SLOTstart - 0x100) : ROMmemoryStart
      memory[addr - 0xC000 + offset] = result
    }
  }
}

/**
 * Add peripheral card IO callback.
 *
 * @param slot - The slot number 1-7.
 * @param fn - A function to jump to when IO of this slot is accessed
 */
export const setSlotIOCallback = (slot: number, fn: AddressCallback) => {
  slotHasCard[slot] = 1
  slotIOCallbackTable[slot] = fn
}

export const clearSlot = (slot: number) => {
  if (slot < 1 || slot > 7) return
  memory.fill(0, SLOTstart + (slot - 1) * 0x100, SLOTstart + slot * 0x100)
  memory.fill(0, SLOTC8start + (slot - 1) * 0x800, SLOTC8start + slot * 0x800)
  slotHasCard[slot] = 0
  slotIOC8Space[slot] = 0
  slotIOCallbackTable[slot] = undefined
}

/**
 * Add peripheral card ROM.
 *
 * @param slot - The slot number 1-7.
 * @param driver - The ROM code for the driver.
 *                 Range 0x00-0xff is the slot Cx00 space driver
 *                 Anything above is considered C800 space to be activated for this card.
 * @param jump - (optional) If the program counter equals this address, then `fn` will be called.
 * @param fn - (optional) The function to jump to.
 */
export const setSlotDriver = (slot: number, driver: Uint8Array, jump = 0, fn = () => {}) => {
  memory.set(driver.slice(0, 0x100), SLOTstart + (slot - 1) * 0x100)
  slotHasCard[slot] = driver.some(byte => byte !== 0) ? 1 : 0
  if (driver.length > 0x100) {
    // only allow up to 2k for C8 range
    const end = (driver.length > 0x900) ? 0x900 : driver.length
    const addr = SLOTC8start + (slot - 1) * 0x800
    memory.set(driver.slice(0x100,end), addr)
    // mark this slot as having C8 space
    slotIOC8Space[slot] = 0xff
  }
  if (jump) {
    specialJumpTable.set(jump, fn)
  }
}

export const memoryReset = () => {
  // Reset memory but skip over the ROM and peripheral card areas
  memory.fill(0xFF, 0, 0x10000)
  // Everything past here is RamWorks memory
  memory.fill(0xFF, BaseMachineMemory)

  // Real Apple II RAM does not power up as a uniform 0xFF: it settles into
  // a repeating 0xFF,0xFF,0x00,0x00 byte pattern (see js/util.ts's
  // allocMem(), borrowed from AppleWin). Applesoft's floating-point
  // mantissa-shift routine (ROR $9E / ROR $9F / ROR $A0 / ROR $A1 / ROR
  // $AC at $E891, confirmed by ROM disassembly) depends on this: under a
  // uniform 0xFF fill, $9E and $9F hold unrealistic values that corrupt
  // the first floating-point operation any auto-run program performs,
  // raising a spurious "?OVERFLOW ERROR" for any program whose first
  // statement evaluates a negative numeric literal (e.g. `CALL -936`).
  // $A0/$A1/$AC already land on the pattern's 0xFF positions, so only
  // these two bytes need correcting.
  //
  // This is deliberately narrow -- not a general switch to the realistic
  // pattern for all of memory -- because getApple2State()/setApple2State()
  // (save_restore.ts) use a uniform 0xFF as the sentinel "page not
  // written" value for sparse session-snapshot encoding. Filling all of
  // memory with the realistic pattern would defeat that optimization and
  // corrupt restoring session snapshots saved before this fix.
  memory[0x9E] = 0x00
  memory[0x9F] = 0x00
  C800SlotSet(0)
  RamWorksBankSet(0)
  updateAddressTables()
}

// Fill all pages of either main or aux memory with 0, 1, 2,...
export const memorySetForTests = (aux = false) => {
  memoryReset()
  doSetRom("APPLE2EE")
  const offset = aux ? RamWorksMemoryStart : 0
  for (let i=0; i <= 0xFF; i++) {
    memory.fill(i, i * 256 + offset, (i + 1) * 256 + offset)
  }
}

// Set $C007: FF to see this code
// Hack to change the cursor
// rom[0xC26F - 0xC000] = 161
// rom[0xC273 - 0xC000] = 161
// Hack to speed up the cursor
// rom[0xC288 - 0xC000] = 0x20

export const readWriteAuxMem = (addr: number, write = false) => {
  let useAux = write ? SWITCHES.AUXRAMWRITE.isSet : SWITCHES.AUXRAMREAD.isSet
  if (addr <= 0x1FF || addr >= 0xC000) {
    useAux = SWITCHES.ALTZP.isSet
  } else if (addr >= 0x400 && addr <= 0x7FF) {
    if (SWITCHES.STORE80.isSet) {
      useAux = SWITCHES.PAGE2.isSet
    }
  } else if (addr >= 0x2000 && addr <= 0x3FFF) {
    if (SWITCHES.STORE80.isSet) {
      if (SWITCHES.HIRES.isSet) {
        useAux = SWITCHES.PAGE2.isSet
      }
    }
  }
  return useAux
}

const memGetSoftSwitch = (addr: number): number => {
  if (addr === 0xC029 && vidhd.enabled) {
    return vidhd.readSoftSwitch()
  }
  if (vidhd.enabled && ((addr >> 4) === (0xC08 + vidhd.slot))) {
    return vidhd.readIO(addr)
  }
  if (addr === 0xC058 && videoTerm.enabled) {
    // Videx Soft Video Switch: AN0 off -> switch to 40-col display
    videoTerm.active = false
  } else if (addr === 0xC059 && videoTerm.enabled) {
    // Videx Soft Video Switch: AN0 on -> switch to Videx 80-col display
    videoTerm.active = true
  }
  
  // Apple IIgs: $C071-$C07F is firmware, not I/O! It holds the 8-bit BRK/IRQ
  // handler code that jumps to the 16-bit interrupt manager in bank $E1.
  // This must read from Bank $FF ROM (not Bank $FE).
  if (currentMachineName === "APPLE2GS" && addr >= 0xC071 && addr <= 0xC07F) {
      if (gsSystemROM && gsSystemROM.length > 0) {
          // Bank FF of the system ROM (128KB image: FE@0, FF@0x10000)
          return gsSystemROM[0x10000 + addr];
      }
  }
  
  // Apple IIgs hardware registers ($C020-$C04F)
  if (currentMachineName === "APPLE2GS" && addr >= 0xC020 && addr <= 0xC04F) {
      // Handle specific IIgs hardware
      switch (addr) {
          case 0xC024: // ADB Mouse Data
              return iigsADB.readMouseData();

          case 0xC025: // ADB Modifiers
              return iigsADB.readModifiers();

          case 0xC027: // ADB Status
              // Bit 5 = data available, Bit 2 = keyboard data. The controller
              // finishes commands instantly, so it reports what is really
              // pending. The firmware polls bit 5 before every read, and the
              // OS waits for it during ADB init, so the ADB must produce
              // responses to the init commands (writeCommand -> completeCommand).
              return iigsADB.readStatus();

          case 0xC026: // ADB Data
              return iigsADB.readData();

          case 0xC033: // Clock Data
              return iigsClock.readData();

          case 0xC034: // Clock Control (top 4 bits) + Border Color (bottom 4 bits)
              return iigsClock.readControl();

          case 0xC046: {
              // $C046 INTFLAG (web-a2e interruptStatusRegister): bit3 = VBL
              // pending, bit4 = quarter-second pending, bit7 = "some source is
              // pending AND enabled in $C041". Flags report what happened
              // regardless of the enable bits; only a $C047 write clears them.
              // The boot gate at ff:8552/ff:8555 does `lda $c046` in 8-bit
              // accumulator mode and `bmi` on bit 7 to take the interrupt
              // manager installer at ff:8549 -> ff:854b (jsr $a1b8), which
              // copies the E1 interrupt stubs into E1:$0010/$0080. Without a
              // pending VBL the installer is skipped, E1:$0010 stays 0x00
              // (BRK) and every interrupt storms.
              let val = 0;
              if (vblPending) val |= 0x08;
              if (quarterSecondPending) val |= 0x10;
              const en = iigsRegisters[0x41];
              if ((vblPending && (en & 0x08)) || (quarterSecondPending && (en & 0x10))) {
                  val |= 0x80;
              }
              // ADB interrupt is NOT gated by INTEN (web-a2e: adb.interruptPending()
              // only needs its own enable bits from $C027 writes).
              if (iigsADB.interruptPending()) val |= 0x80;
              return val;
          }

          case 0xC047:
              // $C047 read: web-a2e has no read case for it, so it falls
              // through to the Mega II, where it is the //e ROMSW sense --
              // bit 7 = 1 (internal ROM) at reset.
              return iigsRegisters[0x47] | 0x80;

          default:
              // Other IIgs registers - just echo what was written
              return iigsRegisters[addr & 0xFF];
      }
  }

  if (addr >= 0xC090) {
    checkSlotIO(addr)
  } else {
    checkSoftSwitches(addr, false, s6502.cycleCount)
  }
  if (addr >= 0xC050) {
    updateAddressTables()
  }
  return memory[ROMmemoryStart + addr - 0xC000]
}

export const memGetSlotROM = (slot: number, addr: number) => {
  const offset = SLOTstart + (slot - 1) * 0x100 + (addr & 0xFF)
  return memory[offset]
}

export const memSetSlotROM = (slot: number, addr: number, value: number) => {
  if (value >= 0) {
    const offset = SLOTstart + (slot - 1) * 0x100 + (addr & 0xFF)
    memory[offset] = value & 0xFF
  }
}

export const debugSlot = (slot: number, addr: number, oldvalue: number, value = -1) => {
  if (!slotIsActive(slot)) return
  if (((addr - 0xC080) >> 4) === slot || ((addr >> 8) - 0xC0) === slot) {
    let s = `$${s6502.PC.toString(16)}: $${addr.toString(16)} (${oldvalue})`
    if (value >= 0) s += ` = $${value.toString(16)}`
    console.log(s)
  }
}

export const memGet = (addr: number, checkWatchpoints = true): number => {
  let value = 0
  const page = addr >>> 8
  if (isDebugging && checkWatchpoints) {
    const count = heatMapMemGet[addr] + 1
    heatMapMemGet[addr] = count
    if (count > heatMapMemGetMaxValue) {
      heatMapMemGetMaxValue = count
      heatMapMemGetMaxIndex = addr
    }
  }
  // debugSlot(4, addr)
  if (page === 0xC0) {
    value = memGetSoftSwitch(addr)
  } else {
    value = -1
    if (page >= 0xC1 && page <= 0xC7) {
      if (page === 0xC3 && videoTerm.enabled) {
        // Videx VideoTerm: serve ROM bytes directly without calling checkSlotIO.
        // Also support No Slot Clock (NSC) serial bit-stream read at $C3xx for NS.CLOCK.SYSTEM.
        const nscVal = noSlotClock.read(addr)
        value = (nscVal >= 0) ? nscVal : videoTerm.readMemory(addr)
      } else if (page === 0xC3 && vidhd.enabled) {
        if (SWITCHES.SLOTC3ROM.isSet && !SWITCHES.INTCXROM.isSet) {
          // SLOTC3ROM is ON ($C00B): return VidHD slot ROM bytes ($24, $EA, $4C...)
          value = vidhd.readMemory(addr)
        } else {
          // SLOTC3ROM is OFF ($C00A) or INTCXROM is ON: return internal Apple IIe 80-col ROM or NSC
          const nscVal = noSlotClock.read(addr)
          value = (nscVal >= 0) ? nscVal : -1
          checkSlotIO(addr)
        }
      } else if (page == 0xC3 && (SWITCHES.INTCXROM.isSet || !SWITCHES.SLOTC3ROM.isSet)) {
        // NSC answers in slot C3 memory to be compatible with standard ProDOS driver and A2osX
        value = noSlotClock.read(addr)
        checkSlotIO(addr)
      } else {
        // Empty slots return random bus noise.
        if (slotIsActive(page - 0xC0) && !slotHasCard[page - 0xC0]) {
          value = Math.floor(256 * Math.random())
        }
        checkSlotIO(addr)
      }
    } else if (page >= 0xC8 && page <= 0xCD && videoTerm.enabled) {
      value = videoTerm.readMemory(addr)
    } else if (addr === 0xCFFF) {
      manageC800(0xFF)
    }
    if (videoTerm.enabled && videoTerm.active && (addr === 0xFDF0 || addr === 0xFE89 || addr === 0xFB2F)) {
      // Direct execution of Monitor 40-column COUT1 ($FDF0), SETVID/PR#0 ($FE89), or INIT ($FB2F):
      // switch back to 40-column display
      videoTerm.active = false
    }
    if (value < 0) {
      const shifted = addressGetTable[page]
      value = memory[shifted + (addr & 255)]
    }
  }
  if (checkWatchpoints && isWatchpoint(addr, value, false)) {
    setWatchpointBreak(addr)
  }
  return value
}

export const memGetRaw = (addr: number): number => {
  const page = addr >>> 8
  const shifted = addressGetTable[page]
  return memory[shifted + (addr & 255)]
}

const memSetSoftSwitch = (addr: number, value: number) => {
    // C029 (NEWVIDEO) - used by both Apple IIgs and VidHD
    if (addr === 0xC029) {
      if (vidhd.enabled || (gsROM && gsROM.length > 0)) {
        vidhd.writeSoftSwitch(value)
      }
      SWITCHES.NEWVIDEO.isSet = (value & 0x80) !== 0
      return
    }
    
    // Apple IIgs hardware registers ($C020-$C04F)
    if (currentMachineName === "APPLE2GS" && addr >= 0xC020 && addr <= 0xC04F) {
        // Handle specific IIgs hardware writes
        switch (addr) {
            case 0xC026: // ADB Data (command/response queue)
                iigsADB.writeCommand(value);
                break;

            case 0xC027: // ADB Status (interrupt enables)
                iigsADB.writeStatus(value);
                break;
            
            case 0xC033: // Clock Data
                iigsClock.writeData(value);
                break;
            
            case 0xC034: // Clock Control + Border Color
                iigsClock.writeControl(value);
                iigsRegisters[0x34] = value; // Also store for border color
                break;

            case 0xC047: // CLEARINT - clears the pending interrupt flags
                // (web-a2e: vblPending_ = false; quarterSecondPending_ = false)
                vblPending = false;
                quarterSecondPending = false;
                iigsRegisters[0x47] = value;
                break;

            default:
                // Other IIgs registers - just store the value
                iigsRegisters[addr & 0xFF] = value;
                break;
        }
        return;
    }
  if (addr === 0xC058 && videoTerm.enabled) {
    // Videx Soft Video Switch: AN0 off -> switch to 40-col display
    videoTerm.active = false
  } else if (addr === 0xC059 && videoTerm.enabled) {
    // Videx Soft Video Switch: AN0 on -> switch to Videx 80-col display
    videoTerm.active = true
  }
  // these are write-only soft switches that don't work like the others, since
  // we need the full byte of data being written
  if (addr === 0xC071 || addr === 0xC073) {
    // Out of range bank index?
    if (value > RamWorksMaxBank) return
    // The 0th bank is also AUX memory
    RamWorksBankSet(value)
  } else if (addr >= 0xC090) {
    checkSlotIO(addr, value)
  } else {
    checkSoftSwitches(addr, true, s6502.cycleCount)
  }
  if (addr <= 0xC00F || addr >= 0xC050) {
    updateAddressTables()
  }
}

export const memSet = (addr: number, value: number) => {
  const page = addr >>> 8
  if (isDebugging) {
    const count = heatMapMemSet[addr] + 1
    heatMapMemSet[addr] = count
    if (count > heatMapMemSetMaxValue) {
      heatMapMemSetMaxValue = count
      heatMapMemSetMaxIndex = addr
    }
  }
  // debugSlot(4, addr, value)
  if (page === 0xC0) {
    observeMemoryWrite(addr, value, "system", null)
    memSetSoftSwitch(addr, value)
  } else {
    if (addr === 0x37 && videoTerm.enabled) {
      // CSW High Byte written: $FD = Monitor COUT1 (40-col), $C3 = Slot 3 Videx (80-col)
      if (value === 0xFD) {
        videoTerm.active = false
      } else if (value === 0xC3) {
        videoTerm.active = true
      }
    }
    if (page >= 0xC1 && page <= 0xC7) {
      observeMemoryWrite(addr, value, "system", null)
      checkSlotIO(addr, value)
    } else if (page >= 0xCC && page <= 0xCD && videoTerm.enabled) {
      observeMemoryWrite(addr, value, "system", null)
      videoTerm.writeMemory(addr, value)
    } else if (addr === 0xCFFF) {
      observeMemoryWrite(addr, value, "system", null)
      manageC800(0xFF)
    }
    const shifted = addressSetTable[page]
    // This will prevent us from setting slot ROM or motherboard ROM
    if (shifted >= ADDRESS_GUARD) return
    const offset = shifted + (addr & 255)
    const effectiveSpace = offset < 0x10000
      ? "main" as const
      : offset >= RamWorksMemoryStart ? "aux" as const : "system" as const
    const effectiveAuxBank = effectiveSpace === "aux"
      ? Math.floor((offset - RamWorksMemoryStart) / 0x10000)
      : null
    observeMemoryWrite(addr, value, effectiveSpace, effectiveAuxBank)
    memory[offset] = value
  }
  if (isWatchpoint(addr, value, true)) {
    setWatchpointBreak(addr)
  }
}

export const memGetC000 = (addr: number) => {
  return memory[ROMmemoryStart + addr - 0xC000]
}

export const memSetC000 = (addr: number, value: number, repeat = 1) => {
  const start = ROMmemoryStart + addr - 0xC000
  memory.fill(value, start, start + repeat)
}

const TEXT_PAGE1 = 0x400
const TEXT_PAGE2 = 0x800
const offset = [
  0, 0x80, 0x100, 0x180, 0x200, 0x280, 0x300, 0x380, 0x28, 0xA8, 0x128, 0x1A8,
  0x228, 0x2A8, 0x328, 0x3A8, 0x50, 0xD0, 0x150, 0x1D0, 0x250, 0x2D0, 0x350,
  0x3D0,
]

export const getTextPage = (getLores = false) => {
  if (videoTerm.enabled && videoTerm.active && !getLores) {
    // If we're in full graphics mode (GR, HGR2, or full HGR), return empty
    // so the graphics renderer renders the Apple II motherboard graphics.
    if (!SWITCHES.TEXT.isSet && !SWITCHES.MIXED.isSet) {
      return new Uint8Array()
    }
    // If in MIXED mode (4 lines of 40-col text at bottom), Videx Soft Video Switch
    // selects motherboard video output so the 4 lines are rendered in 40-column.
    if (!SWITCHES.TEXT.isSet && SWITCHES.MIXED.isSet) {
      // fall through to standard 40-column text page processing below
    } else {
      return videoTerm.getTextPage()
    }
  }
  let jstart = 0
  let jend = 24
  let is80column = false
  if (getLores) {
    if (SWITCHES.TEXT.isSet || SWITCHES.HIRES.isSet) {
      return new Uint8Array()
    }
    jend = SWITCHES.MIXED.isSet ? 20 : 24
    is80column = auxCardEnabled && SWITCHES.COLUMN80.isSet && SWITCHES.DHIRES.isSet
  } else {
    if (!SWITCHES.TEXT.isSet && !SWITCHES.MIXED.isSet) {
      return new Uint8Array()
    }
    if (!SWITCHES.TEXT.isSet && SWITCHES.MIXED.isSet) jstart = 20
    is80column = auxCardEnabled && SWITCHES.COLUMN80.isSet
  }

  if (is80column) {
    // Only select second 80-column text page if STORE80 is also OFF
    const pageOffset = (SWITCHES.PAGE2.isSet && !SWITCHES.STORE80.isSet) ? TEXT_PAGE2 : TEXT_PAGE1
    const textPage = new Uint8Array(80 * (jend - jstart)).fill(0xA0)
    for (let j = jstart; j < jend; j++) {
      const joffset = 80 * (j - jstart)
      for (let i = 0; i < 40; i++) {
        // Interleave the characters, aux memory comes first for each pair.
        textPage[joffset + 2 * i + 1] = memory[pageOffset + offset[j] + i]
        textPage[joffset + 2 * i] = memory[RamWorksMemoryStart + pageOffset + offset[j] + i]
      }
    }
    return textPage
  }

  // See Video-7 RGB-SL7 manual, section 7.1, p. 35
  // https://mirrors.apple2.org.za/ftp.apple.asimov.net/documentation/hardware/video/Video-7%20RGB-SL7.pdf
  const isVideo7Text = SWITCHES.DHIRES.isSet && !SWITCHES.COLUMN80.isSet && SWITCHES.STORE80.isSet
  if (isVideo7Text) {
    const textPage = new Uint8Array(80 * (jend - jstart))
    for (let j = jstart; j < jend; j++) {
      const joffset = 80 * (j - jstart)
      // Put the actual character in the first half of the line,
      // and the color information in the second half.
      let memoffset = TEXT_PAGE1 + offset[j]
      textPage.set(memory.slice(memoffset, memoffset + 40), joffset)
      memoffset += RamWorksMemoryStart
      textPage.set(memory.slice(memoffset, memoffset + 40), joffset + 40)
    }
    return textPage
  }

  // Normal 40-column text page
  const pageOffset = (SWITCHES.PAGE2.isSet && !SWITCHES.STORE80.isSet) ? TEXT_PAGE2 : TEXT_PAGE1
  const textPage = new Uint8Array(40 * (jend - jstart))
  for (let j = jstart; j < jend; j++) {
    const joffset = 40 * (j - jstart)
    const start = pageOffset + offset[j]
    textPage.set(memory.slice(start, start + 40), joffset)
  }
  return textPage
}

export const getTextPageAsString = () => {
  return Buffer.from(getTextPage().map((n) => (n &= 127))).toString()
}

const hiResSingle = new Uint8Array(40 * 192)
const hiResDouble = new Uint8Array(80 * 192)
let hiResCurrent = hiResSingle
let hiResLines = 192

export const exportMemoryToHiresLine = (line: number) => {
  const doubleRes = SWITCHES.DHIRES.isSet && SWITCHES.COLUMN80.isSet
  const video7foreground = SWITCHES.DHIRES.isSet && !SWITCHES.COLUMN80.isSet && SWITCHES.STORE80.isSet
  // Determine which hi-res buffer to use
  if (doubleRes || SWITCHES.VIDEO7_MONO.isSet || SWITCHES.VIDEO7_160.isSet || video7foreground) {
    if (line === 0) {
      hiResCurrent = hiResDouble
      hiResLines = SWITCHES.MIXED.isSet ? 160 : 192
    }
    // Only select second 80-column text page if STORE80 is also OFF
    const pageOffset = (SWITCHES.PAGE2.isSet && !SWITCHES.STORE80.isSet) ? 0x4000 : 0x2000
    const addr = hiresLineToAddress(pageOffset, line)
    for (let i = 0; i < 40; i++) {
      hiResDouble[line * 80 + 2 * i + 1] = memory[addr + i]
      hiResDouble[line * 80 + 2 * i] = memory[RamWorksMemoryStart + addr + i]
    }
  } else {
    if (line === 0) {
      hiResCurrent = hiResSingle
      hiResLines = SWITCHES.MIXED.isSet ? 160 : 192
    }
    const pageOffset = SWITCHES.PAGE2.isSet ? 0x4000 : 0x2000
    const addr = pageOffset + 40 * Math.trunc(line / 64) +
      1024 * (line % 8) + 128 * (Math.trunc(line / 8) & 7)
    hiResSingle.set(memory.slice(addr, addr + 40), line * 40)
  }
}

export const getHires = () => {
  if (SWITCHES.TEXT.isSet || !SWITCHES.HIRES.isSet) {
    return new Uint8Array()
  }
  if (hiResLines === 192) {
    return hiResCurrent
  }
  if (hiResCurrent === hiResSingle) {
    return hiResCurrent.slice(0, 40 * hiResLines)
  }
  return hiResCurrent.slice(0, 80 * hiResLines)
}

export const getDataBlock = (addr: number) => {
  // The addr & 255 handles data blocks that span page boundaries.
  // This assumes that the second half of the block is within the same memory table range.
  const offset = addressGetTable[addr >>> 8] + (addr & 255)
  return memory.slice(offset, offset + 512)
}

export const setMemoryBlock = (addr: number, data: Uint8Array) => {
  // The addr & 255 handles data blocks that span page boundaries.
  // This assumes that the second half of the block is within the same memory table range.
  const vHi = addr >>> 8
  if (addressSetTable[vHi] >= ADDRESS_GUARD) return
  const offset = addressSetTable[vHi] + (addr & 255)
  memory.set(data, offset)
}

export const loadMainMemoryBlock = (addr: number, data: Uint8Array) => {
  if (!Number.isInteger(addr) || addr < 0 || addr + data.length > 0xC000) {
    throw new Error("Binary block must fit within main RAM at $0000-$BFFF")
  }
  memory.set(data, addr)
}

export const setMappedMemoryBlock = (addr: number, data: Uint8Array) => {
  let dataOffset = 0
  while (dataOffset < data.length) {
    const currentAddress = addr + dataOffset
    const pageOffset = currentAddress & 0xFF
    const pageLength = Math.min(0x100 - pageOffset, data.length - dataOffset)
    const memoryOffset = addressSetTable[currentAddress >>> 8] + pageOffset
    memory.set(data.subarray(dataOffset, dataOffset + pageLength), memoryOffset)
    dataOffset += pageLength
  }
}

export const matchMemory = (addr: number, data: number[]) => {
  for (let i = 0; i < data.length; i++) {
   if (memGet(addr + i, false) !== data[i]) return false
  }
  return true
}

export const getZeroPage = () => {
  const offset = addressGetTable[0]
  const mem = memory.slice(offset, offset + 256)
  return mem
}

export const getBasePlusAuxMemory = () => {
  return memory.slice(0, RamWorksMemoryStart + 0x10000)
}

export const getCurrentMemory = () => {
  const dump = new Uint8Array(0x10000)
  for (let page = 0; page < 256; page++) {
    const offset = addressGetTable[page]
    dump.set(memory.slice(offset, offset + 256), page * 256)
  }
  return dump
}

export const getMainMemory = () => {
  return memory.slice(0, 0x10000)
}

export const getAuxMemory = () => {
  return memory.slice(RamWorksMemoryStart, RamWorksMemoryStart + 0x10000)
}

export const getHgr1Memory = () => {
  return memory.slice(0x2000, 0x4000)
}

export const getHgr2Memory = () => {
  return memory.slice(0x4000, 0x6000)
}

export const getShr = (): Uint8Array => {
  if (gsROM && gsROM.length > 0) {
    return vidhd.extractShrBuffer(memory, RamWorksMemoryStart)
  }
  if (!vidhd.enabled || !vidhd.active) {
    return new Uint8Array()
  }
  return vidhd.extractShrBuffer(memory, RamWorksMemoryStart)
}
