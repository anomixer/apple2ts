import { doSetMachineName, doSetRunMode, doSetSpeedMode, resetCpuSpeedForTesting, getCpuCyclesPerRefresh, iigsSpeedRegister, isIigsSlowMode, getIigsVideoClock, setIigsSpeedRegister } from "./motherboard"
import { doSetEmuDriveNewData, getDriveStateByIndex } from "./devices/drivestate"
import { getIwmReadStats } from "./devices/diskdata"
import { memory } from "./memory"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const DISK_PATH = "public/disks/CT_SPEEDTEST.DSK"

const screenText = () => {
  const lines: string[] = []
  for (let row = 0; row < 24; row++) {
    let line = ""
    const base = 0x400 + (row % 8) * 0x80 + Math.floor(row / 8) * 0x28
    for (let col = 0; col < 40; col++) {
      const ch = memory[base + col] & 0x7F
      line += (ch >= 32 && ch < 127) ? String.fromCharCode(ch) : " "
    }
    if (line.trim().length > 0) lines.push(line.replace(/\s+$/, ""))
  }
  return lines.join("\n")
}

const scenario = (speedMode: number, frames: number, checkpoints: boolean, forcedSpeedReg?: number) => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    doSetSpeedMode(speedMode)
    const cyclesPerRefresh = getCpuCyclesPerRefresh()
    expect(doSetEmuDriveNewData({
      index: 2,
      hardDrive: false,
      drive: 1,
      filename: "CT_SPEEDTEST.DSK",
      status: "",
      motorRunning: false,
      diskHasChanges: false,
      isWriteProtected: false,
      diskData: new Uint8Array(fs.readFileSync(DISK_PATH)),
      lastAppleWriteTime: 0,
      cloudData: null,
      writableFileHandle: null,
      lastLocalFileWriteTime: 0,
    } as DriveProps)).toBe(true)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    const t0 = Date.now()
    for (let f = 0; f < frames; f++) {
      if (forcedSpeedReg !== undefined && f > 0) setIigsSpeedRegister(forcedSpeedReg)
      jest.advanceTimersByTime(17)
      if (checkpoints && (f % 300 === 299)) {
        console.log(`[checkpoint speed=${speedMode} f=${f}] speedReg=${iigsSpeedRegister.toString(16)} slow=${isIigsSlowMode()} ` +
          `video=${Math.round(getIigsVideoClock() / (speedMode === 0 ? 17030 : 46727))} screen=${JSON.stringify(screenText().split("\n").slice(-2))} ` +
          `stats=${JSON.stringify(getIwmReadStats())}`)
      }
    }
    const elapsedMs = Date.now() - t0
    const ds = getDriveStateByIndex(2)
    console.log(`[GS classic S6 speed=${speedMode} cyclesPerRefresh=${cyclesPerRefresh} frames=${frames} ms=${elapsedMs}] ` +
      `drive=${ds.filename} motor=${ds.motorRunning} qtr=${ds.quarterTrack} loc=${ds.trackLocation}`)
    console.log(`[stats] ${JSON.stringify(getIwmReadStats())}`)
    console.log("SCREEN:\n" + screenText())
    return screenText().includes("S6,D1:/SPEEDTEST")
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}

test("GS classic S6 speed 0", () => {
  expect(scenario(0, 1500, true)).toBe(true)
}, 180000)

test("GS classic S6 speed 1", () => {
  expect(scenario(1, 1500, true)).toBe(true)
}, 180000)

test("GS classic S6 speed 1 with guest slow mode", () => {
  expect(scenario(1, 1500, true, 0x04)).toBe(true)
}, 180000)
