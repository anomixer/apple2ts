import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { getShrDisplayed, getShr, getTextPageAsString } from "./memory"
import { doRestoreSaveState } from "./save_restore"
import { setKeyboardState } from "./devices/keyboard"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"
import { createHash } from "crypto"

const SAVE_IN = process.env.NFC_SAVE_IN || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-postintro\\afterSpace1500-state.json"
const OUT_DIR = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-postintro-keys"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

const dump = (label: string) => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const shr = getShrDisplayed()
  fs.writeFileSync(`${OUT_DIR}\\${label}-shr.bin`, shr)
  fs.writeFileSync(`${OUT_DIR}\\${label}.txt`, getTextPageAsString())
  const cpu = getCPU() as any
  const h = createHash("sha1").update(shr).digest("hex")
  console.log(`[NFC-POSTKEYS] ${label} PB=${cpu.PB.toString(16)} PC=${cpu.PC.toString(16)} A=${cpu.A.toString(16)} X=${cpu.X.toString(16)} Y=${cpu.Y.toString(16)} S=${cpu.S.toString(16)} D=${cpu.D.toString(16)} P=${cpu.P.toString(16)} shr=${h}`)
  console.log(`[NFC-POSTKEYS-TEXT] ${label} ${JSON.stringify(getTextPageAsString().slice(0, 120))}`)
}

const key = (domCode: string, keyCode = -1, hold = 2, after = 200) => {
  setKeyboardState({ key: keyCode, isDown: true, repeat: false, domCode })
  pump(hold)
  setKeyboardState({ key: keyCode, isDown: false, repeat: false, domCode })
  pump(after)
}

test("NFCDemo post-intro arrow/enter keys", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  const saved = JSON.parse(fs.readFileSync(SAVE_IN, "utf8"))
  doRestoreSaveState(saved, true, false, 2.0)
  doSetRunMode(RUN_MODE.RUNNING, false)
  doRestoreSaveState(saved, false, false, 2.0)
  const cpu = getCPU() as any
  cpu.setSaveState(saved.state6502.cpu65816)
  dump("restored")
  pump(100)
  dump("pumped100")
  key("ArrowDown")
  dump("arrowDown")
  key("Enter", 13)
  pump(5000)
  dump("enter5000")
  fs.writeFileSync(`${OUT_DIR}\\enter5000-state.json`, JSON.stringify(doGetSaveState(true)))
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 600000)
