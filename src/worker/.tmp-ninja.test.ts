import { doSetMachineName, doSetRunMode, doSetSpeedMode, getExternalMachineState, resetCpuSpeedForTesting } from "./motherboard"
import { getTextPageAsString } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const DISK_PATH = "C:\\dev\\emu\\ap2\\DISKS\\NinjaTracker.2mg"
const OUT_DIR = "C:\\dev\\apple2ts\\.tmp-ninja"

test("ninja tracker boot probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    doSetSpeedMode(1)
    expect(doSetEmuDriveNewData({
      index: 4, hardDrive: false, drive: 1, filename: "NinjaTracker.2mg", status: "",
      motorRunning: false, diskHasChanges: false, isWriteProtected: false,
      diskData: new Uint8Array(fs.readFileSync(DISK_PATH)), lastAppleWriteTime: 0,
      cloudData: null, writableFileHandle: null, lastLocalFileWriteTime: 0,
    } as DriveProps)).toBe(true)

    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    fs.mkdirSync(OUT_DIR, { recursive: true })

    for (let f = 1; f <= 5000; f++) {
      jest.advanceTimersByTime(17)
      if (f % 500 === 0) {
        const text = getTextPageAsString()
        fs.writeFileSync(`${OUT_DIR}\\text-${f}.bin`, Uint8Array.from(text, (c) => c.charCodeAt(0)))
        const state = getExternalMachineState()
        fs.writeFileSync(`${OUT_DIR}\\shr-${f}.bin`, state.shr as Uint8Array)
        console.log(`frame ${f} run=${state.runMode} text=${JSON.stringify(text.slice(0, 80))}`)
      }
    }
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
