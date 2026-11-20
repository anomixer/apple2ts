import { doSetMachineName, doSetRunMode, doSetSpeedMode, getExternalMachineState, resetCpuSpeedForTesting } from "./motherboard"
import { getShr, getTextPageAsString } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { setKeyboardState } from "./devices/keyboard"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const DISK_PATH = "C:\\dev\\emu\\ap2\\DISKS\\PITFALLGS.2mg"
const OUT_DIR = "C:\\dev\\apple2ts\\.tmp-pitfall-play"
const BOOT_FRAMES = Number(process.env.PITFALL_BOOT_FRAMES || 700)
const PLAY_FRAMES = Number(process.env.PITFALL_PLAY_FRAMES || 4000)

const press = (key: number, domCode: string) => {
  setKeyboardState({ key, isDown: true, repeat: false, domCode })
  for (let i = 0; i < 3; i++) jest.advanceTimersByTime(17)
  setKeyboardState({ key, isDown: false, repeat: false, domCode })
}

const hash = (a: Uint8Array) => {
  let h = 2166136261
  for (let i = 0; i < a.length; i++) {
    h ^= a[i]
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

test("pitfall play probe", () => {
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

    console.log("boot done frame", BOOT_FRAMES, "lit", Array.from(getExternalMachineState().shr as Uint8Array).filter(Boolean).length)
    press(0x20, "Space")
    console.log("space pressed")
    press(0x0d, "Enter")
    console.log("enter pressed")

    for (let f = 1; f <= PLAY_FRAMES; f++) {
      jest.advanceTimersByTime(17)
      if (f % 100 === 0) {
        const shr = getExternalMachineState().shr as Uint8Array
        fs.writeFileSync(`${OUT_DIR}\\shr-${f}.bin`, shr)
        console.log(`frame ${f} hash=${hash(shr)} lit=${Array.from(shr).filter(Boolean).length} text=${JSON.stringify(getTextPageAsString().slice(-60))}`)
      }
    }
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
