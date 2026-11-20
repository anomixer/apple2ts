import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { memGet24 } from "./memory"
import { doRestoreSaveState, doGetSaveState } from "./save_restore"
import { setKeyboardState } from "./devices/keyboard"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const SAVE_IN = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-postintro-menu\\arrowDown2050-state.json"
const OUT_DIR = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-writetrace-cop"

const pump = (frames: number, stop?: () => boolean) => {
  for (let f = 0; f < frames; f++) {
    jest.advanceTimersByTime(17)
    if (stop && stop()) return
  }
}

test("NFCDemo trace writes at the true COP fetch", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  const saved = JSON.parse(fs.readFileSync(SAVE_IN, "utf8"))
  doRestoreSaveState(saved, true, false, 2.0)
  doSetRunMode(RUN_MODE.RUNNING, false)
  doRestoreSaveState(saved, false, false, 2.0)
  const cpu = getCPU() as any
  cpu.setSaveState(saved.state6502.cpu65816)

  const writeLog: any[] = []
  const history: string[] = []
  let crashInfo: any = null
  let crashLog: any[] | null = null
  let crashTrace: string[] | null = null
  let crashMem: number[] | null = null
  const origWrite = cpu.writeMemory.bind(cpu)
  cpu.writeMemory = function (address: number, value: number) {
    const trace = history[history.length - 1] || ""
    writeLog.push({ address, value, pc: cpu.PC, pb: cpu.PB, trace })
    if (writeLog.length > 50000) writeLog.shift()
    return origWrite(address, value)
  }

  const recorder = {
    strings: history,
    push(s: string) {
      this.strings.push(s)
      if (this.strings.length > 6000) this.strings.shift()
      if (crashInfo === null && /PC=11:e00c Opcode=02/.test(s)) {
        crashInfo = { pb: cpu.PB, pc: cpu.PC, a: cpu.A, x: cpu.X, y: cpu.Y, s: cpu.S, d: cpu.D, p: cpu.P }
        crashLog = writeLog.slice()
        crashTrace = this.strings.slice()
        crashMem = []
        for (let a = 0xE000; a < 0xE100; a++) crashMem.push(memGet24((0x11 << 16 | a) >>> 0))
      }
    },
    shift() {},
    get length() { return 0 },
    join(sep: string) { return this.strings.join(sep) },
  }
  cpu.traceBuffer = recorder
  cpu.dumped = false

  fs.mkdirSync(OUT_DIR, { recursive: true })
  setKeyboardState({ key: -1, isDown: true, repeat: false, domCode: "Enter" })
  pump(2)
  setKeyboardState({ key: -1, isDown: false, repeat: false, domCode: "Enter" })
  pump(8000, () => crashInfo !== null)

  fs.writeFileSync(`${OUT_DIR}\\writes.json`, JSON.stringify(crashLog || writeLog.slice(-20000), null, 2))
  fs.writeFileSync(`${OUT_DIR}\\crash-info.json`, JSON.stringify(crashInfo, null, 2))
  fs.writeFileSync(`${OUT_DIR}\\trace-buffer.json`, JSON.stringify(crashTrace || history.slice(-100), null, 2))
  if (crashMem) {
    fs.writeFileSync(`${OUT_DIR}\\mem11-E000-at-cop.bin`, Buffer.from(crashMem))
  }
  const state = doGetSaveState(true)
  fs.writeFileSync(`${OUT_DIR}\\state.json`, JSON.stringify(state))
  console.log(`[WRITE2] crash=${JSON.stringify(crashInfo)} writes=${writeLog.length} traceLen=${crashTrace?.length}`)
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 600000)
