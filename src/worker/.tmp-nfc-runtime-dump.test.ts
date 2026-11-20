import { doSetRunMode, getCPU } from "./motherboard"
import { memGet24, gsRAM } from "./memory"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { setKeyboardState } from "./devices/keyboard"
import { doRestoreSaveState } from "./save_restore"
import * as fs from "fs"

const SAVE_IN = process.env.NFC_SAVE_IN || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-prompt-save.json"
const OUT_DIR = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-runtime"
const MEM_IN = process.env.NFC_MEM || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-snapshot\\prompt-memory-full.bin"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

test("dump live runtime bytes around bank 11 stack corruption", () => {
  jest.useFakeTimers()
  setIsTesting()
  const saved = JSON.parse(fs.readFileSync(SAVE_IN, "utf8"))
  doRestoreSaveState(saved, true, false, 2.0)
  doSetRunMode(RUN_MODE.RUNNING, false)
  const cpu = getCPU() as any
  cpu.setSaveState(saved.state6502.cpu65816)
  const full = fs.readFileSync(MEM_IN)
  for (let bank = 0x02; bank < 0x80; bank++) {
    gsRAM.set(full.subarray(bank * 0x10000, (bank + 1) * 0x10000), bank * 0x10000)
  }

  const seen: string[] = []
  const orig = cpu.processInstruction.bind(cpu)
  cpu.processInstruction = (cb: any) => {
    const pb = cpu.PB
    const pc = cpu.PC
    if (pb === 0x11 && ((pc >= 0xdba0 && pc <= 0xdba8) || (pc >= 0xb039 && pc <= 0xb04a))) {
      const bytes = [0, 1, 2, 3, 4, 5].map((d) => memGet24(0x11 * 0x10000 + ((pc + d) & 0xffff)).toString(16).padStart(2, "0"))
      const stack = [0, 1, 2, 3, 4, 5, 6, 7].map((d) => memGet24(0x00 * 0x10000 + ((cpu.S + d) & 0xffff)).toString(16).padStart(2, "0"))
      seen.push(`PC=${pb.toString(16)}:${pc.toString(16).padStart(4, "0")} emu=${cpu.emulationMode} D=${cpu.D.toString(16)} bytes=${bytes.join(" ")} stack=${stack.join(" ")} S=${cpu.S.toString(16)} A=${cpu.A.toString(16)} X=${cpu.X.toString(16)} Y=${cpu.Y.toString(16)}`)
    }
    return orig(cb)
  }

  setKeyboardState({ key: 0x20, isDown: true, repeat: false, domCode: "Space" })
  pump(10)
  setKeyboardState({ key: 0x20, isDown: false, repeat: false, domCode: "Space" })
  pump(500)

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(`${OUT_DIR}\\seen.txt`, seen.join("\n"))
  fs.writeFileSync(`${OUT_DIR}\\state.json`, JSON.stringify({ PB: cpu.PB, PC: cpu.PC, S: cpu.S, emulation: cpu.emulationMode, M: cpu.M, X: cpu.X, D: cpu.D, cycles: cpu.cycles }))
  const dump = (label: string, start: number, len: number) => {
    const bytes: number[] = []
    for (let i = 0; i < len; i++) bytes.push(memGet24(0x11 * 0x10000 + start + i))
    fs.writeFileSync(`${OUT_DIR}\\${label}.bin`, Buffer.from(bytes))
    const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")
    console.log(`[RUNTIME] ${label} ${hex}`)
  }
  dump("bank11-dba0", 0xdba0, 192)
  dump("bank11-b030", 0xb030, 160)
  dump("stack-1e0", 0x1e0, 64)
  console.log(`[RUNTIME] seen=${seen.length} PB=${cpu.PB.toString(16)} PC=${cpu.PC.toString(16)} S=${cpu.S.toString(16)}`)

  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 300000)
