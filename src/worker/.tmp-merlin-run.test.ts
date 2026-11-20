import { doSetMachineName, doSetRunMode, doSetSpeedMode, getExternalMachineState, resetCpuSpeedForTesting } from "./motherboard"
import { getShr, getTextPageAsString, memGetC000 } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { setKeyboardState } from "./devices/keyboard"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const SYSTEM = "C:/dev/emu/ap2/DISKS/SystemDisk.2mg"
const MERLIN = "C:/dev/emu/ap2/DISKS/merlin 16+ v4.68 (1989)(roger wagner publishing)(disk 1 of 3).2mg"
const OUT_DIR = "C:/dev/apple2ts/.tmp-merlin-run"

const mount = (index: number, drive: number, path: string) =>
  doSetEmuDriveNewData({
    index, hardDrive: false, drive, filename: path.split("/").pop()!, status: "",
    motorRunning: false, diskHasChanges: false, isWriteProtected: false,
    diskData: new Uint8Array(fs.readFileSync(path)), lastAppleWriteTime: 0,
    cloudData: null, writableFileHandle: null, lastLocalFileWriteTime: 0,
  } as DriveProps)

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

test("merlin launch probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    doSetSpeedMode(1)
    expect(mount(4, 1, SYSTEM)).toBe(true)
    expect(mount(5, 2, MERLIN)).toBe(true)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    pump(4200)
    fs.mkdirSync(OUT_DIR, { recursive: true })
    fs.writeFileSync(`${OUT_DIR}\\shr-4200.bin`, getExternalMachineState().shr as Uint8Array)

    setKeyboardState({ key: 13, isDown: true, repeat: false, domCode: "Enter" })
    let frames = 0
    while (memGetC000(0xC000) >= 0x80 && frames < 400) {
      pump(1)
      frames++
    }
    console.log(`return consumed after ${frames} frames, C000=${memGetC000(0xC000)}`)
    pump(2)
    setKeyboardState({ key: 13, isDown: false, repeat: false, domCode: "Enter" })

    for (let f = 1; f <= 900; f++) {
      pump(1)
      if (f % 100 === 0 || f === 1 || f === 900) {
        const shr = getExternalMachineState().shr as Uint8Array
        fs.writeFileSync(`${OUT_DIR}\\shr-${4200 + f}.bin`, shr)
        const text = getTextPageAsString()
        fs.writeFileSync(`${OUT_DIR}\\text-${4200 + f}.bin`, Uint8Array.from(text,(c)=>c.charCodeAt(0)))
      }
    }
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
