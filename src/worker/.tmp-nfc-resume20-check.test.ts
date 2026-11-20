import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { getShrDisplayed, gsRAM } from "./memory"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { doRestoreSaveState } from "./save_restore"
import * as fs from "fs"
import * as crypto from "crypto"

const SAVE_IN = process.env.NFC_SAVE_IN || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-menu-long-save.json"
const MEM_IN = process.env.NFC_MEM || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-snapshot\\prompt-memory-full.bin"
const OUT_DIR = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-resume20-check"
const REF_SHr = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-menu-long\\menu20000-shr.bin"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

test("check restored 20k state with full fast RAM", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  const saved = JSON.parse(fs.readFileSync(SAVE_IN, "utf8"))
  doRestoreSaveState(saved, true, false, 2.0)
  doSetRunMode(RUN_MODE.RUNNING, false)
  const cpu = getCPU() as any
  cpu.setSaveState(saved.state6502.cpu65816)
  const full = fs.readFileSync(MEM_IN)
  for (let bank = 0x02; bank < 0x80; bank++) {
    gsRAM.set(full.subarray(bank * 0x10000, (bank + 1) * 0x10000), bank * 0x10000)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const shr = getShrDisplayed()
  fs.writeFileSync(`${OUT_DIR}\\restored-shr.bin`, shr)
  const ref = fs.readFileSync(REF_SHr)
  const diffs = Array.from(shr).reduce((n, b, i) => n + (b === ref[i] ? 0 : 1), 0)
  console.log(`[NFC-CHECK] restored PB=${cpu.PB.toString(16)} PC=${cpu.PC.toString(16)} cycles=${cpu.cycles} diffs=${diffs}/${shr.length} sha=${crypto.createHash("sha1").update(shr).digest("hex")} refsha=${crypto.createHash("sha1").update(ref).digest("hex")}`)
  pump(2000)
  const shr20 = getShrDisplayed()
  fs.writeFileSync(`${OUT_DIR}\\after2000-shr.bin`, shr20)
  console.log(`[NFC-CHECK] after2000 PB=${cpu.PB.toString(16)} PC=${cpu.PC.toString(16)} cycles=${cpu.cycles} sha=${crypto.createHash("sha1").update(shr20).digest("hex")}`)
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 300000)
