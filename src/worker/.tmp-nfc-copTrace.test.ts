import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { getShrDisplayed, getTextPageAsString } from "./memory"
import { doGetSaveState, doRestoreSaveState } from "./save_restore"
import { setKeyboardState } from "./devices/keyboard"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const SAVE_IN = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-postintro-menu\\arrowDown2050-state.json"
const OUT_DIR = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-cop-trace"

const pump = (frames: number, stop?: () => boolean) => {
  for (let f = 0; f < frames; f++) {
    jest.advanceTimersByTime(17)
    if (stop && stop()) return
  }
}

test("NFCDemo trace COP/BRK after single Enter", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  const saved = JSON.parse(fs.readFileSync(SAVE_IN, "utf8"))
  doRestoreSaveState(saved, true, false, 2.0)
  doSetRunMode(RUN_MODE.RUNNING, false)
  doRestoreSaveState(saved, false, false, 2.0)
  const cpu = getCPU() as any
  cpu.setSaveState(saved.state6502.cpu65816)
  const origProc = cpu.processInstruction.bind(cpu)
  let copTrace: string[] | null = null
  let info: any = null
  cpu.processInstruction = function (...args: any[]) {
    const pb = cpu.PB, pc = cpu.PC
    const out = origProc(...args)
    const last = cpu.traceBuffer[cpu.traceBuffer.length - 1]
    if (last && /Opcode=(00|02)\b/.test(last)) {
      copTrace = cpu.traceBuffer.slice()
      info = { pb, pc, a: cpu.A, x: cpu.X, y: cpu.Y, s: cpu.S, d: cpu.D, p: cpu.P }
    }
    return out
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(`${OUT_DIR}\\restored-shr.bin`, getShrDisplayed())
  setKeyboardState({ key: -1, isDown: true, repeat: false, domCode: "Enter" })
  pump(2)
  setKeyboardState({ key: -1, isDown: false, repeat: false, domCode: "Enter" })
  pump(8000, () => copTrace !== null)
  fs.writeFileSync(`${OUT_DIR}\\restored-shr.bin`, getShrDisplayed())
  fs.writeFileSync(`${OUT_DIR}\\restored.txt`, getTextPageAsString())
  const cpu2 = getCPU() as any
  console.log(`[TRACE] final PB=${cpu2.PB.toString(16)} PC=${cpu2.PC.toString(16)} A=${cpu2.A.toString(16)} X=${cpu2.X.toString(16)} Y=${cpu2.Y.toString(16)} S=${cpu2.S.toString(16)} D=${cpu2.D.toString(16)} P=${cpu2.P.toString(16)}`)
  if (!copTrace) {
    // dump last 100 for no crash case
    fs.writeFileSync(`${OUT_DIR}\\trace-no-crash.json`, JSON.stringify(cpu2.traceBuffer, null, 2))
  } else {
    fs.writeFileSync(`${OUT_DIR}\\cop-trace.json`, JSON.stringify(copTrace, null, 2))
    fs.writeFileSync(`${OUT_DIR}\\cop-info.json`, JSON.stringify(info, null, 2))
  }
  fs.writeFileSync(`${OUT_DIR}\\afterTrace-shr.bin`, getShrDisplayed())
  fs.writeFileSync(`${OUT_DIR}\\afterTrace.txt`, getTextPageAsString())
  const state = doGetSaveState(true)
  fs.writeFileSync(`${OUT_DIR}\\cop-state.json`, JSON.stringify(state))
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 300000)
