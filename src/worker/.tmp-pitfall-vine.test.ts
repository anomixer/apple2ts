import { doSetMachineName, doSetRunMode, doSetSpeedMode, getExternalMachineState, resetCpuSpeedForTesting } from "./motherboard"
import { getCurrentMemory, getShr, getShrDisplayed, getTextPageAsString } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { setKeyboardState } from "./devices/keyboard"
import { pressAppleCommandKey } from "./devices/joystick"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const DISK_PATH = "C:\\dev\\emu\\ap2\\DISKS\\PITFALLGS.2mg"
const OUT_DIR = "C:\\dev\\apple2ts\\.tmp-pitfall-vine"
const BOOT_FRAMES = Number(process.env.PITFALL_BOOT_FRAMES || 700)
const PLAY_FRAMES = Number(process.env.PITFALL_PLAY_FRAMES || 2400)
const KEY_EVERY = Number(process.env.PITFALL_KEY_EVERY || 3)

const right = [0x6b, "KeyK"], left = [0x6a, "KeyJ"], up = [0x69, "KeyI"], down = [0x6d, "KeyM"]
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
  for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) }
  return h >>> 0
}
const diffCount = (a: Uint8Array, b: Uint8Array) => {
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
  return n
}
// Walk to the ladder, climb it, walk to the right tree, try both directions of
// the VBL sync there, and jump while climbing the tree.
const schedule = (f: number) => {
  if (f <= 90) return right
  if (f <= 220) return up
  if (f <= 320) return right
  if (f <= 520) return up
  if (f <= 600) return right
  if (f <= 800) return up
  if (f <= 1000) return null
  if (f <= 1200) return right
  if (f <= 1600) return up
  if (f <= 1800) return right
  if (f <= 2200) return up
  return left
}
test("pitfall vine probe", () => {
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
    for (let f = 1; f <= PLAY_FRAMES; f++) {
      jest.advanceTimersByTime(17)
      const action = schedule(f)
      if (action && f % KEY_EVERY === 0) keyDown(action[0] as number, action[1] as string)
      if (f === 1300) pressAppleCommandKey(true, true)
      if (f === 1500) pressAppleCommandKey(false, true)
      if (f === 1800) pressAppleCommandKey(true, true)
      if (f === 2000) pressAppleCommandKey(false, true)
      if (f % 50 === 0) {
        const shown = getShrDisplayed()
        const raw = getShr()
        const mem = getCurrentMemory()
        fs.writeFileSync(`${OUT_DIR}\\shown-${f}.bin`, shown)
        fs.writeFileSync(`${OUT_DIR}\\raw-${f}.bin`, raw)
        const vars = Array.from(mem.slice(0x1ab0, 0x1b00)).map((v) => v.toString(16).padStart(2, "0")).join(" ")
        console.log(`frame ${f} hash=${hash(shown)} diff=${diffCount(shown, raw)} lit=${Array.from(shown).filter(Boolean).length} vars=${vars}`)
      }
    }
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
