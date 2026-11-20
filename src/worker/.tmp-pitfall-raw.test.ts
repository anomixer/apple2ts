import { doSetMachineName, doSetRunMode, doSetSpeedMode, getExternalMachineState, resetCpuSpeedForTesting } from "./motherboard"
import { getShr } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { setKeyboardState } from "./devices/keyboard"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const DISK_PATH = "C:\\dev\\emu\\ap2\\DISKS\\PITFALLGS.2mg"
const OUT_DIR = "C:\\dev\\apple2ts\\.tmp-pitfall-raw"
const BOOT_FRAMES = 700

const press = (key: number, domCode: string) => {
  setKeyboardState({ key, isDown: true, repeat: false, domCode })
  for (let i = 0; i < 3; i++) jest.advanceTimersByTime(17)
  setKeyboardState({ key, isDown: false, repeat: false, domCode })
}

test("pitfall raw probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    doSetSpeedMode(1)
    expect(doSetEmuDriveNewData({
      index: 0, hardDrive: true, drive: 1, filename: "PITFALLGS.2mg", status: "",
      motorRunning: false, diskHasChanges: false, isWriteProtected: false,
      diskData: new Uint8Array(fs.readFileSync(DISK_PATH)), lastAppleWriteTime: 0,
      cloudData: null, writableFileHandle: null, lastLocalFileWriteTime: 0,
    } as DriveProps)).toBe(true)

    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    fs.mkdirSync(OUT_DIR, { recursive: true })

    for (let f = 1; f <= BOOT_FRAMES; f++) jest.advanceTimersByTime(17)
    press(0x20, "Space")
    press(0x0d, "Enter")
    for (let f = 1; f <= 1000; f++) jest.advanceTimersByTime(17)

    const display = getExternalMachineState().shr as Uint8Array
    const raw = getShr()
    fs.writeFileSync(`${OUT_DIR}\\display.bin`, display)
    fs.writeFileSync(`${OUT_DIR}\\raw.bin`, raw)
    let diff = 0
    for (let i = 0; i < 0x8000; i++) if (display[i] !== raw[i]) diff++
    console.log("diff bytes display vs raw:", diff, "display len", display.length, "raw len", raw.length)
    let diffScreen = 0
    let diffPal = 0
    for (let i = 0; i < 0x7d00; i++) if (display[i] !== raw[i]) diffScreen++
    for (let i = 0x7d00; i < 0x8000; i++) if (display[i] !== raw[i]) diffPal++
    console.log("diff screen bytes:", diffScreen, "diff scb/pal:", diffPal)
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
