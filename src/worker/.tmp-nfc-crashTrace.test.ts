import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { getShrDisplayed, getTextPageAsString, memGet24 } from "./memory"
import { doGetSaveState, doRestoreSaveState } from "./save_restore"
import { setKeyboardState } from "./devices/keyboard"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"
import { createHash } from "crypto"

const SAVE_IN = process.env.NFC_SAVE_IN || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-postintro-menu\\arrowDown2050-state.json"
const OUT_DIR = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-crash-trace"
const TRACE_MAX = 400

const pump = (frames: number, stop?: () => boolean) => {
  for (let f = 0; f < frames; f++) {
    jest.advanceTimersByTime(17)
    if (stop && stop()) return
  }
}

const dump = (label: string) => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const shr = getShrDisplayed()
  fs.writeFileSync(`${OUT_DIR}\\${label}-shr.bin`, shr)
  fs.writeFileSync(`${OUT_DIR}\\${label}.txt`, getTextPageAsString())
  const cpu = getCPU() as any
  const h = createHash("sha1").update(shr).digest("hex")
  console.log(`[NFC-TRACE] ${label} PB=${cpu.PB.toString(16)} PC=${cpu.PC.toString(16)} A=${cpu.A.toString(16)} X=${cpu.X.toString(16)} Y=${cpu.Y.toString(16)} S=${cpu.S.toString(16)} D=${cpu.D.toString(16)} P=${cpu.P.toString(16)} shr=${h}`)
  console.log(`[NFC-TRACE-TEXT] ${label} ${JSON.stringify(getTextPageAsString().slice(0, 160))}`)
}

const key = (domCode: string, keyCode = -1, hold = 2) => {
  setKeyboardState({ key: keyCode, isDown: true, repeat: false, domCode })
  pump(hold)
  setKeyboardState({ key: keyCode, isDown: false, repeat: false, domCode })
  pump(2)
}

let trace: any[] = []
let crashInfo: any = null

test("NFCDemo trace COP/BRK in menu selection", () => {
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
  cpu.processInstruction = function (...args: any[]) {
    const op = memGet24((cpu.PB << 16 | cpu.PC) >>> 0, false)
    if (op === 0x00 || op === 0x02 || op === 0x20) {
      crashInfo = {
        pb: cpu.PB, pc: cpu.PC, opcode: op,
        a: cpu.A, x: cpu.X, y: cpu.Y, s: cpu.S, d: cpu.D, p: cpu.P,
        trace: trace.slice().reverse(),
      }
      fs.mkdirSync(OUT_DIR, { recursive: true })
      fs.writeFileSync(`${OUT_DIR}\\crash-${cpu.PB.toString(16)}-${cpu.PC.toString(16)}.json`, JSON.stringify(crashInfo, null, 2))
      const mem11 = []
      for (let a = 0; a < 0x1000; a++) mem11.push(memGet24((0x11 << 16 | a) >>> 0, false))
      fs.writeFileSync(`${OUT_DIR}\\crash-mem11-${cpu.PB.toString(16)}.bin`, Buffer.from(mem11))
      return origProc(...args)
    }
    trace.push({ pb: cpu.PB, pc: cpu.PC, op, a: cpu.A, x: cpu.X, y: cpu.Y, s: cpu.S, d: cpu.D, p: cpu.P })
    if (trace.length > TRACE_MAX) trace.shift()
    return origProc(...args)
  }
  dump("restored")
  key("ArrowDown")
  pump(500)
  dump("menuSelected")
  setKeyboardState({ key: -1, isDown: true, repeat: false, domCode: "Enter" })
  pump(2)
  setKeyboardState({ key: -1, isDown: false, repeat: false, domCode: "Enter" })
  pump(10000, () => crashInfo !== null)
  dump("afterTrace")
  console.log("[NFC-TRACE] crashInfo", JSON.stringify(crashInfo && { pb: crashInfo.pb, pc: crashInfo.pc, opcode: crashInfo.opcode, s: crashInfo.s, traceLen: crashInfo.trace.length }))
  fs.writeFileSync(`${OUT_DIR}\\trace.json`, JSON.stringify(trace, null, 2))
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 600000)
