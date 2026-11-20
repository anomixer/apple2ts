import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { memGet24 } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { setKeyboardState } from "./devices/keyboard"
import { doGetSaveState } from "./save_restore"
import * as fs from "fs"

const DISK_PATH = process.env.NFC_PATH || "C:\\dev\\emu\\ap2\\DISKS\\NFCDemoDrive.2mg"
const OUT_PATH = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-bootcheck.txt"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

const hex = (v: number, n = 2) => v.toString(16).padStart(n, "0")
const bytesAt = (base: number, count = 16) => {
  const out = []
  for (let i = 0; i < count; i++) out.push(hex(memGet24((base + i) & 0xffff), 2))
  return out.join("")
}

const key = (domCode: string, keyCode = -1, hold = 10, after = 60) => {
  setKeyboardState({ key: keyCode, isDown: true, repeat: false, domCode })
  pump(hold)
  setKeyboardState({ key: keyCode, isDown: false, repeat: false, domCode })
  pump(after)
}

test("check fresh NFCDemo boot state at prompt without probes", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  const data = fs.readFileSync(DISK_PATH)
  const props: DriveProps = {
    index: 0, hardDrive: true, drive: 1, filename: "NFCDemoDrive.2mg", status: "",
    motorRunning: false, diskHasChanges: false, isWriteProtected: false,
    diskData: new Uint8Array(data), lastAppleWriteTime: 0, cloudData: null,
    writableFileHandle: null, lastLocalFileWriteTime: 0,
  }
  expect(doSetEmuDriveNewData(props)).toBe(true)
  doSetRunMode(RUN_MODE.NEED_BOOT)
  doSetRunMode(RUN_MODE.RUNNING, false)

  pump(300)
  key("ArrowDown")
  key("ArrowDown")
  key("Enter", 13)
  pump(9500)

  const cpu = getCPU() as any
  const state = doGetSaveState(true)
  const lines = []
  lines.push(`STATE PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} S=${hex(cpu.S, 3)} cycles=${state.state6502.s6502.cycleCount}`)
  lines.push(`STACK0 ${bytesAt(0x1e0, 16)}`)
  lines.push(`STACKS ${bytesAt(cpu.S, 16)}`)
  lines.push(`CPU ${JSON.stringify(state.state6502.cpu65816)}`)
  fs.writeFileSync(OUT_PATH, lines.join("\n"))
  console.log(`[NFC-BOOTCHECK] ${lines[0]}`)
  console.log(`[NFC-BOOTCHECK] STACK0 ${lines[1]}`)
  console.log(`[NFC-BOOTCHECK] saved state cycles=${state.state6502.s6502.cycleCount} to ${OUT_PATH}`)
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 900000)
