// Apple IIgs Ensoniq ES5503 ("DOC") emulation tests.
//
// The DOC is reached through $C03C-$C03F (Sound Control / Data / Address Low /
// Address High). Control bit 6 selects RAM mode (wave RAM) vs register mode
// (oscillator registers); control bit 5 auto-increments the address after each
// data access. These tests drive the registers the way real IIgs software does
// and check both the register plumbing and that the synthesizer produces
// non-silent PCM.

import { doSetMachineName } from "./motherboard"
import { memSet24, memGet24 } from "./memory"
import { iigsEnsoniq, ensoniqDocRam } from "./devices/iigs_ensoniq"

const set = (addr: number, value: number) => memSet24(0x000000 + addr, value & 0xff)
const get = (addr: number) => memGet24(0x000000 + addr)

// Write one DOC register. Control bit 6 clear = register mode (oscillator
// registers), bit 6 set = RAM mode (wave RAM). Bit 5 auto-increments.
const writeReg = (reg: number, value: number) => {
  set(0xC03C, 0x00)        // register mode, no auto-increment
  set(0xC03E, reg & 0xff)
  set(0xC03D, value)
}

// Read one DOC register. $C03D is a one-access pipeline (it returns the
// previous latch and fetches the current address), so priming read then data
// read is the correct idiom.
const readReg = (reg: number) => {
  set(0xC03C, 0x00)
  set(0xC03E, reg & 0xff)
  get(0xC03D)      // priming read
  return get(0xC03D)
}

beforeEach(() => {
  doSetMachineName("APPLE2GS")
  iigsEnsoniq.reset()
})

test("DOC registers survive a write/read round trip", () => {
  // Oscillator 0 frequency low/high, volume, then read them back.
  writeReg(0x00, 0x34)
  writeReg(0x20, 0x12)
  expect(readReg(0x00)).toBe(0x34)
  expect(readReg(0x20)).toBe(0x12)
  writeReg(0x40, 0x40)
  expect(readReg(0x40)).toBe(0x40)
  // Wave table pointer high byte is a plain readback of what was written.
  writeReg(0x80, 0x20)
  expect(readReg(0x80)).toBe(0x20)
  // The $C0 register packs bank/size/resolution - check the fields survive.
  writeReg(0xc0, 0x40 | (3 << 3) | 5)
  expect(readReg(0xc0) & 0x40).toBe(0x40)
  expect((readReg(0xc0) >> 3) & 7).toBe(3)
  expect(readReg(0xc0) & 7).toBe(5)
})

test("DOC wave RAM mode with auto-increment writes a block", () => {
  set(0xC03C, 0x40 | 0x20)  // RAM mode + auto-increment
  set(0xC03E, 0x10)         // address low  = $10
  set(0xC03F, 0x02)         // address high = $02  => $0210
  for (let i = 0; i < 16; i++) {
    set(0xC03D, 0x40 + i)
  }
  for (let i = 0; i < 16; i++) {
    expect(ensoniqDocRam[0x0210 + i]).toBe(0x40 + i)
  }
  // Address auto-incremented to $0220.
  expect(get(0xC03E)).toBe(0x20)
  expect(get(0xC03F)).toBe(0x02)
})

test("enabling 32 oscillators is visible in the oscillator-enable register", () => {
  writeReg(0xe1, 0x3e)  // ((0x3e >> 1) & 0x1f) + 1 = 32
  expect(readReg(0xe1)).toBe(0x3e)
  expect(iigsEnsoniq.osce).toBe(32)
})

test("a keyed-on oscillator with wave RAM produces audible PCM", () => {
  // Fill a small sawtooth-ish waveform into the first 256 bytes of wave RAM.
  set(0xC03C, 0x40 | 0x20)
  set(0xC03E, 0x00)
  set(0xC03F, 0x00)
  for (let i = 0; i < 256; i++) {
    // A zero byte in wave RAM halts the oscillator (real DOC behaviour), so the
    // waveform has to stay non-zero throughout.
    set(0xC03D, i + 1)
  }
  // Oscillator 0: wave size 256 (size 0), resolution 8-bit (0).
  writeReg(0xc0, 0x00)
  // Wave pointer at $0000, full volume, channel select L.
  writeReg(0x80, 0x00)
  writeReg(0x40, 0xff)
  writeReg(0x00, 0x40)   // freq lo
  writeReg(0x20, 0x00)   // freq hi -> $0040
  // control bit0 = 1 halts; clearing it starts the oscillator.
  writeReg(0xa0, 0x01)
  expect(iigsEnsoniq.hasActiveOscillators()).toBe(false)
  writeReg(0xa0, 0x00)   // bit4 = 0 selects (per achan mapping) channel 1
  expect(iigsEnsoniq.hasActiveOscillators()).toBe(true)

  const pcm = iigsEnsoniq.generateSamples(512)
  expect(pcm.length).toBe(1024)
  let peak = 0
  let nonzero = 0
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i])
    if (v > 0) nonzero++
    if (v > peak) peak = v
  }
  expect(nonzero).toBeGreaterThan(0)
  expect(peak).toBeGreaterThan(0)
})

// gssquared soundglu.cpp ensoniq_mirror_mono_to_stereo: mono software usually
// parks every voice on one channel (often 0 / right), so only one output side
// gets energy. The built-in IIgs speaker plays a mix of both channels, so a
// same-CA0 chorus must be mirrored onto L and R.
test("mono voices are mirrored onto both L and R", () => {
  set(0xC03C, 0x40 | 0x20)
  set(0xC03E, 0x00)
  set(0xC03F, 0x00)
  for (let i = 0; i < 256; i++) {
    set(0xC03D, i + 1)
  }
  writeReg(0xc0, 0x00)
  writeReg(0x80, 0x00)
  writeReg(0x40, 0xff)
  writeReg(0x00, 0x40)
  writeReg(0x20, 0x00)
  // CA0=0 -> assigned 0 but flipped to right(1) by the odd/even mapping.
  writeReg(0xa0, 0x00)
  expect(iigsEnsoniq.hasActiveOscillators()).toBe(true)

  const pcm = iigsEnsoniq.generateSamples(512)
  let leftNonzero = false
  let rightNonzero = false
  for (let s = 0; s < 512; s++) {
    expect(pcm[s * 2]).toBe(pcm[s * 2 + 1])
    if (pcm[s * 2] !== 0) leftNonzero = true
    if (pcm[s * 2 + 1] !== 0) rightNonzero = true
  }
  expect(leftNonzero).toBe(true)
  expect(rightNonzero).toBe(true)
})

// Once voices genuinely sit on different channels the DOC is delivering real
// stereo and L/R must be left alone.
test("true stereo is left untouched by the mono mirror", () => {
  set(0xC03C, 0x40 | 0x20)
  set(0xC03E, 0x00)
  set(0xC03F, 0x00)
  for (let i = 0; i < 256; i++) {
    set(0xC03D, i + 1)
  }
  // Two enabled oscillators (register $E1 value 2 -> osce 2), CA0 split across
  // them, different volumes so the channels are provably different.
  writeReg(0xe1, 0x02)
  writeReg(0xc0, 0x00)
  writeReg(0xc1, 0x00)
  writeReg(0x80, 0x00)
  writeReg(0x81, 0x00)
  writeReg(0x40, 0xff)
  writeReg(0x41, 0x80)
  writeReg(0x00, 0x40)
  writeReg(0x20, 0x00)
  writeReg(0x01, 0x40)
  writeReg(0x21, 0x00)
  writeReg(0xa0, 0x10)   // CA0=1 -> left(0)
  writeReg(0xa1, 0x00)   // CA0=0 -> right(1)
  expect(iigsEnsoniq.hasActiveOscillators()).toBe(true)

  const pcm = iigsEnsoniq.generateSamples(512)
  let leftNonzero = false
  let rightNonzero = false
  let differs = false
  for (let s = 0; s < 512; s++) {
    if (pcm[s * 2] !== 0) leftNonzero = true
    if (pcm[s * 2 + 1] !== 0) rightNonzero = true
    if (pcm[s * 2] !== pcm[s * 2 + 1]) differs = true
  }
  expect(leftNonzero).toBe(true)
  expect(rightNonzero).toBe(true)
  expect(differs).toBe(true)
})

test("a halted oscillator produces silence", () => {
  set(0xC03C, 0x40 | 0x20)
  set(0xC03E, 0x00)
  set(0xC03F, 0x00)
  for (let i = 0; i < 256; i++) {
    set(0xC03D, 0x80)
  }
  writeReg(0xc0, 0x00)
  writeReg(0x80, 0x00)
  writeReg(0x40, 0xff)
  writeReg(0x00, 0x40)
  writeReg(0x20, 0x00)
  writeReg(0xa0, 0x01)  // halted
  expect(iigsEnsoniq.hasActiveOscillators()).toBe(false)
  const pcm = iigsEnsoniq.generateSamples(256)
  for (let i = 0; i < pcm.length; i++) {
    expect(pcm[i]).toBe(0)
  }
})

test("$C03D reads are pipelined: priming read then data read", () => {
  // Wave RAM at $0200/$0201 hold two distinct values.
  set(0xC03C, 0x40)          // RAM mode, no auto-increment
  set(0xC03E, 0x00)
  set(0xC03F, 0x02)
  set(0xC03D, 0x11)
  set(0xC03E, 0x01)
  set(0xC03D, 0x22)

  // Priming read returns the previous latch, and fetches $0200.
  set(0xC03E, 0x00)
  const priming = get(0xC03D)
  expect(priming).toBe(0x22)
  // Data read returns what the priming read latched.
  expect(get(0xC03D)).toBe(0x11)

  // Same for $0201.
  set(0xC03E, 0x01)
  expect(get(0xC03D)).toBe(0x11)
  expect(get(0xC03D)).toBe(0x22)
})

test("sound control low nibble is the analog system volume", () => {
  set(0xC03C, 0x0f)  // full volume
  expect(iigsEnsoniq.systemVolume).toBeCloseTo(1)
  set(0xC03C, 0x00)  // mute
  expect(iigsEnsoniq.systemVolume).toBeCloseTo(0)
  // A read never reports busy, and bit 7 is not echoed back.
  expect(get(0xC03C) & 0x80).toBe(0)
})

test("reading $E0 acknowledges a pending oscillator interrupt", () => {
  // Oscillator 3 with interrupt enable (control bit3) and its wave RAM empty,
  // so the next sample sees a zero byte and halts with an IRQ pending.
  writeReg(0xc0, 0x00)
  writeReg(0x80, 0x00)
  writeReg(0x40, 0xff)
  writeReg(0x00, 0x40)
  writeReg(0x20, 0x00)
  writeReg(0xa0, 0x09)  // halt bit set, IRQ enable (bit 3) set
  writeReg(0xa0, 0x08)  // start: halt bit clear, IRQ still enabled
  // Wave RAM is all zero at reset, so a zero byte halts and pends the IRQ.
  iigsEnsoniq.generateSamples(8)
  expect(iigsEnsoniq.irqPending()).toBe(true)
  // $E0 reports and clears it.
  const e0 = readReg(0xe0)
  expect(e0 & 0x41).toBe(0x41)
  expect(iigsEnsoniq.irqPending()).toBe(false)
})