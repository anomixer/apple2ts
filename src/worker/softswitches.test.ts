import { doSetRom, memGet, memGetC000, memSet, memSetC000, memoryReset } from "./memory"
import { getSoftSwitchDescriptions, resetSoftSwitches, setVideo7Override, SWITCHES } from "./softswitches"

const video7Modes: Array<[Video7Mode, keyof typeof SWITCHES]> = [
  ["160x192", "VIDEO7_160"],
  ["monochrome", "VIDEO7_MONO"],
  ["mixed", "VIDEO7_MIXED"],
]

const expectVideo7Mode = (selected: Video7Mode | null) => {
  for (const [mode, switchName] of video7Modes) {
    expect(SWITCHES[switchName].isSet).toBe(mode === selected)
  }
}

const access = (address: number) => memGet(address)

const resetVideo7TestState = () => {
  memoryReset()
  resetSoftSwitches()
  memSet(0xC001, 0) // 80STORE on so AN3 clocks Video-7 state
  for (let i = 0; i < 2; i++) {
    memSet(0xC00D, 0) // 80COL on: clock a zero
    access(0xC05E) // AN3 off
    access(0xC05F) // AN3 on
  }
  resetSoftSwitches()
}

beforeEach(resetVideo7TestState)

test.each([
  ["reads", (address: number) => memGet(address)],
  ["writes", (address: number) => memSet(address, 0)],
])("CPU %s to $C078-$C07D do not select Video-7 modes", (_name, cpuAccess) => {
  const unknownSwitch = jest.spyOn(console, "error").mockImplementation()
  try {
    for (let address = 0xC078; address <= 0xC07D; address++) {
      cpuAccess(address)
      expectVideo7Mode(null)
      for (const [mode] of video7Modes) {
        setVideo7Override(mode, true)
        cpuAccess(address)
        expectVideo7Mode(mode)
        setVideo7Override(mode, false)
      }
    }
  } finally {
    unknownSwitch.mockRestore()
  }
})

test("the documented AN3/80COL sequence selects Video-7 monochrome mode", () => {
  memSet(0xC001, 0) // 80STORE on
  memSet(0xC00C, 0) // 80COL off
  access(0xC05E) // AN3 off
  access(0xC05F) // AN3 on: clock 1
  access(0xC05E) // AN3 off
  access(0xC05F) // AN3 on: clock 1
  memSet(0xC00D, 0) // 80COL on
  access(0xC05E) // AN3 off

  expectVideo7Mode("monochrome")
})

test("the documented AN3/80COL sequence selects Video-7 mixed mode", () => {
  memSet(0xC001, 0) // 80STORE on
  memSet(0xC00C, 0) // 80COL off
  access(0xC05E) // AN3 off
  access(0xC05F) // AN3 on: clock 1
  memSet(0xC00D, 0) // 80COL on
  access(0xC05E) // AN3 off
  access(0xC05F) // AN3 on: clock 0
  access(0xC05E) // AN3 off

  expectVideo7Mode("mixed")
})

test("the documented AN3/80COL sequence selects Video-7 160x192 mode", () => {
  memSet(0xC001, 0) // 80STORE on
  memSet(0xC00C, 0) // 80COL off
  access(0xC05E) // AN3 off
  access(0xC05F) // AN3 on: clock 1

  expectVideo7Mode("160x192")
})

test("A2DeskTop SetColorMode resets Video-7 monochrome mode even when 80STORE is off", () => {
  // First, set monochrome mode
  memSet(0xC00C, 0) // 80COL off
  access(0xC05E) // AN3 off
  access(0xC05F) // AN3 on: clock 1
  access(0xC05E) // AN3 off
  access(0xC05F) // AN3 on: clock 1
  expectVideo7Mode("monochrome")

  // Simulate A2DeskTop RestoreSystem exiting:
  // Ctrl-U turns off 80STORE
  memSet(0xC000, 0) // 80STORE off
  // SetColorMode (sta SET80VID; sta AN3_OFF; sta AN3_ON; sta AN3_OFF; sta AN3_ON; sta DHIRESON)
  memSet(0xC00D, 0) // 80COL on
  access(0xC05E) // AN3 off
  access(0xC05F) // AN3 on: clock 0
  access(0xC05E) // AN3 off
  access(0xC05F) // AN3 on: clock 0
  access(0xC05E) // AN3 off / DHIRESON

  expectVideo7Mode(null)
})

test.each(video7Modes)("the debugger can override %s without a CPU address", (mode, switchName) => {
  setVideo7Override(mode, true)
  expect(SWITCHES[switchName].isSet).toBe(true)

  setVideo7Override(mode, false)
  expect(SWITCHES[switchName].isSet).toBe(false)
})

test("soft-switch discovery does not advertise internal Video-7 overrides", () => {
  const descriptions = getSoftSwitchDescriptions()
  for (let address = 0xC078; address <= 0xC07D; address++) {
    expect(descriptions[address]).toBeUndefined()
  }
})

test("$C07x returns random noise", () => {
  for (let addr = 0xC070; addr <= 0xC07F; addr++) {
    let minn = 0xFF
    let maxx = 0x00
    for (let i = 0; i < 1000; i++) {
      // Mess up the joystick timer
      memSetC000(0xC064, 0)
      const v = memGet(addr)
      // Make sure joystick timer was reset
      expect(memGetC000(0xC064)).toBe(0x80)
      minn = Math.min(v, minn)
      maxx = Math.max(v, maxx)
    }
    // After 1000 random values we expect the min/max to cover almost the full range
    expect(minn).toBeLessThanOrEqual(0x10)
    expect(maxx).toBeGreaterThanOrEqual(0xA0)
  }
})

// The IIgs drives $C019 bit 7 high *while* vertical blanking is active, the
// opposite of the IIe's "high after blanking ends" (gssquared display_read_vbl).
// Its ROM depends on that: the X-MAS Demo's frame sync waits on $C019 bit 7 and
// was otherwise left a half-frame out of phase, holding IRQs off across the
// visible field so the marquee stopped once the decrunch finished. No other
// status switch inverts, so the IIgs must keep the IIe sense for $C011-$C01F.
describe("IIgs status switches", () => {
  const onIigs = (fn: () => void) => {
    try {
      doSetRom("APPLE2GS")
      fn()
    } finally {
      doSetRom("APPLE2EE")
    }
  }

  test("$C019 reads vertical blanking as active-high", () => {
    onIigs(() => {
      // VBLINV is the *inverse* status bit: the run loop sets it when vertical
      // blanking ends, so a set switch means the beam is in the visible field.
      SWITCHES.VBLINV.isSet = true
      expect(memGet(0xC019) & 0x80).toBe(0x00)
      SWITCHES.VBLINV.isSet = false
      expect(memGet(0xC019) & 0x80).toBe(0x80)
    })
    // The IIe keeps the classic sense, which motherboard.test.ts asserts against
    // the live run loop: within VBL (VBLINV clear) bit 7 reads as zero.
    SWITCHES.VBLINV.isSet = false
    expect(memGet(0xC019) & 0x80).toBe(0x00)
    SWITCHES.VBLINV.isSet = true
    expect(memGet(0xC019) & 0x80).toBe(0x80)
  })

  test("only $C019 inverts on the IIgs; the other status bits keep the IIe sense", () => {
    const statusSwitches: Array<[keyof typeof SWITCHES, number]> = [
      ["BSRBANK2", 0xC011], ["BSRREADRAM", 0xC012], ["AUXRAMREAD", 0xC013],
      ["AUXRAMWRITE", 0xC014], ["INTCXROM", 0xC015], ["ALTZP", 0xC016],
      ["SLOTC3ROM", 0xC017], ["STORE80", 0xC018], ["TEXT", 0xC01A],
      ["MIXED", 0xC01B], ["PAGE2", 0xC01C], ["HIRES", 0xC01D],
      ["ALTCHARSET", 0xC01E], ["COLUMN80", 0xC01F],
    ]
    onIigs(() => {
      for (const [name, addr] of statusSwitches) {
        SWITCHES[name].isSet = false
        expect(memGet(addr) & 0x80).toBe(0x00)
        SWITCHES[name].isSet = true
        expect(memGet(addr) & 0x80).toBe(0x80)
      }
      // $C016 is the one the IIgs ROM's interrupt dispatcher reads
      // ($FF:B897 LDX $C016 / BPL): bit 7 must follow ALTZP.
      memSet(0xC008, 0) // ALTZP off
      expect(SWITCHES.ALTZP.isSet).toBe(false)
      expect(memGet(0xC016) & 0x80).toBe(0x00)
      memSet(0xC009, 0) // ALTZP on
      expect(SWITCHES.ALTZP.isSet).toBe(true)
      expect(memGet(0xC016) & 0x80).toBe(0x80)
      memSet(0xC008, 0) // ALTZP off again
      expect(memGet(0xC016) & 0x80).toBe(0x00)
    })
  })
})
