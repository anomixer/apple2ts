import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { getShrDisplayed, getShr, getTextPageAsString, memGet24 } from "./memory"
import { doGetSaveState, doRestoreSaveState } from "./save_restore"
import { getDriveStateByIndex } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"
import { createHash } from "crypto"

const SAVE_IN = process.env.NFC_SAVE_IN || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-bbs-save\\after5000-state.json"
const OUT_DIR = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-bbs-long"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

const dump = (label: string) => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const shr = getShrDisplayed()
  const raw = getShr()
  fs.writeFileSync(`${OUT_DIR}\\${label}-shr.bin`, shr)
  fs.writeFileSync(`${OUT_DIR}\\${label}-raw-shr.bin`, raw)
  fs.writeFileSync(`${OUT_DIR}\\${label}.txt`, getTextPageAsString())
  const cpu = getCPU() as any
  const drive = getDriveStateByIndex(0)
  const pic = shr.subarray(0, 0x7d00)
  const rawPic = raw.subarray(0, 0x7d00)
  const nz = (a: Uint8Array) => a.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0)
  const h = (a: Uint8Array) => createHash("sha1").update(a).digest("hex").slice(0, 10)
  const regs = [0xc029, 0xc035, 0xc036, 0xc000, 0xc02e, 0xc02f].map(a => `$${a.toString(16).padStart(4, "0")}=${memGet24(a).toString(16)}`).join(" ")
  console.log(`[NFC-BBS-LONG] ${label} PB=${cpu.PB.toString(16)} PC=${cpu.PC.toString(16)} A=${cpu.A.toString(16)} X=${cpu.X.toString(16)} Y=${cpu.Y.toString(16)} S=${cpu.S.toString(16)} E=${cpu.emulationMode} cycles=${cpu.cycles} ${regs}`)
  console.log(`[NFC-BBS-LONG] drive track=${drive.quarterTrack} motor=${drive.motorRunning} status=${drive.status} shrDisplayed=${h(shr)} nz=${nz(pic)} raw=${h(raw)} nzRaw=${nz(rawPic)}`)
}

test("continue NFCDemo BBS-Demo from 5000 loaded/decrunched screen", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  const saved = JSON.parse(fs.readFileSync(SAVE_IN, "utf8"))
  doRestoreSaveState(saved, true, false, 2.0)
  doSetRunMode(RUN_MODE.RUNNING, false)
  doRestoreSaveState(saved, false, false, 2.0)
  const cpu = getCPU() as any
  cpu.setSaveState(saved.state6502.cpu65816)
  dump("restored5000")
  for (let f = 5000; f <= 30000; f += 5000) {
    pump(5000)
    dump(`after${f + 5000}`)
    if (f === 5000 || f === 15000) {
      fs.writeFileSync(`${OUT_DIR}\\after${f + 5000}-state.json`, JSON.stringify(doGetSaveState(true)))
    }
  }
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 3000000)
