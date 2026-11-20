import { doSetMachineName, doSetRunMode, doSetSpeedMode, getExternalMachineState, resetCpuSpeedForTesting } from "./motherboard"
import { getShr } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const SYSTEM = "C:/dev/emu/ap2/DISKS/SystemDisk.2mg"
const MERLIN = "C:/dev/emu/ap2/DISKS/merlin 16+ v4.68 (1989)(roger wagner publishing)(disk 1 of 3).2mg"
const OUT_DIR = "C:/dev/apple2ts/.tmp-merlin-sysdisk"
const FRAMES = Number(process.env.MERLIN_SYS_FRAMES || 4200)

const mount = (index: number, drive: number, path: string) =>
  doSetEmuDriveNewData({
    index, hardDrive: false, drive, filename: path.split("/").pop()!, status: "",
    motorRunning: false, diskHasChanges: false, isWriteProtected: false,
    diskData: new Uint8Array(fs.readFileSync(path)), lastAppleWriteTime: 0,
    cloudData: null, writableFileHandle: null, lastLocalFileWriteTime: 0,
  } as DriveProps)

test("merlin system disk probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    doSetSpeedMode(1)
    expect(mount(4, 1, SYSTEM)).toBe(true)
    expect(mount(5, 2, MERLIN)).toBe(true)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    fs.mkdirSync(OUT_DIR, { recursive: true })
    for (let f = 1; f <= FRAMES; f++) {
      jest.advanceTimersByTime(17)
      if (f === 3000 || f === 4000 || f === FRAMES) {
        const shr = getExternalMachineState().shr as Uint8Array
        fs.writeFileSync(`${OUT_DIR}\\shr-${f}.bin`, shr)
      }
    }
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
