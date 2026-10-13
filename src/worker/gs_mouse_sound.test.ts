import { doSetMachineName, doSetRunMode, resetCpuSpeedForTesting } from "./motherboard"
import { memSet24 } from "./memory"
import { iigsADB } from "./iigs_adb"
import { MouseCardEvent, resetMouse } from "./devices/mouse"
import { RUN_MODE } from "../common/utility"
import { setIsTesting, getSpeakerClickCount, resetSpeakerClickCount } from "./worker2main"

// The Apple IIgs has no mouse card: the mouse hangs off the ADB bus. Verify UI
// mouse events actually reach iigsADB (before this, MOUSEEVENT messages were
// only ever fed to the 6522 mouse card, so the Finder cursor never moved).
test("IIgs UI mouse events reach the ADB bus", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    resetMouse()
    // iigsADB is a module singleton, so clear any motion a previous test left.
    iigsADB.reset()

    const adb = iigsADB as unknown as {
      mouseButton: boolean, hasMouseData: () => boolean, readMouseData: () => number
    }
    // Consume one full report: the X byte then the Y byte.
    const readReport = () => {
      const x = adb.readMouseData()
      const y = adb.readMouseData()
      return {
        x: x & 0x3f, y: y & 0x3f,
        xNeg: (x & 0x40) !== 0, yNeg: (y & 0x40) !== 0,
        buttonUp: (x & 0x80) !== 0,
      }
    }
    expect(adb.hasMouseData()).toBe(false)

    // First report only establishes the baseline - a delta from an unknown
    // origin would jump the pointer into a corner.
    MouseCardEvent({ x: 0.5, y: 0.5, buttons: -1 })
    expect(adb.hasMouseData()).toBe(false)

    // Moving right and down must produce a positive report for the OS to read.
    MouseCardEvent({ x: 0.6, y: 0.6, buttons: -1 })
    expect(adb.hasMouseData()).toBe(true)
    const fwd = readReport()
    expect(fwd.x).toBeGreaterThan(0)
    expect(fwd.y).toBeGreaterThan(0)
    expect(fwd.xNeg).toBe(false)
    expect(fwd.yNeg).toBe(false)
    expect(fwd.buttonUp).toBe(true)

    // Moving back must set the direction bits and report the same magnitude.
    MouseCardEvent({ x: 0.5, y: 0.5, buttons: -1 })
    const back = readReport()
    expect(back.x).toBe(fwd.x)
    expect(back.y).toBe(fwd.y)
    expect(back.xNeg).toBe(true)
    expect(back.yNeg).toBe(true)

    // A button press has to register too: bit 7 of the report clears.
    MouseCardEvent({ x: 0, y: 0, buttons: 0x10 })
    expect(adb.mouseButton).toBe(true)
    expect(readReport().buttonUp).toBe(false)
    MouseCardEvent({ x: 0, y: 0, buttons: 0x00 })
    expect(adb.mouseButton).toBe(false)
    expect(readReport().buttonUp).toBe(true)

    // A reset drops the tracking baseline, so the next report only
    // re-establishes it instead of jumping the cursor into a corner.
    resetMouse()
    MouseCardEvent({ x: 0.9, y: 0.9, buttons: -1 })
    expect(adb.hasMouseData()).toBe(false)
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
})

// The IIgs $C020-$C04F range short-circuits the normal softswitch path in
// memSet24, so $C030 never reached the speaker unless it was handled
// explicitly - which is why the IIgs was silent.
test("IIgs $C030 speaker click reaches the audio output", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    // Stay PAUSED so the power-on self-test is not still driving $C030 while we
    // measure.
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetSpeakerClickCount()
    expect(getSpeakerClickCount()).toBe(0)
    // Toggle $C030 a handful of times, exactly as software does.
    for (let i = 0; i < 5; i++) memSet24(0xC030, i & 1)
    expect(getSpeakerClickCount()).toBe(5)
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
})
