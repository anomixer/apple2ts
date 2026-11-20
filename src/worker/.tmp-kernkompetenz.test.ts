import { doSetMachineName, doSetRunMode, resetCpuSpeedForTesting } from "./motherboard"
import { getShr, getShrCompletedDisplay, getShrDisplayed, getTextPageAsString } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

// Offline reproduction of the Kernkompetenz SHR scene. The disk is an 800 KB
// ProDOS volume mounted on the IIgs's slot-5 3.5" drive (index 4), which is how
// the browser deep link loads it. Dump the beam-captured picture and the raw
// window together so the clipping can be traced to the guest's bytes or to the
// renderer.
const DISK_PATH = process.env.KERN_PATH || "C:\\dev\\emu\\ap2\\DISKS\\Kernkompetenz.2mg"
const OUT_DIR = "C:\\dev\\apple2ts\\.tmp-kern-frames"
const FRAMES = Number(process.env.KERN_FRAMES || 4200)
const START = Number(process.env.KERN_START || 1000)
const STEP = Number(process.env.KERN_STEP || 20)

const hash = (a: Uint8Array) => {
  let h = 2166136261
  for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) }
  return h >>> 0
}

test("kernkompetenz frame probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true })
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

    for (let f = 1; f <= FRAMES; f++) {
      jest.advanceTimersByTime(17)
      if (f >= START && f % STEP === 0) {
        const shown = getShrDisplayed()
        const complete = getShrCompletedDisplay()
        const raw = getShr()
        fs.writeFileSync(`${OUT_DIR}\\shown-${f}.bin`, shown)
        fs.writeFileSync(`${OUT_DIR}\\complete-${f}.bin`, complete)
        fs.writeFileSync(`${OUT_DIR}\\raw-${f}.bin`, raw)
        const sh = hash(shown)
        const rh = hash(raw)
        console.log(`frame ${f} shown=${sh} raw=${rh} text=${JSON.stringify(getTextPageAsString().slice(-60))}`)
      }
    }
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
