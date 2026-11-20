import { doSetMachineName, doSetRunMode, doSetSpeedMode, getExternalMachineState, resetCpuSpeedForTesting } from "./motherboard"
import { getShr, getTextPageAsString } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const DISK_PATH = "C:\\dev\\emu\\ap2\\DISKS\\PITFALLGS.2mg"
const FRAMES = Number(process.env.PITFALL_FRAMES || 6000)
const OUT_DIR = "C:\\dev\\apple2ts\\.tmp-pitfall-frames"

test("pitfall boot probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    doSetSpeedMode(1)
    const data = new Uint8Array(fs.readFileSync(DISK_PATH))
    console.log("image bytes", data.length)
    expect(doSetEmuDriveNewData({
      index: 0, hardDrive: true, drive: 1, filename: "PITFALLGS.2mg", status: "",
      motorRunning: false, diskHasChanges: false, isWriteProtected: false,
      diskData: data, lastAppleWriteTime: 0, cloudData: null,
      writableFileHandle: null, lastLocalFileWriteTime: 0,
    } as DriveProps)).toBe(true)

    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    fs.mkdirSync(OUT_DIR, { recursive: true })

    for (let f = 1; f <= FRAMES; f++) {
      jest.advanceTimersByTime(17)
      if (f % 250 === 0) {
        const shr = getExternalMachineState().shr as Uint8Array
        let lit = 0
        for (let i = 0; i < shr.length; i++) if (shr[i]) lit++
        const text = getTextPageAsString()
        console.log(`frame ${f} lit=${lit} text=${JSON.stringify(text.slice(-100))}`)
      }
      if (f >= 3000 && f % 100 === 0) {
        const shr = getExternalMachineState().shr as Uint8Array
        fs.writeFileSync(`${OUT_DIR}\\shr-${f}.bin`, shr)
      }
    }
    const shr = getShr()
    const scbs = new Set<number>()
    for (let y = 0; y < 200; y++) scbs.add(shr[0x7D00 + y])
    console.log("raw scbs", scbs.size, "lit", Array.from(shr).filter(Boolean).length)
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
