import { runAssemblyTest } from "../instructions.test"
import { interruptRequest, processInstruction } from "../cpu6502"
import { s6502, setPC } from "../instructions"
import { memory, memGetSlotROM, updateAddressTables } from "../memory"
import { ROMmemoryStart } from "../../common/utility"
import { parseAssembly } from "../utility/assembler"
import { disablePassRegisters, resetMockingboard, handleMockingboard, enableMockingboard } from "./mockingboard"

test("temp", () => {})

const slot = 4

const N = 0b10000000
// const V = 0b01000000
// const B = 0b00010000
// const D = 0b00001000
const I = 0b00000100
const Z = 0b00000010
const C = 0b00000001

// Dynamically set the enable register to a specific value,
// then load the enable register into the Accumulator.
const ldaE_V = (chip: number, value: number) => {
  const X = chip ? "8" : "0"
  return `
  LDA #$${value.toString(16)}
  STA $C${slot}${X}E
  LDA $C${slot}${X}E
`.split("\n")
}

// Dynamically set the interrupt flag register to a specific value,
// then load the interrupt register into the Accumulator.
const ldaD_V = (chip: number, value: number) => {
  const X = chip ? "8" : "0"
  return `
  LDA #$${value.toString(16)}
  STA $C${slot}${X}D
  LDA $C${slot}${X}D
`.split("\n")
}

// None of these tests should affect the flags register.
for (let chip = 0; chip <= 1; chip++) {
  const X = chip ? "8" : "0"
  const ldaE = `LDA $C${slot}${X}E`
  const ldaD = `LDA $C${slot}${X}D`
  test("start E", () => runAssemblyTest([ldaE], 128, N))
  test("start D", () => runAssemblyTest([ldaD], 0, Z))

  // Turn off some interrupt flags (already all off so should not have an affect)
  test("erase E 1", () => runAssemblyTest(ldaE_V(chip, 127), 128, N))
  test("erase E 2", () => runAssemblyTest([ldaD], 0, Z))
  test("erase E 3", () => runAssemblyTest(ldaE_V(chip, 0), 128, N))
  test("erase E 4", () => runAssemblyTest([ldaD], 0, Z))

  // Set some flags in the enable register
  test("set E 5", () => runAssemblyTest(ldaE_V(chip, 0b11010101), 0b11010101, N))
  test("check D 5", () => runAssemblyTest([ldaD], 0, Z))

  // Turn off some flags using enable register
  test("set E 6", () => runAssemblyTest(ldaE_V(chip, 0b01010000), 0b10000101, N))
  test("check D 6", () => runAssemblyTest([ldaD], 0, Z))

  // Turn off all flags using enable register
  test("set E 7", () => runAssemblyTest(ldaE_V(chip, 0b01111111), 128, N))
  test("check D 7", () => runAssemblyTest([ldaD], 0, Z))
}

// Try to turn off some interrupt flags (already all off so no affect)
for (let chip = 0; chip <= 1; chip++) {
  const X = chip ? "8" : "0"
  const ldaD = `LDA $C${slot}${X}D`
  test("start D 2", () => runAssemblyTest([ldaD], 0, Z))
  test("erase D 2", () => runAssemblyTest(ldaD_V(chip, 0b10101010), 0, Z))
}

const latchRegister = (chip: number, reg: number, data: number) => {
  const X = chip ? "8" : "0"
  const RA = ((chip ? 0xA0 : 0x20) + reg).toString(16)
  return `
  LDA #$${reg.toString(16)}
  STA $C${slot}${X}1   ; ORA
  LDA #$07       ; Latch command
  STA $C${slot}${X}0   ; ORB
  LDA #$04       ; Inactive
  STA $C${slot}${X}0   ; ORB
  LDA #$${data.toString(16)}
  STA $C${slot}${X}1   ; ORA
  LDA #$06       ; Write command
  STA $C${slot}${X}0   ; ORB
  LDA #$04       ; Inactive
  STA $C${slot}${X}0   ; ORB
  LDA $C${slot}${RA}   ; read register (hack)
`.split("\n")
}

// Loop thru each chip and each register, doing a latch + write in assembly
// Currently there is no "read" from my Mockingboard driver so just use
// a helper routine to get the registers.
for (let chip = 1; chip <= 1; chip++) {
  disablePassRegisters()
  for (let reg = 0; reg <= 15; reg++) {
    const data = 0x10 + chip * 16 + reg
    const code = latchRegister(chip, reg, data)
    test(`latch/write ${chip} ${reg}`, () => runAssemblyTest(code, data, 0))
  }
}

const lda04a = (chip: number, timer: number) => {
  const X = chip ? "8" : "0"
  const T = timer ? "8" : "4"
  return `
    SEC
    LDA $C${slot}${X}${T}   ; this takes 4 cycles
    SBC $C${slot}${X}${T}
    CLC   ; carry flag is "random" after subtracting the timer countdown
    `.split("\n")
}

const lda04b = (chip: number, timer: number) => {
  const X = chip ? "8" : "0"
  const T = timer ? "8" : "4"
  return `
  LDA #$${X}${T}
  STA $80
  LDA #$C${slot}
  STA $81
  LDY #$0
  SEC
  LDA ($80),Y   ; this takes 5 cycles
  SBC $C${slot}${X}${T}
  CLC   ; carry flag is "random" after subtracting the timer countdown
  `.split("\n")
}

const lda04c = (chip: number, timer: number) => {
  const X = chip ? "8" : "0"
  const T = timer ? "9" : "5"
  return `
      LDY #$FF
      LDA $C${slot}${X}${T}
      STA $00
      NOP
LOOP  DEY
      BNE LOOP
      SEC
      LDA $00
      SBC $C${slot}${X}${T}
      CLC   ; carry flag is "random" after subtracting the timer countdown
`.split("\n")
}

// Test our Timer T1 and T2 counters
for (let chip = 0; chip <= 1; chip++) {
  for (let timer = 0; timer <= 1; timer++) {
    test(`lda04a-${chip}-T${timer + 1}`, () => runAssemblyTest(lda04a(chip, timer), 4, 0))
    test(`lda04b-${chip}-T${timer + 1}`, () => runAssemblyTest(lda04b(chip, timer), 5, 0))
    // There are ~1283 cycles between $C${slot}05 reads, so our high-order counter
    // should go down by 5.
    test(`lda04c-${chip}-T${timer + 1}`, () => runAssemblyTest(lda04c(chip, timer), 5, 0))
  }
}

const pollTimerWithInterruptDisabled = (timer: number) => {
  const L = timer ? "8" : "4"
  const H = timer ? "9" : "5"
  return `
      LDA #$7F
      STA $C${slot}0E   ; disable all VIA interrupts
      STA $C${slot}0D   ; clear all pending interrupt flags
      LDA #$00
      STA $C${slot}0B   ; use timed Timer 2 mode and one-shot Timer 1 mode
      LDA #$08
      STA $C${slot}0${L}
      STZ $C${slot}0${H}   ; load and start the timer
      LDY #$04
LOOP  DEY
      BNE LOOP
      LDA $C${slot}0D   ; poll IFR before a counter read can clear the flag
  `.split("\n")
}

test.each([
  ["Timer 1", 0, 0x40],
  ["Timer 2", 1, 0x20],
])("%s sets its IFR flag while its interrupt is disabled", (_name, timer, flag) => {
  runAssemblyTest(pollTimerWithInterruptDisabled(timer), flag, 0)
})

test("a disabled timer does not clear the other VIA's interrupt", () => {
  resetMockingboard(slot)
  interruptRequest(slot, false)
  runAssemblyTest(`
      SEI
      LDA #$7F
      STA $C40E       ; disable all chip 0 interrupts
      STA $C48E       ; disable all chip 1 interrupts
      LDA #$C0
      STA $C48E       ; enable chip 1 Timer 1 interrupts
      LDA #$20
      STA $C404
      STZ $C405       ; start chip 0 Timer 1 without enabling its interrupt
      LDA #$08
      STA $C484
      STZ $C485       ; start chip 1 Timer 1
      LDY #$20
LOOP  DEY
      BNE LOOP
      LDA $C48D       ; confirm chip 1 still asserts its interrupt
  `.split("\n"), 0xC0, N | I)

  const irqActive = s6502.flagIRQ & (1 << slot)
  interruptRequest(slot, false)
  expect(irqActive).not.toBe(0)
})

const interrupt = (chip: number, timer: number) => {
  const X = chip ? "8" : "0"
  const L = timer ? "8" : "4"
  const H = timer ? "9" : "5"
  const bit = timer ? "A0" : "C0"  // bit 7 (enable) + bit 5 or 6
  const code = `
      JMP SKIP
      BIT $C${slot}${X}${L} ; $2003 read low-order counter to reset the interrupt flag
      PLP
      SEC           ; set flag to get out of our loop early
      PHP
      RTI
SKIP  LDA #$7F      ; turn off all timer enable bits
      STA $C${slot}${X}E
      LDA #$${bit}  ; turn on timer enable bit
      STA $C${slot}${X}E
      LDY #$20      ; Interrupt should fire before this counts down to zero
      LDA #$99
      STA $C${slot}${X}${L}
      STZ $C${slot}${X}${H}   ; transfer both latches into counters and "start" the timer
      CLC
LOOP  DEY        ; 2 + 2 + 3 = 7 cycles for this loop
      BCS DONE   ;
      BNE LOOP   ;
DONE  TYA`
  return code.split("\n")
}

for (let chip = 0; chip <= 1; chip++) {
  for (let timer = 0; timer <= 1; timer++) {
    test(`interrupt-${chip}-T${timer + 1}`, () => {
      // Force our fake ROM's NMI and IRQ vectors to point to our handler
      memory[ROMmemoryStart + 0x3FFA] = 0x03
      memory[ROMmemoryStart + 0x3FFB] = 0x20
      memory[ROMmemoryStart + 0x3FFE] = 0x03
      memory[ROMmemoryStart + 0x3FFF] = 0x20
//      doSetDebug()
      runAssemblyTest(interrupt(chip, timer), 0x0A, C)
    })
  }
}

// --- mb-audit regression tests (upstream issue #364) ---
// Drive the timers directly via handleMockingboard + a few NOPs so the
// cycle-count callback decrements the counters. No CPU IRQ needed.

const slot4 = (reg: number, val: number) => handleMockingboard(0xC400 + reg, val)
const get4 = (reg: number) => memGetSlotROM(slot, reg)

// Run `n` NOPs at $1000 so the per-instruction cycle-count callback runs.
const runNops = (n: number) => {
  const code = parseAssembly(0x1000, Array(n).fill(" NOP"))
  memory.set(code, 0x1000)
  setPC(0x1000)
  for (let i = 0; i < n; i++) processInstruction()
}

test("mb-audit 11:01:01: continuous->one-shot T1 re-fires", () => {
  disablePassRegisters()
  enableMockingboard(true, slot)
  updateAddressTables()
  resetMockingboard(slot)
  interruptRequest(slot, false)
  s6502.flagIRQ = 0

  const ifrT1 = () => (get4(0xD) & 0x40) !== 0
  const fired = () => (get4(0x12) & 0x40) !== 0

  // Setup: T1C=$0404, free-running, IER=T1
  slot4(4, 0x04); slot4(5, 0x04)
  slot4(0xB, 0x40)
  slot4(0xE, 0xC0); slot4(0xE, 0x3F)

  // Wait for the first free-running underflow to set IFR.T1.
  let guard = 0
  while (!ifrT1() && guard++ < 600) runNops(1)
  expect(ifrT1()).toBe(true)
  // In continuous mode the "fired" latch must stay clear so it can re-fire.
  expect(fired()).toBe(false)

  // Switch to one-shot and clear the flag.
  slot4(0xB, 0x00)
  slot4(0xD, 0x40)
  expect(ifrT1()).toBe(false)

  // The one-shot underflow must now fire (this was the mb-audit failure).
  guard = 0
  while (!ifrT1() && guard++ < 600) runNops(1)
  expect(ifrT1()).toBe(true)    // re-fired
  expect(fired()).toBe(true)    // one-shot latch set

  // One-shot fires exactly once: clear the flag, wait, confirm no re-fire.
  slot4(0xD, 0x40)
  runNops(300)
  expect(ifrT1()).toBe(false)   // did NOT re-fire
  interruptRequest(slot, false)
})

test("mb-audit: AY register read-back via ORA (no 'unknown card')", () => {
  disablePassRegisters()
  enableMockingboard(true, slot)
  updateAddressTables()
  resetMockingboard(slot)

  // Init: DDRB/DDRA, AY reset + inactive
  slot4(2, 0x07); slot4(3, 0xFF)
  slot4(0, 0x00); slot4(0, 0x04)
  // Write AY_AFINE (reg 0) = 0xAA: LATCH(reg), INACTIVE, WRITE(data)
  slot4(1, 0x00); slot4(0, 0x07); slot4(0, 0x04)
  slot4(1, 0xAA); slot4(0, 0x06); slot4(0, 0x04)
  expect(memGetSlotROM(slot, 0x20)).toBe(0xAA)   // internal register holds 0xAA

  // Read AY_AFINE (reg 0) back: LATCH(reg), INACTIVE, READ, then read ORA.
  slot4(1, 0x00); slot4(0, 0x07); slot4(0, 0x04)
  slot4(1, 0x00); slot4(0, 0x05)                  // READ latches the value into ORA
  expect(memGetSlotROM(slot, 0x01)).toBe(0xAA)     // ORA now = 0xAA
})

// --- mb-audit T6522_3 (11:03:00) & T6522_4: 6522 timer-counter load timing ---
// chip-6522.a @readT1C expects T1C_L == $F1 after exactly:
//   lda #$FF / sta T1CL / sta T1H   (latch=$FFFF, counter loaded, start)
//   ldy #$00 / sty T1H              (reload counter from latch)
//   jsr @readT1C (6cy)
//   ldy zpTmp2 (3cy) / dey (2cy) / lda CARD_BASE,y (4cy)  -> read T1C_L
//   cmp #$F1
// That is 6+3+2+4 = 15 CPU cycles between the load write and the read. The real
// W65C22 loads the counter as (latch + 1) and decrements once per cycle, so the
// read returns (0x0100 - 15) = $00F1. emu6502 (a passing reference) does exactly
// this (t1c = latch + 1). Loading the plain latch value read one cycle short
// ($F0) -- the mb-audit 11:03:00 failure.

// Run the exact mb-audit subTest #0 sequence against T1 (hOffset=5) or T2
// (hOffset=9) and return the counter-low byte the CPU reads.
const readTimerCounterLow = (hOffset: number) => {
  const lo = (hOffset === 5) ? 4 : 8        // T1CL / T2CL
  disablePassRegisters()
  enableMockingboard(true, slot)
  updateAddressTables()
  resetMockingboard(slot)
  s6502.flagIRQ = 0
  memory[0x00] = hOffset                    // zpTmp2 = H offset; DEY -> counter low

  const main = [
    " LDA #$FF",
    ` STA $C${slot}0${lo}`,                 // T1CL/T2CL = $FF (latch low)
    ` STA $C${slot}0${hOffset}`,            // T1CH/T2CH = $FF (latch high) => latch=$FFFF
    " LDY #$00",
    ` STY $C${slot}0${hOffset}`,            // reload counter from latch
    " JSR $2000",                           // @readT1C
    " RTS",
  ]
  const read = [
    " LDY $00",                            // 3cy: Y = H offset
    " DEY",                                // 2cy: Y = counter low offset
    " LDA $C400,Y",                        // 4cy: read T1C_L / T2C_L
    " RTS",
  ]
  memory.set(parseAssembly(0x1000, main), 0x1000)
  memory.set(parseAssembly(0x2000, read), 0x2000)
  setPC(0x1000)
  for (let i = 0; i < 10; i++) processInstruction()
  return s6502.Accum & 0xff
}

test("mb-audit T6522_3 (11:03:00): T1 counter read == $F1", () => {
  expect(readTimerCounterLow(5)).toBe(0xF1)
})

test("mb-audit T6522_4: T2 counter read == $F1", () => {
  expect(readTimerCounterLow(9)).toBe(0xF1)
})

