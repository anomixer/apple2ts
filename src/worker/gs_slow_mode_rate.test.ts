import {
  doSetMachineName, doSetRunMode, doSetSpeedMode, getCPU, getIigsBeamFrameCount,
  getIigsCpuCyclesPerRefresh, iigsSpeedRegister, isIigsSlowMode, resetCpuSpeedForTesting, setIigsSpeedRegister,
} from "./motherboard"
import { memSet } from "./memory"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"

// $C036 bit 7 is not just a guest-visible latch. On real hardware a 0 in bit 7
// drops the machine to the 1.020484 MHz "slow" clock: one CPU cycle per video
// cycle, so a 17030-video-cycle frame holds ~17030 CPU cycles instead of the
// ~46727 the Settings speed budget allows. The IIgs run loop has to honour that
// or software that depends on the 1 MHz timing (the XMAS demo polls $C02F for a
// $46 window that only exists at 1 MHz) misbehaves even though the register
// reads back correctly. gssquared models the same thing in NClockIIgs
// (`c_14M_per_cpu_cycle = 14` while slow), which is why this test pins it.

const FRAMES = 20

const measureCyclesPerFrame = (fast: boolean) => {
  doSetMachineName("APPLE2GS")
  doSetSpeedMode(1) // 2.8 MHz settings: 46727 cycles per refresh
  doSetRunMode(RUN_MODE.NEED_BOOT)
  doSetRunMode(RUN_MODE.RUNNING, false)

  // The frame budget is filled by whatever code the guest happens to run, so no
  // particular program is needed: all that matters is how many cycles the run
  // loop hands the CPU in one refresh. The boot ROM writes $C036 itself while it
  // scans for a startup device, so the latch is re-asserted before every
  // instruction - this measures the run loop's response to the latch, which is
  // the hardware behaviour under test, not the ROM's own bookkeeping.
  const cpu = getCPU() as unknown as { processInstruction: (cb?: unknown) => number }
  const latch = fast ? 0x84 : 0x04
  setIigsSpeedRegister(latch)

  const firstFrame = getIigsBeamFrameCount()
  let cycles = 0
  let instructions = 0
  const orig = cpu.processInstruction.bind(cpu)
  cpu.processInstruction = (cb?: unknown) => {
    if (iigsSpeedRegister !== latch) setIigsSpeedRegister(latch)
    const c = orig(cb)
    cycles += c
    instructions++
    return c
  }
  try {
    for (let f = 0; f < FRAMES; f++) jest.advanceTimersByTime(17)
  } finally {
    cpu.processInstruction = orig
  }
  const frames = getIigsBeamFrameCount() - firstFrame
  doSetRunMode(RUN_MODE.PAUSED, false)
  resetCpuSpeedForTesting()
  return { cycles: cycles / frames, instructions: instructions / frames, frames }
}

describe("Apple IIgs $C036 slow mode changes the real CPU rate", () => {
  beforeEach(() => {
    setIsTesting()
    jest.useFakeTimers()
  })

  afterEach(() => {
    doSetRunMode(RUN_MODE.PAUSED, false)
    doSetMachineName("APPLE2EE")
    doSetSpeedMode(0)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  })

  test("the effective cycle budget follows $C036 bit 7, not the Settings speed", () => {
    doSetMachineName("APPLE2GS")
    doSetSpeedMode(1)

    memSet(0xC036, 0x84)
    expect(isIigsSlowMode()).toBe(false)
    expect(getIigsCpuCyclesPerRefresh()).toBe(46727)

    memSet(0xC036, 0x04)
    expect(isIigsSlowMode()).toBe(true)
    expect(getIigsCpuCyclesPerRefresh()).toBe(17030)

    memSet(0xC036, 0xC4)
    expect(isIigsSlowMode()).toBe(false)
    expect(getIigsCpuCyclesPerRefresh()).toBe(46727)
  })

  test("a classic machine keeps its configured budget whatever $C036 says", () => {
    doSetMachineName("APPLE2EE")
    doSetSpeedMode(1)
    expect(getIigsCpuCyclesPerRefresh()).toBe(34060)
    memSet(0xC036, 0x04)
    expect(getIigsCpuCyclesPerRefresh()).toBe(34060)
  })

  test("a slow-mode refresh runs 17030 cycles while a fast refresh runs 46727", () => {
    const fast = measureCyclesPerFrame(true)
    const slow = measureCyclesPerFrame(false)

    // The video beam keeps its hardware rate in both modes: 17030 video cycles
    // per refresh, i.e. exactly one emulated frame per refresh.
    expect(fast.frames).toBeGreaterThanOrEqual(FRAMES)
    expect(slow.frames).toBeGreaterThanOrEqual(FRAMES)

    expect(fast.cycles).toBeGreaterThan(46727 * 0.98)
    expect(fast.cycles).toBeLessThan(46727 * 1.02)
    expect(slow.cycles).toBeGreaterThan(17030 * 0.98)
    expect(slow.cycles).toBeLessThan(17030 * 1.02)

    // Fewer CPU cycles per refresh is a lower instruction throughput, which is
    // what makes the slow clock observable to the guest.
    expect(slow.instructions / fast.instructions).toBeLessThan(0.45)
  })
})
