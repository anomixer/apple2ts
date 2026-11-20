import { doSetMachineName, getCPU } from "./motherboard"
import { memGet24, megaIIMain, megaIIAux, gsRAM } from "./memory"
import { doRestoreSaveState } from "./save_restore"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const CURRENT_SAVE = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-paused-current-save.json"
const CURRENT_MEM = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-paused-current-memory.bin"
const OLD_MEM = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-snapshot\\prompt-memory-full.bin"

const hex = (v: number, n = 2) => v.toString(16).padStart(n, "0")
const bytesAt = (base: number, count = 16) => {
  const out = []
  for (let i = 0; i < count; i++) out.push(hex(memGet24((base + i) & 0xffff), 2))
  return out.join("")
}

test("check what a restored trace actually sees in bank 0", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  doRestoreSaveState(JSON.parse(fs.readFileSync(CURRENT_SAVE).toString("utf8")), false, false, 2.0)
  const cpu = getCPU() as any
  const lines = [] as string[]
  lines.push(`CPU PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} S=${hex(cpu.S, 3)} A=${hex(cpu.A, 4)} X=${hex(cpu.X, 4)} P=${hex(cpu.P, 2)}`)
  lines.push(`BANK0 1e0 ${bytesAt(0x1e0)}`)
  lines.push(`BANK0 1e8 ${bytesAt(0x1e8)}`)
  lines.push(`BANK0 1ec ${bytesAt(0x1ec)}`)
  lines.push(`BANK0 1f6 ${bytesAt(0x1f6)}`)
  const cur = fs.readFileSync(CURRENT_MEM)
  const old = fs.readFileSync(OLD_MEM)
  lines.push(`BIN CURRENT bank0 1e0 ${[...cur.subarray(0x1e0, 0x1f0)].map((v) => hex(v, 2)).join("")}`)
  lines.push(`BIN OLD bank0 1e0 ${[...old.subarray(0x1e0, 0x1f0)].map((v) => hex(v, 2)).join("")}`)
  lines.push(`BIN CURRENT bank0 1e8 ${[...cur.subarray(0x1e8, 0x1fa)].map((v) => hex(v, 2)).join("")}`)
  lines.push(`BIN OLD bank0 1e8 ${[...old.subarray(0x1e8, 0x1fa)].map((v) => hex(v, 2)).join("")}`)
  lines.push(`BIN CURRENT bank0 1ea ${[...cur.subarray(0x1ea, 0x1fc)].map((v) => hex(v, 2)).join("")}`)
  lines.push(`BIN OLD bank0 1ea ${[...old.subarray(0x1ea, 0x1fc)].map((v) => hex(v, 2)).join("")}`)
  // Read the handler bytes from ROM after restore.  bank $FF is ROM, not
  // part of the 8 MB fast-RAM dump.
  let rom = ""
  for (let i = 0; i < 40; i++) rom += hex(memGet24((0xFF << 16) | (0xBA66 + i)), 2) + " "
  lines.push(`ROM FFBA66 ${rom}`)
  // What is actually in the Mega II banks after restore?
  let e1 = ""
  for (let i = 0x1e0; i < 0x1f0; i++) e1 += hex(megaIIAux[i], 2) + " "
  lines.push(`MEGAII AUX 1e0 ${e1}`)
  let e0 = ""
  for (let i = 0x1e0; i < 0x1f0; i++) e0 += hex(megaIIMain[i], 2) + " "
  lines.push(`MEGAII MAIN 1e0 ${e0}`)
  fs.writeFileSync("C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-restore-check.txt", lines.join("\n"))
  console.log(`[NFC-RESTORE-CHECK]\n${lines.join("\n")}`)
  jest.useRealTimers()
}, 60000)
