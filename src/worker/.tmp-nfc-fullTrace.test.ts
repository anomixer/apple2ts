import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { getShrDisplayed, getTextPageAsString, memGet24 } from "./memory"
import { doGetSaveState, doRestoreSaveState } from "./save_restore"
import { setKeyboardState } from "./devices/keyboard"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const SAVE_IN = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-postintro-menu\\arrowDown2050-state.json"
const OUT_DIR = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-cop-trace5"

type TraceHook = {
  push: (s: string) => void
  shift: () => void
}

const pump = (frames: number, stop?: () => boolean) => {
  for (let f = 0; f < frames; f++) {
    jest.advanceTimersByTime(17)
    if (stop && stop()) return
  }
}

test("NFCDemo full trace COP/BRK from menu", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  const saved = JSON.parse(fs.readFileSync(SAVE_IN, "utf8"))
  doRestoreSaveState(saved, true, false, 2.0)
  doSetRunMode(RUN_MODE.RUNNING, false)
  doRestoreSaveState(saved, false, false, 2.0)
  const cpu = getCPU() as any
  cpu.setSaveState(saved.state6502.cpu65816)

  // Swap the CPU's 100-entry debug trace for a recorder that keeps a longer
  // history. processInstruction still builds the string; the recorder just does
  // not truncate it at 100 entries.
  const history: string[] = []
  let crashHistory: string[] | null = null
  let crashInfo: any = null
  const recorder = {
    strings: history,
    push(s: string) {
      this.strings.push(s)
      if (this.strings.length > 40000) this.strings.shift()
      const m = /PC=([0-9a-f]+):([0-9a-f]+) Opcode=([0-9a-f]+)/.exec(s)
      if (m) {
        const pb = parseInt(m[1], 16), pc = parseInt(m[2], 16), op = parseInt(m[3], 16)
        if ((pb === 0x11 && pc === 0xE00C && op === 0x02) || (pb === 0x11 && pc === 0x000C && op === 0x00)) {
          crashInfo = { pb, pc, op, info: m, a: cpu.A, x: cpu.X, y: cpu.Y, s: cpu.S, d: cpu.D, p: cpu.P }
          crashHistory = this.strings.slice()
          fs.mkdirSync(OUT_DIR, { recursive: true })
          fs.writeFileSync(`${OUT_DIR}\\trace-cop.json`, JSON.stringify(crashHistory, null, 2))
        }
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
  recorder.strings.length = 0
  setKeyboardState({ key: -1, isDown: false, repeat: false, domCode: "Enter" })
  pump(8000, () => crashInfo !== null)
  const cpu2 = getCPU() as any
  fs.writeFileSync(`${OUT_DIR}\\afterTrace-shr.bin`, getShrDisplayed())
  fs.writeFileSync(`${OUT_DIR}\\afterTrace.txt`, getTextPageAsString())
  fs.writeFileSync(`${OUT_DIR}\\trace-cop.json`, JSON.stringify(crashHistory || history.slice(-100), null, 2))
  const state = doGetSaveState(true)
  fs.writeFileSync(`${OUT_DIR}\\trace-cop-state.json`, JSON.stringify(state))
  console.log(`[TRACE3] info=${JSON.stringify(crashInfo)} final PB=${cpu2.PB.toString(16)} PC=${cpu2.PC.toString(16)} S=${cpu2.S.toString(16)} A=${cpu2.A.toString(16)}`)
  console.log(`[TRACE3] history=${JSON.stringify((crashHistory || history).length)}`)
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 600000)
