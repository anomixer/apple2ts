import { interruptRequest, registerCycleCountCallback } from "../cpu6502"
import { s6502 } from "../instructions"
import { debugSlot, memGetRaw, memGetSlotROM, memSetSlotROM, setSlotIOCallback } from "../memory"
import { passMockingboard } from "../worker2main"

export const enableMockingboard = (enable = true, slot = 4) => {
  if (!enable)
    return
  setSlotIOCallback(slot, handleMockingboard)
  registerCycleCountCallback(cycleCountCallback, slot)
}

const ORB = [0x0, 0x80]
const ORA = [0x1, 0x81]
const DDRB = [0x02, 0x82]
const DDRA = [0x03, 0x83]
const T1CL = [0x4, 0x84] // CL/CH = counter low/high
const T1CH = [0x5, 0x85]
const T1LL = [0x6, 0x86] // LL/LH = latch low/high
const T1LH = [0x7, 0x87]
const T2CL = [0x8, 0x88]
const T2CH = [0x9, 0x89]
const SHR = [0xA, 0x8A]
const ACR = [0xB, 0x8B]
const PCR = [0xC, 0x8C]
const IFR = [0xD, 0x8D]
const IER = [0xE, 0x8E]

// these are not part of 6522 registers, but store them in our ROM
// so they get saved with the state.
const T2LL = [0x10, 0x91]
const REG_LATCH = [0x11, 0x91]
const TIMER_FIRED = [0x12, 0x92]
const TIMER_STARTED = [0x13, 0x93]
const REG = [0x20, 0xA0]   // $C420...C42F and $C4A0...$C4AF

const TIMER1 = 64
const TIMER2 = 32

export const resetMockingboard = (slot = 4) => {
  // Clear out all our old parameters and interrupt flags.
  // Otherwise we hang on a reset or reboot.
  for (let addr = 0; addr <= 255; addr++) {
    memSetSlotROM(slot, addr, 0)
  }
  // Stop the music.
  for (let chip = 0; chip <= 1; chip++) {
    doPassRegisters(slot, chip)
  }
}

const T1enabled = (slot: number, chip: number) => (memGetSlotROM(slot, IER[chip]) & TIMER1) !== 0
const T1fired = (slot: number, chip: number) => (memGetSlotROM(slot, TIMER_FIRED[chip]) & TIMER1) !== 0
const T1started = (slot: number, chip: number) => (memGetSlotROM(slot, TIMER_STARTED[chip]) & TIMER1) !== 0
const T1continuous = (slot: number, chip: number) => (memGetSlotROM(slot, ACR[chip]) & TIMER1) !== 0

const handleTimerT1 = (slot: number, chip: number, cycleDelta: number) => {
  let t1low = memGetSlotROM(slot, T1CL[chip]) - cycleDelta
  memSetSlotROM(slot, T1CL[chip], t1low)
  if (t1low < 0) {
    t1low = (t1low % 256) + 256
    memSetSlotROM(slot, T1CL[chip], t1low)
    let t1high = memGetSlotROM(slot, T1CH[chip])
    t1high--
    memSetSlotROM(slot, T1CH[chip], t1high)
    if (t1high < 0) {
      t1high += 256
      memSetSlotROM(slot, T1CH[chip], t1high)
      if (T1started(slot, chip)) {
        // A started timer underflows (0 -> $FFFF). It always re-arms from the
        // latch -- in BOTH one-shot and continuous (free-running) mode. This is
        // what emu6502 does (it reloads t1c = latch whenever the counter wraps,
        // in both modes) and what mb-audit T6522_9 (11:09:01) requires: after a
        // one-shot underflow the counter must reload to the latch (T1C_h=$02),
        // not stay at $FFFF. The only difference between the modes is the
        // "fired" latch: one-shot sets it (so it re-arms for exactly one more
        // underflow), continuous leaves it clear (so it keeps re-arming and
        // firing). This is the "loaded" flag; it's what lets a timer that ran in
        // continuous mode still interrupt once after switching to one-shot
        // (mb-audit T6522_1 / 11:01:01).
        if (!T1fired(slot, chip)) {
          if (!T1continuous(slot, chip)) {
            const fired = memGetSlotROM(slot, TIMER_FIRED[chip])
            memSetSlotROM(slot, TIMER_FIRED[chip], fired | TIMER1)
          }
          const ifr = memGetSlotROM(slot, IFR[chip])
          memSetSlotROM(slot, IFR[chip], ifr | TIMER1)
          if (T1enabled(slot, chip)) {
            handleInterruptFlag(slot, chip, -1)
          }
        }
        // Reload the counter from the latch in both modes.
        const t1NewHigh = memGetSlotROM(slot, T1LH[chip])
        const t1NewLow = memGetSlotROM(slot, T1LL[chip])
        memSetSlotROM(slot, T1CL[chip], t1NewLow)
        memSetSlotROM(slot, T1CH[chip], t1NewHigh)
      }
    }
  }
}

const T2enabled = (slot: number, chip: number) => (memGetSlotROM(slot, IER[chip]) & TIMER2) !== 0
const T2fired = (slot: number, chip: number) => (memGetSlotROM(slot, TIMER_FIRED[chip]) & TIMER2) !== 0
const T2started = (slot: number, chip: number) => (memGetSlotROM(slot, TIMER_STARTED[chip]) & TIMER2) !== 0

const handleTimerT2 = (slot: number, chip: number, cycleDelta: number) => {
  // If Timer2 is in pulse-counting mode just bail
  if ((memGetSlotROM(slot, ACR[chip]) & TIMER2) !== 0) return
  let t2low = memGetSlotROM(slot, T2CL[chip]) - cycleDelta
  memSetSlotROM(slot, T2CL[chip], t2low)
  if (t2low < 0) {
    t2low = (t2low % 256) + 256
    memSetSlotROM(slot, T2CL[chip], t2low)
    let t2high = memGetSlotROM(slot, T2CH[chip])
    t2high--
    memSetSlotROM(slot, T2CH[chip], t2high)
    if (t2high < 0) {
      t2high += 256
      memSetSlotROM(slot, T2CH[chip], t2high)
      if (T2started(slot, chip) && !T2fired(slot, chip)) {
        const fired = memGetSlotROM(slot, TIMER_FIRED[chip])
        memSetSlotROM(slot, TIMER_FIRED[chip], fired | TIMER2)
        const ifr = memGetSlotROM(slot, IFR[chip])
        memSetSlotROM(slot, IFR[chip], ifr | TIMER2)
        if (T2enabled(slot, chip)) {
          handleInterruptFlag(slot, chip, -1)
        }
      }
    }
  }
}

const prevCycleCount = new Array<number>(8).fill(0)

const cycleCountCallback = (slot: number) => {
  const cycleDelta = s6502.cycleCount - prevCycleCount[slot]
  for (let chip = 0; chip <= 1; chip++) {
    handleTimerT1(slot, chip, cycleDelta)
    handleTimerT2(slot, chip, cycleDelta)
  }
  prevCycleCount[slot] = s6502.cycleCount
}

const getRegisters = (slot: number, chip: number) => {
  const registers: number[] = []
  for (let reg = 0; reg <= 15; reg++) {
    registers[reg] = memGetSlotROM(slot, REG[chip] + reg)
  }
  return registers
}

const compareArrays = (a: number[], b: number[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])

const prevParamsMap = new Map<string, number[]>()

let doPassRegisters = (slot: number, chip: number) => {
  const params = getRegisters(slot, chip)
  const key = `${slot}:${chip}`
  const prev = prevParamsMap.get(key)
  if (prev && compareArrays(params, prev)) return
  prevParamsMap.set(key, params)
  passMockingboard({slot, chip, params})
}

// Needed for tests, because they don't run in a worker thread.
export const disablePassRegisters = () => {
  doPassRegisters = () => {}
}

const handleCommand = (slot: number, chip: number) => {
  const orb = memGetSlotROM(slot, ORB[chip])
  // Some programs (Ultima 5) pass extra bits, so just remove them
  switch (orb & 7) {
    case 0:   // RESET command
      for (let reg = 0; reg <= 15; reg++) {
        memSetSlotROM(slot, REG[chip] + reg, 0)
      }
      doPassRegisters(slot, chip)
      break
    case 7:   // LATCH command, save the appropriate register number
      memSetSlotROM(slot, REG_LATCH[chip], memGetSlotROM(slot, ORA[chip]))
      break
    case 6: {  // WRITE command
      // Store the stashed value in the previously-latched register
      const reg =  memGetSlotROM(slot, REG_LATCH[chip])
      const value = memGetSlotROM(slot, ORA[chip])
      if (reg >= 0 && reg <= 15) {
        memSetSlotROM(slot, REG[chip] + reg, value)
        doPassRegisters(slot, chip)
      }
      break
    }
    case 4:   // Inactive
      // Do I need to do something here?
      break
    case 5:   // READ command: latch the selected AY register's value into ORA
      // so that a subsequent LDA ORA (Port-A read) returns the register contents.
      // This is how Mockingboard software (and mb-audit) read AY-3-8910/2/3
      // registers back. Without this, ORA reads return the stale port value and
      // the card is reported as "unknown (no AYs)".
      {
        const r = memGetSlotROM(slot, REG_LATCH[chip])
        if (r >= 0 && r <= 15) {
          memSetSlotROM(slot, ORA[chip], memGetSlotROM(slot, REG[chip] + r))
        }
      }
      break
    default:
      break
  }
}

const handleInterruptFlag = (slot: number, chip: number, value: number) => {
  let ifr = memGetSlotROM(slot, IFR[chip])
  if (value >= 0) {
    // Turn off any interrupt bits that are set in our value.
    // Leave other bits alone.
    ifr &= (127 - (value & 127))
  }
  // Real 6522: IRQ line is asserted only when (IFR & IER & 0x7F) != 0
  // Bit 7 of IFR indicates whether IRQ is active for this VIA chip.
  const ier = memGetSlotROM(slot, IER[chip])
  const active = (ifr & ier & 0x7F) !== 0
  if (active) {
    ifr |= 128
  } else {
    ifr &= 127
  }
  memSetSlotROM(slot, IFR[chip], ifr)
  interruptRequest(slot, active)
}

const handleInterruptEnable = (slot: number, chip: number, value: number) => {
  let ier = memGetSlotROM(slot, IER[chip])
  if (value >= 0) {
    value = value & 255
    if (value & 128) {
      // Turn on any interrupt bits that are set in our enable register.
      // Leave other bits alone.
      ier |= value
    } else {
      // Turn off any interrupt bits that are set in our enable register.
      // Leave other bits alone.
      ier &= (255 - value)
    }
  }
  // Bit 7 is always on for reading.
  ier |= 128
  memSetSlotROM(slot, IER[chip], ier)
  // IER changed, so re-evaluate whether the IRQ line should still be asserted.
  handleInterruptFlag(slot, chip, -1)
}

let debug = 1000

// The 6522 timer counter is loaded from the latch when the high-order counter
// register is written. That write lands in the instruction's data phase (its last
// cycle), so the instruction's earlier address-fetch cycles must NOT drain the
// freshly-loaded counter. But apple2ts decrements the counter by the full cycle
// count of the current instruction, so a longer store (e.g. STA abs,Y = 5, or
// STA (zp,X) = 6) drains one or two extra cycles and the read comes out low.
// mb-audit T6522_3 loads the counter with 4/4/4/5/5/6/6/4/5/5/6-cycle stores
// (subTests #0-#A) and expects the SAME read ($F1) for all of them -- emu6502
// (a passing reference) and AppleWin (GetOpcodeCyclesForWrite) both make the
// loaded value independent of the store opcode. We compensate by adding the
// store's extra cycles beyond the 4-cycle absolute-store baseline that mb-audit
// calibrates to $F1, so every store opcode reads the same value.
// (The store opcode is the current instruction; s6502.PC still points at it
// while its execute() runs the counter load.)
const extraTimerWriteCycles = () => {
  const opcode = memGetRaw(s6502.PC)
  switch (opcode) {
    case 0x8D: // STA abs
    case 0x8C: // STY abs
    case 0x8E: // STX abs
    case 0x9C: // STZ abs
      return 0
    case 0x99: // STA abs,Y
    case 0x9D: // STA abs,X
    case 0x9E: // STZ abs,X
    case 0x92: // STA (zp)
      return 1
    case 0x81: // STA (zp,X)
    case 0x91: // STA (zp),Y
      return 2
    default:
      return 0
  }
}

// The 6522 counter is sampled at the READ instruction's data phase (its last
// cycle), so a longer read (more address-fetch cycles before the data phase)
// sees the counter one or two cycles lower. apple2ts serves the counter as stored
// (before decrementing the current instruction), so it returns the 4-cycle
// absolute-read value for EVERY read opcode -- mb-audit T6522_5 reads T1C_L with
// 4/4/4/5/6-cycle reads (subTests #$20-#$25) expecting $FC/$FC/$FC/$FB/$FA, but
// apple2ts returns $FC for all of them (11:05:23: the 5-cycle read #$23 did not
// read $FB). Subtract the read's extra cycles beyond the 4-cycle absolute-read
// baseline (the 4-cycle reads already pass) so each read opcode returns the right
// value. This is AppleWin's GetOpcodeCyclesForRead. (The read opcode is the
// current instruction; s6502.PC still points at it while its execute() reads the
// counter.)
const extraTimerReadCycles = () => {
  const opcode = memGetRaw(s6502.PC)
  const lowNibble = opcode & 0x0F
  const bit4 = (opcode & 0x10) !== 0
  if (lowNibble === 0x01 && !bit4) return 2  // (zp,X) read: 6 cycles
  if (lowNibble === 0x01 && bit4) return 1   // (zp),Y read: 5 cycles
  if (lowNibble === 0x02 && bit4) return 1   // (zp) read: 5 cycles
  return 0                                    // abs reads (abs, abs,X, abs,Y): 4 cycles
}

// The 16-bit timer counter for a chip/timer, adjusted for the current read
// instruction's data phase (see extraTimerReadCycles). byte 0 = low, 1 = high.
const readTimerCounterByte = (slot: number, chip: number, timer: number, byte: number) => {
  const clOff = timer === 0 ? T1CL[chip] : T2CL[chip]
  const chOff = timer === 0 ? T1CH[chip] : T2CH[chip]
  const counter = (memGetSlotROM(slot, chOff) << 8) | memGetSlotROM(slot, clOff)
  const adjusted = (counter - extraTimerReadCycles()) & 0xFFFF
  return byte ? (adjusted >> 8) & 0xFF : adjusted & 0xFF
}

export const handleMockingboard: AddressCallback = (addr: number, value = -1) => {
  if (addr < 0xC100) return -1
  const slot = (addr & 0xF00) >> 8
  const address = addr & 0xFF
  if (debug < 500) {//} && ((address >= 0x4 && address < 0x80) || address >= 0x84)) {
    debug++
    const oldvalue = memGetSlotROM(slot, address)
    debugSlot(slot, addr, oldvalue, value)
  }
  const chip = (address & 0x80) ? 1 : 0
  switch (address) {
    case ORB[chip]: // ORB
      if (value >= 0) {
        memSetSlotROM(slot, ORB[chip], value)
        handleCommand(slot, chip)
      }
      break
    case ORA[chip]: // Output register A
    case DDRB[chip]: // $07 Data direction register B - output bits 1,2,4
    case DDRA[chip]: // $FF Data direction register A - all output
    case SHR[chip]: // Shift register (unused)
    case ACR[chip]: // Auxiliary control register
    case PCR[chip]: // Peripheral control register (unused)
      memSetSlotROM(slot, address, value)
      break
    case T1CL[chip]: // Timer 1 low-order counter
      if (value >= 0) {
        // Copy counter into latch
        memSetSlotROM(slot, T1LL[chip], value)
      }
      // Reset T1 interrupt (Note that a "write" also does a "read")
      handleInterruptFlag(slot, chip, TIMER1)
      if (value < 0) return readTimerCounterByte(slot, chip, 0, 0)
      break
    case T1CH[chip]: // Timer 1 high-order counter, fall thru
      if (value >= 0) {
        memSetSlotROM(slot, T1LH[chip], value)
        // The W65C22 timer counter loads as (latch + 1), not the latch value:
        // it counts latch+1 cycles before underflowing. This is what emu6502
        // does (t1c = latch + 1) and what mb-audit T6522_3/11:03:00 requires
        // (reads T1C_L == $F1). Loading the plain latch value reads one cycle
        // short ($F0).
        //
        // The counter also loads at the store instruction's data phase (its last
        // cycle), so the store's earlier address-fetch cycles must NOT drain it.
        // apple2ts decrements the counter by the store's full cycle count, so a
        // longer store (STA abs,Y = 5, STA (zp,X) = 6) over-drains by its extra
        // cycles and the read comes out low -- mb-audit 11:03:03 (STA abs,Y)
        // reads $F0 instead of $F1. Add the store's extra cycles beyond the
        // 4-cycle baseline (see extraTimerWriteCycles) so every store opcode
        // reads the same value, as emu6502/AppleWin do.
        const latchLow = memGetSlotROM(slot, T1LL[chip])
        const loadLow = latchLow + 1 + extraTimerWriteCycles()
        memSetSlotROM(slot, T1CL[chip], loadLow & 0xFF)
        memSetSlotROM(slot, T1CH[chip], (value + (loadLow > 0xFF ? 1 : 0)) & 0xFF)
        // Reset T1 interrupt flag
        const fired = memGetSlotROM(slot, TIMER_FIRED[chip])
        memSetSlotROM(slot, TIMER_FIRED[chip], fired & ~TIMER1)
        const started = memGetSlotROM(slot, TIMER_STARTED[chip])
        memSetSlotROM(slot, TIMER_STARTED[chip], started | TIMER1)
        handleInterruptFlag(slot, chip, TIMER1)
      }
      if (value < 0) return readTimerCounterByte(slot, chip, 0, 1)
      break
    case T1LL[chip]: // Timer 1 low-order latch
      if (value >= 0) {
        memSetSlotROM(slot, address, value)
        // This seems weird (and contradicts the datasheet?) but writing into
        // the low-order latch also does a read from the low-order counter,
        // and hence resets the interrupt flag. This was the only
        // way to get Ultima 5 to play music.
        handleInterruptFlag(slot, chip, TIMER1)
      }
      break
    case T1LH[chip]: // Timer 1 high-order latch
      if (value >= 0) {
        memSetSlotROM(slot, address, value)
      }
      break
    case T2CL[chip]: // Timer 2 low-order latch/counter
      if (value >= 0) {
        memSetSlotROM(slot, T2LL[chip], value)
      }
      // Reset T2 interrupt (Note that a "write" also does a "read")
      handleInterruptFlag(slot, chip, TIMER2)
      if (value < 0) return readTimerCounterByte(slot, chip, 1, 0)
      break
    case T2CH[chip]: // Timer 2 high-order counter
      if (value >= 0) {
        // Same (latch + 1) load model and store-phase compensation as Timer 1
        // (see T1CH above).
        const t2latchLow = memGetSlotROM(slot, T2LL[chip])
        const t2loadLow = t2latchLow + 1 + extraTimerWriteCycles()
        memSetSlotROM(slot, T2CL[chip], t2loadLow & 0xFF)
        memSetSlotROM(slot, T2CH[chip], (value + (t2loadLow > 0xFF ? 1 : 0)) & 0xFF)
        // Reset T2 interrupt flag
        const fired = memGetSlotROM(slot, TIMER_FIRED[chip])
        memSetSlotROM(slot, TIMER_FIRED[chip], fired & ~TIMER2)
        const started = memGetSlotROM(slot, TIMER_STARTED[chip])
        memSetSlotROM(slot, TIMER_STARTED[chip], started | TIMER2)
        handleInterruptFlag(slot, chip, TIMER2)
      }
      if (value < 0) return readTimerCounterByte(slot, chip, 1, 1)
      break
    case IFR[chip]: // Interrupt flag register
      if (value >= 0) {
        handleInterruptFlag(slot, chip, value)
      }
      break
    case IER[chip]: // Interrupt enable register
      handleInterruptEnable(slot, chip, value)
      break
    default: // debugSlot(slot, addr, value)
      break
  }
  return -1
}
