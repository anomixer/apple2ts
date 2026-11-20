import { getCPU, doSetRunMode } from "./motherboard"
import { gsSystemROM } from "./memory"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { doRestoreSaveState } from "./save_restore"
import * as fs from "fs"

test("dump ROM bytes for NFCDemo trace", () => {
  setIsTesting()
  const saved = JSON.parse(fs.readFileSync("C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-prompt-save.json", "utf8"))
  doRestoreSaveState(saved, true, false, 2.0)
  // Force ROM load the same way a run would.
  doSetRunMode(RUN_MODE.RUNNING, false)
  doSetRunMode(RUN_MODE.PAUSED, false)
  const hex = (off: number, len: number) => [...gsSystemROM.subarray(0x10000 + off, 0x10000 + off + len)]
    .map((x) => x.toString(16).padStart(2, "0")).join(" ")
  console.log(`[ROM] len=${gsSystemROM.length}`)
  console.log(`BA30 ${hex(0xba30, 64)}`)
  console.log(`BA70 ${hex(0xba70, 64)}`)
  console.log(`B8F0 ${hex(0xb8f0, 64)}`)
  console.log(`B7C0 ${hex(0xb7c0, 64)}`)
  console.log(`B5DF ${hex(0xb5df, 64)}`)
  fs.writeFileSync("C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\gs-rom-ba30-baaf.bin", Buffer.from(gsSystemROM.subarray(0x10000 + 0xba30, 0x10000 + 0xbaaf)))
}, 60000)
