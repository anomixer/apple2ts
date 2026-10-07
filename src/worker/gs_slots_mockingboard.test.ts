import { DEFAULT_SLOT_CONFIG_GS } from "../common/utility"
import { getSlotOptions, sanitizeSlotConfig } from "../common/slot_options"
import { doSetRom, memGet24, memSet24, memoryReset, iigsSlotRegister } from "./memory"
import { CPU65816 } from "./cpu65816"
import { doSetMachineName, doSetSlotConfig, getSlotConfig, configureMachine } from "./motherboard"
import { s6502 } from "./instructions"
import { enableMockingboard } from "./devices/mockingboard"

describe("Apple IIgs Slot Management & Hardware Compatibility", () => {
  test("Apple IIgs slot options restrict slots per GS architecture", () => {
    // Slot 1: Built-in Printer (none) or SSC
    expect(getSlotOptions(1, "APPLE2GS")).toEqual([{ card: "none" }, { card: "ssc" }])
    // Slot 2: Built-in Modem (none)
    expect(getSlotOptions(2, "APPLE2GS")).toEqual([{ card: "none" }])
    // Slot 3: Built-in 80 Columns / Video (none only! No aux or VidHD)
    expect(getSlotOptions(3, "APPLE2GS")).toEqual([{ card: "none" }])
    // Slot 4: Built-in Mouse (none) or Mockingboard
    expect(getSlotOptions(4, "APPLE2GS")).toEqual([{ card: "none" }, { card: "mockingboard" }])
    // Slot 5: Built-in 3.5" Floppy (none only! No mouse card)
    expect(getSlotOptions(5, "APPLE2GS")).toEqual([{ card: "none" }])
    // Slot 6: Built-in 5.25" Floppy (none) or Disk II
    expect(getSlotOptions(6, "APPLE2GS")).toEqual([{ card: "none" }, { card: "disk2" }])
    // Slot 7: Hard Drive / SmartPort (none or smartport)
    expect(getSlotOptions(7, "APPLE2GS")).toEqual([{ card: "none" }, { card: "smartport" }])
  })

  test("DEFAULT_SLOT_CONFIG_GS clears all expansion slots to none except slot 7 smartport", () => {
    expect(DEFAULT_SLOT_CONFIG_GS).toEqual({
      1: "none",
      2: "none",
      3: "none",
      4: "none",
      5: "none",
      6: "none",
      7: "smartport",
    })
  })

  test("sanitizeSlotConfig cleans up incompatible Apple IIe cards when switching to GS", () => {
    const iieConfig = {
      1: "ssc" as const,
      2: "none" as const,
      3: "aux" as const,
      4: "vera" as const,
      5: "mouse" as const,
      6: "disk2" as const,
      7: "smartport" as const,
    }
    const sanitized = sanitizeSlotConfig(iieConfig, "APPLE2GS")
    expect(sanitized[3]).toBe("none") // aux removed
    expect(sanitized[4]).toBe("none") // vera removed
    expect(sanitized[5]).toBe("none") // mouse card removed
    expect(sanitized[1]).toBe("ssc")  // allowed
    expect(sanitized[6]).toBe("disk2") // allowed
    expect(sanitized[7]).toBe("smartport") // allowed
  })

  test("doSetMachineName('APPLE2GS') resets slots to DEFAULT_SLOT_CONFIG_GS", () => {
    doSetMachineName("APPLE2GS", false, false)
    expect(getSlotConfig()).toEqual(DEFAULT_SLOT_CONFIG_GS)
  })

  test("Slot 4 Mockingboard works on Apple IIgs (I/O, 6522 VIA registers, IRQ triggering)", () => {
    memoryReset()
    doSetRom("APPLE2GS")
    doSetSlotConfig({
      ...DEFAULT_SLOT_CONFIG_GS,
      4: "mockingboard",
    })

    const cpu = new CPU65816(memGet24, (addr, val) => memSet24(addr, val))
    cpu.reset()

    // $C02D bit 4 should be 1 (peripheral card in slot 4)
    expect((iigsSlotRegister & (1 << 4)) !== 0).toBe(true)

    // Write to Mockingboard VIA #1 ACR ($C40B) and Data Direction Register A ($C403)
    memSet24(0x00C40B, 0x00) // One-shot mode for Timer 1
    memSet24(0x00C403, 0xFF) // DDRA = output

    // Write to Timer 1 low ($C404) and high ($C405)
    memSet24(0x00C404, 0x10) // T1 low latch
    memSet24(0x00C405, 0x00) // T1 high latch & start timer

    // Enable Timer 1 interrupt in VIA #1 IER ($C40E)
    // Bit 7=1 (set), Bit 6=1 (Timer 1) -> 0xC0
    memSet24(0x00C40E, 0xC0)

    // Advance cycles so the timer expires
    s6502.cycleCount += 50
    // Trigger cycleCountCallbacks
    const { processCycleCountCallbacks } = require("./cpu6502")
    processCycleCountCallbacks()

    // Interrupt should now be requested
    expect(s6502.flagIRQ & (1 << 4)).not.toBe(0)

    // Clear CPU I flag to allow interrupt to fire
    cpu.P &= ~0x04 // clear Status816.I

    // The vector at $00:FFFE in Apple IIgs points to the hardware firmware IRQ routine ($C074)
    const expectedVector = memGet24(0x00FFFE) | (memGet24(0x00FFFF) << 8)
    expect(expectedVector).toBe(0xC074)

    // Process instruction should take the IRQ (returns 7 cycles)
    const cycles = cpu.processInstruction()
    expect(cycles).toBe(7)
    expect(cpu.PC).toBe(expectedVector)
    expect(cpu.P & 0x04).toBe(0x04) // I flag set by interrupt
  })
})
