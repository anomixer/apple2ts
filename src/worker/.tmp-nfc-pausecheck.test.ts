import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { memGet24, gsRAM } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { setKeyboardState } from "./devices/keyboard"
import { doGetSaveState, doRestoreSaveState } from "./save_restore"
import * as fs from "fs"

const DISK_PATH = process.env.NFC_PATH || "C:\\dev\\emu\\ap2\\DISKS\\NFCDemoDrive.2mg"
const OUT_PATH = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-pausecheck.txt"

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

const snap = (label: string, cpu: any) => {
  return `${label} PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} S=${hex(cpu.S, 3)} A=${hex(cpu.A, 4)} X=${hex(cpu.X, 4)} cycles=${(globalThis as any)?.s6502?.cycleCount ?? "?"}`
}

test("check pause-before-dump timing for NFCDemo prompt", () => {
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
  const lines: string[] = []
  lines.push(snap("BEFORE-PAUSE", cpu))
  doSetRunMode(RUN_MODE.PAUSED, false)
  lines.push(snap("AFTER-PAUSE", cpu))

  const mem = new Uint8Array(128 * 65536)
  for (let bank = 0; bank < 128; bank++) {
    const base = bank * 65536
    for (let addr = 0; addr < 65536; addr++) mem[bank * 65536 + addr] = memGet24(base + addr)
  }
  lines.push(snap("AFTER-DUMP", cpu))
  const state = doGetSaveState(true)
  lines.push(snap("AFTER-SAVE", cpu))
  lines.push(`STACK0 ${bytesAt(0x1e0, 16)}`)
  lines.push(`SAVED-CYCLES ${state.state6502.s6502.cycleCount}`)
  fs.writeFileSync("C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-paused-current-save.json", JSON.stringify(state))
  fs.writeFileSync("C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-paused-current-memory.bin", mem)
  fs.writeFileSync(OUT_PATH, lines.join("\n"))
  console.log(`[NFC-PAUSECHECK]\n${lines.join("\n")}`)
  jest.useRealTimers()
}, 900000)
