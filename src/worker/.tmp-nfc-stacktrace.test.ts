import { doSetRunMode, getCPU } from "./motherboard"
import { memGet24, gsRAM } from "./memory"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { setKeyboardState } from "./devices/keyboard"
import { doRestoreSaveState } from "./save_restore"
import * as fs from "fs"

const SAVE_IN = process.env.NFC_SAVE_IN || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-prompt-save.json"
const OUT_PATH = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-stacktrace-prompt-key.txt"
const MEM_IN = process.env.NFC_MEM || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-snapshot\\prompt-memory-full.bin"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

test("trace stack writes after restored prompt key", () => {
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
  const origWrite8 = cpu.write8.bind(cpu)
  cpu.write8 = (address: number, value: number) => {
    if (address >= 0x1e0 && address <= 0x200) {
      log.push(`WRITE @${address.toString(16)}=${(value & 0xff).toString(16).padStart(2, "0")} from ${cpu.PB.toString(16)}:${cpu.PC.toString(16)} S=${cpu.S.toString(16)}`)
    }
    return origWrite8(address, value)
  }

  const orig = cpu.processInstruction.bind(cpu)
  cpu.processInstruction = (cb: any) => {
    const pb = cpu.PB
    const pc = cpu.PC
    if (log.length < 100000) {
      const op = memGet24((pb << 16) | pc, false)
      if (op === 0x6b) {
        const bytes = [1, 2, 3, 4].map((d) => memGet24(((cpu.S + d) & 0xffff)).toString(16).padStart(2, "0"))
        log.push(`RTL PC=${pb.toString(16)}:${pc.toString(16)} S=${cpu.S.toString(16)} stack=${bytes.join(",")}`)
      }
    }
    return orig(cb)
  }

  setKeyboardState({ key: 0x20, isDown: true, repeat: false, domCode: "Space" })
  pump(10)
  setKeyboardState({ key: 0x20, isDown: false, repeat: false, domCode: "Space" })
  pump(500)
  fs.writeFileSync(OUT_PATH, log.join("\n"))
  console.log(`[NFC-STACK] wrote ${log.length} lines to ${OUT_PATH} cycles=${cpu.cycles}`)
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 900000)
