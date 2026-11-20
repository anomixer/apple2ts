import { doSetRunMode, getCPU } from "./motherboard"
import { memGet24, gsRAM } from "./memory"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { setKeyboardState } from "./devices/keyboard"
import { doRestoreSaveState } from "./save_restore"
import * as fs from "fs"

const SAVE_IN = process.env.NFC_SAVE_IN || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-prompt-save.json"
const OUT_PATH = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-frame-prompt-key.txt"
const MEM_IN = process.env.NFC_MEM || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-snapshot\\prompt-memory-full.bin"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

const hex = (v: number, n = 2) => v.toString(16).padStart(n, "0")
const bytesAt = (base: number, count = 8) => {
  const out = []
  for (let i = 0; i < count; i++) out.push(hex(memGet24((base + i) & 0xffff), 2))
  return out.join("")
}

test("record interrupt frame and stack bytes for NFCDemo prompt", () => {
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

  const log: string[] = []
  const MAX = 20000
  log.push(`INITIAL state PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} S=${hex(cpu.S, 3)} P=${hex(cpu.P)} irqPending=${cpu.irqPending}`)
  log.push(`INITIAL stack 1e0= ${bytesAt(0x1e0, 16)}`)

  const origInterrupt = cpu.interrupt.bind(cpu)
  cpu.interrupt = (...args: any[]) => {
    if (log.length < MAX) {
      log.push(`INTERRUPT ENTER PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} S=${hex(cpu.S, 3)} P=${hex(cpu.P)} em=${cpu.emulationMode} vec=${args[0]}/${args[1]} soft=${args[2]} stack= ${bytesAt(cpu.S, 8)}`)
    }
    return origInterrupt.apply(cpu, args as any)
  }

  const origWrite8 = cpu.write8.bind(cpu)
  let writes = 0
  cpu.write8 = (address: number, value: number) => {
    if (address >= 0x1e0 && address <= 0x200 && writes < 3000) {
      writes++
      const curOp = memGet24((cpu.PB << 16) | cpu.PC, false)
      log.push(`WRITE @${hex(address, 4)}=${hex(value, 2)} at PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} op=${hex(curOp, 2)} S=${hex(cpu.S, 3)}`)
    }
    return origWrite8(address, value)
  }

  const orig = cpu.processInstruction.bind(cpu)
  cpu.processInstruction = (cb: any) => {
    const op = memGet24(((cpu.PB << 16) | cpu.PC) & 0xffffff, false)
    if (op === 0x6b || op === 0x40 || op === 0x00 || op === 0x02 || op === 0x20) {
      log.push(`EVENT OP=${hex(op, 2)} PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} S=${hex(cpu.S, 3)} P=${hex(cpu.P)} stack= ${bytesAt(cpu.S, 8)}`)
    }
    return orig(cb)
  }

  setKeyboardState({ key: 0x20, isDown: true, repeat: false, domCode: "Space" })
  pump(10)
  setKeyboardState({ key: 0x20, isDown: false, repeat: false, domCode: "Space" })
  pump(500)

  log.push(`FINAL state PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} S=${hex(cpu.S, 3)} P=${hex(cpu.P)}`)
  fs.writeFileSync(OUT_PATH, log.join("\n"))
  console.log(`[NFC-FRAME] wrote ${log.length} lines to ${OUT_PATH}`)
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 900000)
