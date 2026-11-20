import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { getShrDisplayed, getTextPageAsString, memGet24 } from "./memory"
import { doGetSaveState, doRestoreSaveState } from "./save_restore"
import { setKeyboardState } from "./devices/keyboard"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const SAVE_IN = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-postintro-menu\\arrowDown2050-state.json"
const OUT_DIR = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-cop-trace2"
const RING = 2000

const pump = (frames: number, stop?: () => boolean) => {
  for (let f = 0; f < frames; f++) {
    jest.advanceTimersByTime(17)
    if (stop && stop()) return
  }
}

test("NFCDemo trace COP route from before instruction", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  const saved = JSON.parse(fs.readFileSync(SAVE_IN, "utf8"))
  doRestoreSaveState(saved, true, false, 2.0)
  doSetRunMode(RUN_MODE.RUNNING, false)
  doRestoreSaveState(saved, false, false, 2.0)
  const cpu = getCPU() as any
  cpu.setSaveState(saved.state6502.cpu65816)
  // clear CPU debug trace, we want our own
  cpu.traceBuffer = []
  cpu.dumped = false
  const origProc = cpu.processInstruction.bind(cpu)
  const ring: any[] = []
  let crashInfo: any = null
  cpu.processInstruction = function (...args: any[]) {
    const pb = cpu.PB, pc = cpu.PC
    const addr = ((pb << 16) | pc) >>> 0
    const op = memGet24(addr, false)
    if (op === 0x00 || op === 0x02) {
      crashInfo = {
        opAddr: addr, op, pb, pc,
        a: cpu.A, x: cpu.X, y: cpu.Y, s: cpu.S, d: cpu.D, p: cpu.P,
        ring: ring.slice(),
      }
      fs.mkdirSync(OUT_DIR, { recursive: true })
      fs.writeFileSync(`${OUT_DIR}\\cop-route.json`, JSON.stringify(crashInfo, null, 2))
      const mem11 = []
      for (let a = 0xE000; a < 0xE100; a++) mem11.push(memGet24((0x11 << 16 | a) >>> 0, false))
      fs.writeFileSync(`${OUT_DIR}\\mem11-E000.bin`, Buffer.from(mem11))
      const mem11_0 = []
      for (let a = 0; a < 0x100; a++) mem11_0.push(memGet24((0x11 << 16 | a) >>> 0, false))
      fs.writeFileSync(`${OUT_DIR}\\mem11-0000.bin`, Buffer.from(mem11_0))
      const state = doGetSaveState(true)
      fs.writeFileSync(`${OUT_DIR}\\pre-cop-state.json`, JSON.stringify(state))
      return 0
    }
    ring.push({ pb, pc, op, a: cpu.A, x: cpu.X, y: cpu.Y, s: cpu.S, p: cpu.P })
    if (ring.length > RING) ring.shift()
    return origProc(...args)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(`${OUT_DIR}\\restored-shr.bin`, getShrDisplayed())
  setKeyboardState({ key: -1, isDown: true, repeat: false, domCode: "Enter" })
  pump(2)
  setKeyboardState({ key: -1, isDown: false, repeat: false, domCode: "Enter" })
  pump(12000, () => crashInfo !== null)
  fs.writeFileSync(`${OUT_DIR}\\afterTrace-shr.bin`, getShrDisplayed())
  fs.writeFileSync(`${OUT_DIR}\\afterTrace.txt`, getTextPageAsString())
  const cpu2 = getCPU() as any
  console.log(`[TRACE2] crash=${JSON.stringify(crashInfo && { opAddr: crashInfo.opAddr.toString(16), op: crashInfo.op, pb: crashInfo.pb.toString(16), pc: crashInfo.pc.toString(16), s: crashInfo.s.toString(16) })}`)
  console.log(`[TRACE2] final PB=${cpu2.PB.toString(16)} PC=${cpu2.PC.toString(16)} A=${cpu2.A.toString(16)} X=${cpu2.X.toString(16)} Y=${cpu2.Y.toString(16)} S=${cpu2.S.toString(16)} D=${cpu2.D.toString(16)} P=${cpu2.P.toString(16)}`)
  if (!crashInfo) fs.writeFileSync(`${OUT_DIR}\\ring-no-crash.json`, JSON.stringify(ring, null, 2))
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 600000)
