import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { getShrDisplayed, getShr, getTextPageAsString } from "./memory"
import { doGetSaveState, doRestoreSaveState } from "./save_restore"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"
import { createHash } from "crypto"

const SAVE_IN = process.env.NFC_SAVE_IN || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-bbs-key\\afterKey3200-state.json"
const OUT_DIR = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-after-space"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

const dump = (label: string) => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const shr = getShrDisplayed()
  const raw = getShr()
  fs.writeFileSync(`${OUT_DIR}\\${label}-shr.bin`, shr)
  fs.writeFileSync(`${OUT_DIR}\\${label}-raw-shr.bin`, raw)
  const text = getTextPageAsString()
  fs.writeFileSync(`${OUT_DIR}\\${label}.txt`, text)
  const cpu = getCPU() as any
  const h = (a: Uint8Array) => createHash("sha1").update(a).digest("hex").slice(0, 10)
  const nz = shr.subarray(0, 0x7d00).reduce((n, v) => n + (v !== 0 ? 1 : 0), 0)
  console.log(`[NFC-AFTER] ${label} PB=${cpu.PB.toString(16)} PC=${cpu.PC.toString(16)} A=${cpu.A.toString(16)} X=${cpu.X.toString(16)} Y=${cpu.Y.toString(16)} S=${cpu.S.toString(16)} D=${cpu.D.toString(16)} P=${cpu.P.toString(16)} stopped=${cpu.stopped} waiting=${cpu.waiting} cycles=${cpu.cycles} shr=${h(shr)} nz=${nz} raw=${h(raw)}`)
  console.log(`[NFC-AFTER-TEXT] ${label} ${text.replace(/\r/g, "\n").slice(0, 200).replace(/\n/g, "\\n")}`)
  if (/BRK|MON|11\/000C/i.test(text.replace(/\r/g, "\n"))) {
    console.log(`[NFC-AFTER-BRK-CANDIDATE] ${label}`)
  }
}

test("continue NFCDemo after intro until menu or BRK", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  const saved = JSON.parse(fs.readFileSync(SAVE_IN, "utf8"))
  doRestoreSaveState(saved, true, false, 2.0)
  doSetRunMode(RUN_MODE.RUNNING, false)
  doRestoreSaveState(saved, false, false, 2.0)
  const cpu = getCPU() as any
  cpu.setSaveState(saved.state6502.cpu65816)
  dump("restored3200")
  for (let f = 0; f < 60000; f += 5000) {
    pump(5000)
    dump(`after${f + 5000}`)
  }
  fs.writeFileSync(`${OUT_DIR}\\final-state.json`, JSON.stringify(doGetSaveState(true)))
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 3000000)
