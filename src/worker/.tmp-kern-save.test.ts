import { doSetMachineName, doSetRunMode, resetCpuSpeedForTesting } from "./motherboard"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { doGetSaveState } from "./save_restore"
import { RUN_MODE, SAVE_STATE_VERSION } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const DISK_PATH = process.env.KERN_PATH || "C:\\dev\\emu\\ap2\\DISKS\\Kernkompetenz.2mg"
const OUT = "C:\\dev\\apple2ts\\.tmp-kern-cube-apex.a2ts"

test("save Kernkompetenz just before the clipped cube", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    const data = new Uint8Array(fs.readFileSync(DISK_PATH))
    expect(doSetEmuDriveNewData({
      index: 4, hardDrive: false, drive: 1, filename: "Kernkompetenz.2mg", status: "",
      motorRunning: false, diskHasChanges: false, isWriteProtected: false,
      diskData: data, lastAppleWriteTime: 0, cloudData: null,
      writableFileHandle: null, lastLocalFileWriteTime: 0,
    } as DriveProps)).toBe(true)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    for (let f = 1; f <= 6120; f++) {
      jest.advanceTimersByTime(17)
    }
    const state = doGetSaveState(true)
    state.emulator = {
      name: "Apple2TS Emulator",
      date: new Date().toISOString(),
      version: SAVE_STATE_VERSION,
      runMode: RUN_MODE.RUNNING,
      speedMode: 0,
      breakpoints: "[]"
    }
    fs.writeFileSync(OUT, JSON.stringify(state, null, 2))
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
