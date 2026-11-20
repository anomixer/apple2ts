import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { doRestoreSaveState, doGetSaveState } from "./save_restore"
import { setKeyboardState } from "./devices/keyboard"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const SAVE_IN = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-postintro-menu\\arrowDown2050-state.json"
const OUT_DIR = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-trace-entry"

const pump = (frames: number, stop?: () => boolean) => {
  for (let f = 0; f < frames; f++) {
    jest.advanceTimersByTime(17)
    if (stop && stop()) return
  }
}

test("NFCDemo trace entry into the 11:E009 loop", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  const saved = JSON.parse(fs.readFileSync(SAVE_IN, "utf8"))
  doRestoreSaveState(saved, true, false, 2.0)
  doSetRunMode(RUN_MODE.RUNNING, false)
  doRestoreSaveState(saved, false, false, 2.0)
  const cpu = getCPU() as any
  cpu.setSaveState(saved.state6502.cpu65816)

  const history: string[] = []
  let entryInfo: any = null
  let entryTrace: string[] | null = null
  let entryWriteIndex = 0
  const recorder = {
    strings: history,
    push(s: string) {
      this.strings.push(s)
      if (this.strings.length > 20000) this.strings.shift()
      if (entryInfo === null && /PC=11:e009 Opcode=bd/.test(s)) {
        entryInfo = { pb: cpu.PB, pc: cpu.PC, a: cpu.A, x: cpu.X, y: cpu.Y, s: cpu.S, d: cpu.D, p: cpu.P }
        entryTrace = this.strings.slice()
        entryWriteIndex = this.strings.length
      }
    },
    shift() {},
    get length() { return 0 },
    join(sep: string) { return this.strings.join(sep) },
  }
  cpu.traceBuffer = recorder
  cpu.dumped = false

  fs.mkdirSync(OUT_DIR, { recursive: true })
  setKeyboardState({ key: -1, isDown: true, repeat: false, domCode: "Enter" })
  pump(2)
  setKeyboardState({ key: -1, isDown: false, repeat: false, domCode: "Enter" })
  pump(8000, () => entryInfo !== null)

  fs.writeFileSync(`${OUT_DIR}\\entry-info.json`, JSON.stringify(entryInfo, null, 2))
  fs.writeFileSync(`${OUT_DIR}\\entry-trace.json`, JSON.stringify(entryTrace || history.slice(0, 500), null, 2))
  fs.writeFileSync(`${OUT_DIR}\\entry-writetick.json`, JSON.stringify({ entryWriteIndex }, null, 2))
  const state = doGetSaveState(true)
  fs.writeFileSync(`${OUT_DIR}\\state.json`, JSON.stringify(state))
  console.log(`[ENTRY] info=${JSON.stringify(entryInfo)} traceLen=${entryTrace?.length}`)
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 600000)
