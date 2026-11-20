import { doSetRunMode, getCPU } from "./motherboard"
import { memGet24, gsRAM } from "./memory"
import { getShrDisplayed } from "./memory"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { setKeyboardState } from "./devices/keyboard"
import { doRestoreSaveState } from "./save_restore"
import * as fs from "fs"

const SAVE_IN = process.env.NFC_SAVE_IN || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-prompt-save.json"
const MEM_IN = process.env.NFC_MEM || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-snapshot\\prompt-memory.bin"
const OUT_DIR = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-fullrestore"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

const dump = (label: string) => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(`${OUT_DIR}\\${label}-shr.bin`, getShrDisplayed())
  const cpu = getCPU() as any
  console.log(`[NFC-FULL] ${label} PB=${cpu.PB.toString(16)} PC=${cpu.PC.toString(16)} A=${cpu.A.toString(16)} X=${cpu.X.toString(16)} Y=${cpu.Y.toString(16)} S=${cpu.S.toString(16)} E=${cpu.emulationMode}`)
}

test("restore prompt save with full fast RAM, press Space", () => {
  jest.useFakeTimers()
  setIsTesting()
  const saved = JSON.parse(fs.readFileSync(SAVE_IN, "utf8"))
  doRestoreSaveState(saved, true, false, 2.0)
  doSetRunMode(RUN_MODE.RUNNING, false)
  const cpu = getCPU() as any
  cpu.setSaveState(saved.state6502.cpu65816)

  // The normal save state only covered the first 64 KB of fast RAM. The prompt
  // memory dump has 64 banks; write banks 02-3F back into the GS fast RAM array
  // (banks 00/01 live in the base memory array and are already restored).
  const full = fs.readFileSync(MEM_IN)
  for (let bank = 0x02; bank < 0x40; bank++) {
    gsRAM.set(full.subarray(bank * 0x10000, (bank + 1) * 0x10000), bank * 0x10000)
  }

  dump("restoredFull")
  setKeyboardState({ key: 0x20, isDown: true, repeat: false, domCode: "Space" })
  pump(250)
  setKeyboardState({ key: 0x20, isDown: false, repeat: false, domCode: "Space" })
  pump(250)
  dump("afterKey500")
  pump(1500)
  dump("afterKey2000")
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 900000)
