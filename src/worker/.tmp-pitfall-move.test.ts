import { doSetMachineName, doSetRunMode, doSetSpeedMode, getExternalMachineState, resetCpuSpeedForTesting } from "./motherboard"
import { getShr, getShrDisplayed, getTextPageAsString } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { setKeyboardState } from "./devices/keyboard"
import { pressAppleCommandKey } from "./devices/joystick"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const DISK_PATH = "C:\\dev\\emu\\ap2\\DISKS\\PITFALLGS.2mg"
const OUT_DIR = "C:\\dev\\apple2ts\\.tmp-pitfall-move"
const BOOT_FRAMES = Number(process.env.PITFALL_BOOT_FRAMES || 700)
const PLAY_FRAMES = Number(process.env.PITFALL_PLAY_FRAMES || 1200)
const KEY_EVERY = Number(process.env.PITFALL_KEY_EVERY || 4)

const keyDown = (key: number, domCode: string) => {
  setKeyboardState({ key, isDown: true, repeat: false, domCode })
}
const keyUp = (key: number, domCode: string) => {
  setKeyboardState({ key, isDown: false, repeat: false, domCode })
}

const press = (key: number, domCode: string) => {
  keyDown(key, domCode)
  jest.advanceTimersByTime(17)
  keyUp(key, domCode)
}

const hash = (a: Uint8Array) => {
  let h = 2166136261
  for (let i = 0; i < a.length; i++) {
    h ^= a[i]
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const diffCount = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return -1
  let n = 0
  let first = -1
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (first < 0) first = i
      n++
    }
  }
  return n
}

test("pitfall move probe", () => {
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

    // Hold Right / K long enough to reach a vine, with a key strobe repeated
    // at hardware auto-repeat cadence because the browser does not resend it.
    for (let f = 1; f <= PLAY_FRAMES; f++) {
      jest.advanceTimersByTime(17)
      if (f % KEY_EVERY === 0) {
        keyDown(0x6b, "KeyK")
      }
      if (f === 240 || f === 480 || f === 900) {
        pressAppleCommandKey(true, true)
      }
      if (f === 260 || f === 500 || f === 920) {
        pressAppleCommandKey(false, true)
      }
      if (f % 50 === 0) {
        const shown = getShrDisplayed()
        const raw = getShr()
        fs.writeFileSync(`${OUT_DIR}\\shown-${f}.bin`, shown)
        fs.writeFileSync(`${OUT_DIR}\\raw-${f}.bin`, raw)
        console.log(`frame ${f} shownHash=${hash(shown)} rawHash=${hash(raw)} diff=${diffCount(shown, raw)} lit=${Array.from(shown).filter(Boolean).length} text=${JSON.stringify(getTextPageAsString().slice(-60))}`)
      }
    }
    keyUp(0x6b, "KeyK")
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
