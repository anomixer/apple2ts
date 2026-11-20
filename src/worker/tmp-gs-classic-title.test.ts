import { doSetMachineName, doSetRunMode, doSetSpeedMode, resetCpuSpeedForTesting, getCpuCyclesPerRefresh, iigsSpeedRegister, isIigsSlowMode, getIigsVideoClock } from "./motherboard"
import { doSetEmuDriveNewData, getDriveStateByIndex } from "./devices/drivestate"
import { getIwmReadStats } from "./devices/diskdata"
import { getTextPageAsString } from "./memory"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const runTitle = (path: string, filename: string, speedMode: number, frames: number) => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    doSetSpeedMode(speedMode)
    expect(doSetEmuDriveNewData({
      index: 2,
      hardDrive: false,
      drive: 1,
      filename,
      status: "",
      motorRunning: false,
      diskHasChanges: false,
      isWriteProtected: false,
      diskData: new Uint8Array(fs.readFileSync(path)),
      lastAppleWriteTime: 0,
      cloudData: null,
      writableFileHandle: null,
      lastLocalFileWriteTime: 0,
    } as DriveProps)).toBe(true)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    let framesText = 0
    let framesSlow = 0
    let lastReg = iigsSpeedRegister
    let text = ""
    for (let f = 0; f < frames; f++) {
      jest.advanceTimersByTime(17)
      if (iigsSpeedRegister !== lastReg) {
        lastReg = iigsSpeedRegister
      }
      if (isIigsSlowMode()) framesSlow++
      const current = getTextPageAsString()
      if (current !== text) {
        text = current
        framesText = f + 1
      }
      if ((f % 300 === 299) && f > 0) {
        console.log(`[tick ${filename} speed=${speedMode} f=${f}] reg=${iigsSpeedRegister.toString(16)} slow=${isIigsSlowMode()} slowFrames=${framesSlow} ` +
          `video=${Math.round(getIigsVideoClock() / getCpuCyclesPerRefresh())} lastTextFrame=${framesText} ` +
          `last=${JSON.stringify(text.split("\n").filter((l) => l.trim()).slice(-2))}`)
      }
    }
    const ds = getDriveStateByIndex(2)
    console.log(`[${filename} speed=${speedMode}] frames=${frames} cyclesPerRefresh=${getCpuCyclesPerRefresh()} ` +
      `reg=${iigsSpeedRegister.toString(16)} slow=${isIigsSlowMode()} slowFrames=${framesSlow} ` +
      `motor=${ds.motorRunning} qtr=${ds.quarterTrack} loc=${ds.trackLocation} lastTextFrame=${framesText}`);
    console.log(`[${filename} stats] ${JSON.stringify(getIwmReadStats())}`)
    console.log(`[${filename} screen]\n${text}`)
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}

const paths = {
  cardcat: { path: "C:\\dev\\emu\\ap2\\Card Cat 1.94.dsk", name: "Card Cat 1.94.dsk" },
  miner: { path: "public/disks/Miner2049er.woz", name: "Miner2049er.woz" },
}

test("GS classic Card Cat 1.94 speed 1", () => { runTitle(paths.cardcat.path, paths.cardcat.name, 1, 3000) }, 300000)
test("GS classic Miner 2049er speed 1", () => { runTitle(paths.miner.path, paths.miner.name, 1, 3000) }, 300000)
test("GS classic Miner 2049er speed 0", () => { runTitle(paths.miner.path, paths.miner.name, 0, 3000) }, 300000)

