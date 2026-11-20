import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { getShrDisplayed, getTextPageAsString } from "./memory"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { setKeyboardState } from "./devices/keyboard"
import { doGetSaveState, doRestoreSaveState } from "./save_restore"
import * as fs from "fs"

const SAVE_IN = process.env.NFC_SAVE_IN || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-prompt-save.json"
const SAVE_OUT = process.env.NFC_SAVE_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-menu-save.json"
const OUT_DIR = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-resume-menu"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

const dump = (label: string) => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(`${OUT_DIR}\\${label}-shr.bin`, getShrDisplayed())
  fs.writeFileSync(`${OUT_DIR}\\${label}.txt`, getTextPageAsString())
  const cpu = getCPU() as any
  console.log(`[NFC-RESUME] ${label} PB=${cpu.PB.toString(16)} PC=${cpu.PC.toString(16)} A=${cpu.A.toString(16)} X=${cpu.X.toString(16)} Y=${cpu.Y.toString(16)} S=${cpu.S.toString(16)} E=${cpu.emulationMode}`)
}

const key = (domCode: string, keyCode = -1, hold = 10, after = 60) => {
  setKeyboardState({ key: keyCode, isDown: true, repeat: false, domCode })
  pump(hold)
  setKeyboardState({ key: keyCode, isDown: false, repeat: false, domCode })
  pump(after)
}

test("resume NFCDemo prompt and advance to main menu", () => {
  jest.useFakeTimers()
  setIsTesting()
  const saved = JSON.parse(fs.readFileSync(SAVE_IN, "utf8"))
  doRestoreSaveState(saved, true, false, 2.0)
  doSetRunMode(RUN_MODE.RUNNING, false)
  const cpu = getCPU() as any
  cpu.setSaveState(saved.state6502.cpu65816)
  dump("prompt")
  key("Space", 0x20)
  dump("afterKey")
  for (let f = 2000; f <= 12000; f += 2000) {
    pump(2000)
    dump(`menu${f}`)
  }
  const state = doGetSaveState(true)
  fs.writeFileSync(SAVE_OUT, JSON.stringify(state))
  console.log(`[NFC-RESUME] saved ${SAVE_OUT} ${fs.statSync(SAVE_OUT).size} bytes cycles=${state.state6502.s6502.cycleCount}`)
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 900000)
