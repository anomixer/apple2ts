import { doSetMachineName, doSetRunMode, doSetSpeedMode, getExternalMachineState, resetCpuSpeedForTesting } from "./motherboard"
import { getShr, getTextPageAsString } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const SYSTEM = "C:/dev/emu/ap2/DISKS/GSOS601.po"
const MERLIN = "C:/dev/emu/ap2/DISKS/merlin 16+ v4.68 (1989)(roger wagner publishing)(disk 1 of 3).2mg"
const OUT_DIR = "C:/dev/apple2ts/.tmp-merlin-swap"

const mount = (index: number, drive: number, path: string) =>
  doSetEmuDriveNewData({
    index, hardDrive: false, drive, filename: path.split("/").pop()!, status: "",
    motorRunning: false, diskHasChanges: false, isWriteProtected: false,
    diskData: new Uint8Array(fs.readFileSync(path)), lastAppleWriteTime: 0,
    cloudData: null, writableFileHandle: null, lastLocalFileWriteTime: 0,
  } as DriveProps)

test("merlin swap probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    doSetSpeedMode(1)
    expect(mount(4, 1, SYSTEM)).toBe(true)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    fs.mkdirSync(OUT_DIR, { recursive: true })
    for (let f = 1; f <= 4200; f++) jest.advanceTimersByTime(17)
    expect(mount(4, 1, MERLIN)).toBe(true)
    for (let f = 4201; f <= 4800; f++) {
      jest.advanceTimersByTime(17)
      if (f % 20 === 0) {
        const shr = getExternalMachineState().shr as Uint8Array
        fs.writeFileSync(`${OUT_DIR}\\shr-${f}.bin`, shr)
        console.log(`frame ${f} shrHash=${shr.reduce((h,b)=>h+b,0)}`)
      }
    }
    const text = getTextPageAsString()
    fs.writeFileSync(`${OUT_DIR}\\text-4800.bin`, Uint8Array.from(text,(c)=>c.charCodeAt(0)))
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
