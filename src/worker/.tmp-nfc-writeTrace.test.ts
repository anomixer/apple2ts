import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { memGet24 } from "./memory"
import { doGetSaveState, doRestoreSaveState } from "./save_restore"
import { setKeyboardState } from "./devices/keyboard"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const SAVE_IN = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-postintro-menu\\arrowDown2050-state.json"
const OUT_DIR = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-writetrace"

const pump = (frames: number, stop?: () => boolean) => {
  for (let f = 0; f < frames; f++) {
    jest.advanceTimersByTime(17)
    if (stop && stop()) return
  }
}

test("NFCDemo trace memory writes before COP", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  const saved = JSON.parse(fs.readFileSync(SAVE_IN, "utf8"))
  doRestoreSaveState(saved, true, false, 2.0)
  doSetRunMode(RUN_MODE.RUNNING, false)
  doRestoreSaveState(saved, false, false, 2.0)
  const cpu = getCPU() as any
  cpu.setSaveState(saved.state6502.cpu65816)
  cpu.traceBuffer = []
  cpu.dumped = false

  const writeLog: any[] = []
  const origWrite = cpu.writeMemory.bind(cpu)
  cpu.writeMemory = function (address: number, value: number) {
    const trace = cpu.traceBuffer[cpu.traceBuffer.length - 1] || ""
    const record = {
      address: address,
      value: value,
      pc: cpu.PC,
      pb: cpu.PB,
      trace,
    }
    writeLog.push(record)
    if (writeLog.length > 50000) writeLog.shift()
    return origWrite(address, value)
  }

  const origProc = cpu.processInstruction.bind(cpu)
  let crashInfo: any = null
  let crashLog: any[] | null = null
  let crashTrace: string[] | null = null
  cpu.processInstruction = function (...args: any[]) {
    const pb = cpu.PB, pc = cpu.PC
    if (pb === 0x11 && (pc === 0xE00C || pc === 0x000C)) {
      crashInfo = { pb, pc, a: cpu.A, x: cpu.X, y: cpu.Y, s: cpu.S, d: cpu.D, p: cpu.P }
      crashLog = writeLog.slice()
      crashTrace = cpu.traceBuffer.slice()
    }
    return origProc(...args)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  setKeyboardState({ key: -1, isDown: true, repeat: false, domCode: "Enter" })
  pump(2)
  setKeyboardState({ key: -1, isDown: false, repeat: false, domCode: "Enter" })
  pump(8000, () => crashInfo !== null)

  const cpu2 = getCPU() as any
  fs.writeFileSync(`${OUT_DIR}\\writes.json`, JSON.stringify(crashLog || writeLog.slice(-20000), null, 2))
  if (crashInfo) {
    fs.writeFileSync(`${OUT_DIR}\\crash-info.json`, JSON.stringify(crashInfo, null, 2))
    const memE000 = []
    for (let a = 0xE000; a < 0xE100; a++) memE000.push(memGet24((0x11 << 16 | a) >>> 0))
    fs.writeFileSync(`${OUT_DIR}\\mem11-E000.bin`, Buffer.from(memE000))
    const mem0 = []
    for (let a = 0; a < 0x100; a++) mem0.push(memGet24((0x11 << 16 | a) >>> 0))
    fs.writeFileSync(`${OUT_DIR}\\mem11-0000.bin`, Buffer.from(mem0))
    const trace = cpu2.traceBuffer.slice()
    fs.writeFileSync(`${OUT_DIR}\\trace-buffer.json`, JSON.stringify(crashTrace ?? trace, null, 2))
    const state = doGetSaveState(true)
    fs.writeFileSync(`${OUT_DIR}\\pre-cop-state.json`, JSON.stringify(state))
  }
  console.log(`[WRITE] crash=${JSON.stringify(crashInfo)} final PB=${cpu2.PB.toString(16)} PC=${cpu2.PC.toString(16)} S=${cpu2.S.toString(16)}`)
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 600000)
