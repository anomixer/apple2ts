import { doSetRunMode, getCPU } from "./motherboard"
import { memGet24, gsRAM, megaIIAux } from "./memory"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { setKeyboardState } from "./devices/keyboard"
import { doRestoreSaveState } from "./save_restore"
import * as fs from "fs"

const SAVE_IN = process.env.NFC_SAVE_IN || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-prompt-save.json"
const MEM_IN = process.env.NFC_MEM === ""
  ? null
  : (process.env.NFC_MEM || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-snapshot\\prompt-memory-full.bin")
const TRACE_PATH = process.env.NFC_TRACE || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-trace-prompt-key.txt"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

test("trace NFCDemo keyboard path after restored prompt", () => {
  jest.useFakeTimers()
  setIsTesting()
  const saved = JSON.parse(fs.readFileSync(SAVE_IN, "utf8"))
  const stack = () => Array.from({length: 16}, (_, i) => memGet24(0x1e0 + i).toString(16).padStart(2, "0")).join("")
  doRestoreSaveState(saved, true, false, 2.0)
  // Starting the run mode synchronously executes a catch-up refresh. It must
  // happen before the final restore, otherwise the trace starts from CPU state
  // after that refresh rather than from the snapshot the fixture was captured
  // at. Re-apply the paused snapshot after the machine configuration and timer
  // setup, with neither CPU run nor timer pump.
  doSetRunMode(RUN_MODE.RUNNING, false)
  if (process.env.NFC_NO_REAPPLY !== "YES") {
    doRestoreSaveState(saved, false, false, 2.0)
  }
  const cpu = getCPU() as any
  cpu.setSaveState(saved.state6502.cpu65816)
  if (MEM_IN) {
    const full = fs.readFileSync(MEM_IN)
    // The paused dump covers banks $00-$7F. Banks $02-$7F are the linear fast
    // RAM array; banks $00/$01 and $E0/$E1 are restored by doRestoreSaveState.
    // Do not overwrite the saved Mega II / I/O state from this raw dump.
    for (let bank = 0x02; bank < 0x80; bank++) {
      gsRAM.set(full.subarray(bank * 0x10000, (bank + 1) * 0x10000), bank * 0x10000)
    }
  }
  console.log(`[NFC-TRACE] restored stack=${stack()}`)
  console.log(`[NFC-TRACE] bytes 11:dba3 now ${memGet24(0x11dba3).toString(16)} vec FFE6=${memGet24(0xFFE6).toString(16)} FFEE=${memGet24(0xFFEE).toString(16)}`)

  const ring: string[] = []
  const cap = 300000
  const orig = cpu.processInstruction.bind(cpu)
  cpu.processInstruction = (cb: any) => {
    const pb = cpu.PB
    const pc = cpu.PC
    const addr = (pb << 16) | pc
    const opcode = memGet24(addr, false)
    if (ring.length < cap) {
      let extra = ""
      if (opcode === 0x6b) {
        const bytes = [1, 2, 3].map((d) => memGet24(((cpu.S + d) & 0xffff)).toString(16).padStart(2, "0"))
        extra = ` STACK=${bytes.join("")}`
      }
      ring.push(`PC=${pb.toString(16).padStart(2, "0")}:${pc.toString(16).padStart(4, "0")} OP=${opcode.toString(16).padStart(2, "0")} A=${cpu.A.toString(16)} X=${cpu.X.toString(16)} Y=${cpu.Y.toString(16)} S=${cpu.S.toString(16)} P=${cpu.P.toString(16)}${extra}`)
    }
    return orig(cb)
  }

  setKeyboardState({ key: 0x20, isDown: true, repeat: false, domCode: "Space" })
  pump(10)
  setKeyboardState({ key: 0x20, isDown: false, repeat: false, domCode: "Space" })
  pump(500)
  fs.writeFileSync(TRACE_PATH, ring.join("\n"))
  console.log(`[NFC-TRACE] wrote ${ring.length} instructions to ${TRACE_PATH}`)
  console.log(`[NFC-TRACE] cycle=${cpu.cycles} global=${(globalThis as any)?.s6502?.cycleCount ?? "?"}`)
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 900000)
