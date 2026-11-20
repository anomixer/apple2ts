import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { memGet24, gsRAM } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { setKeyboardState } from "./devices/keyboard"
import { doGetSaveState } from "./save_restore"
import * as fs from "fs"

const DISK_PATH = process.env.NFC_PATH || "C:\\dev\\emu\\ap2\\DISKS\\NFCDemoDrive.2mg"
const TRACE_PATH = process.env.NFC_TRACE || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-current-trace-key.txt"
const MEM_OUT = process.env.NFC_MEM_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-current-memory-full.bin"
const SAVE_OUT = process.env.NFC_SAVE_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-current-save.json"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

const hex = (v: number, n = 2) => v.toString(16).padStart(n, "0")
const bytesAt = (base: number, count = 16) => {
  const out = []
  for (let i = 0; i < count; i++) out.push(hex(memGet24((base + i) & 0xffff), 2))
  return out.join("")
}

const key = (domCode: string, keyCode = -1, hold = 10, after = 60) => {
  setKeyboardState({ key: keyCode, isDown: true, repeat: false, domCode })
  pump(hold)
  setKeyboardState({ key: keyCode, isDown: false, repeat: false, domCode })
  pump(after)
}

test("trace current fresh-boot NFCDemo prompt key path", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  const data = fs.readFileSync(DISK_PATH)
  const props: DriveProps = {
    index: 0, hardDrive: true, drive: 1, filename: "NFCDemoDrive.2mg", status: "",
    motorRunning: false, diskHasChanges: false, isWriteProtected: false,
    diskData: new Uint8Array(data), lastAppleWriteTime: 0, cloudData: null,
    writableFileHandle: null, lastLocalFileWriteTime: 0,
  }
  expect(doSetEmuDriveNewData(props)).toBe(true)
  doSetRunMode(RUN_MODE.NEED_BOOT)
  doSetRunMode(RUN_MODE.RUNNING, false)

  pump(300)
  key("ArrowDown")
  key("ArrowDown")
  key("Enter", 13)
  pump(9500)

  const cpu = getCPU() as any
  const state = doGetSaveState(true)
  fs.writeFileSync(SAVE_OUT, JSON.stringify(state))
  const banks = 128
  const mem = new Uint8Array(banks * 65536)
  for (let bank = 0; bank < banks; bank++) {
    const base = bank * 65536
    for (let addr = 0; addr < 65536; addr++) mem[bank * 65536 + addr] = memGet24(base + addr)
  }
  fs.writeFileSync(MEM_OUT, mem)
  const preStack = bytesAt(cpu.S, 16)
  const preStack0 = bytesAt(0x1e0, 16)

  const log: string[] = []
  log.push(`PRE-SPACE PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} S=${hex(cpu.S, 3)} P=${hex(cpu.P)} stackS=${preStack} stack0=${preStack0} cycles=${state.state6502.s6502.cycleCount}`)
  let writes = 0
  let interrupts = 0
  const origWrite8 = cpu.write8.bind(cpu)
  cpu.write8 = (address: number, value: number) => {
    if (address >= 0x1e0 && address <= 0x200 && writes < 3000) {
      writes++
      log.push(`WRITE @${hex(address, 6)}=${hex(value, 2)} PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} S=${hex(cpu.S, 3)}`)
    }
    return origWrite8(address, value)
  }
  const origInterrupt = cpu.interrupt.bind(cpu)
  cpu.interrupt = (...args: any[]) => {
    if (interrupts < 100) {
      interrupts++
      log.push(`INTERRUPT ENTER PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} S=${hex(cpu.S, 3)} P=${hex(cpu.P)} em=${cpu.emulationMode} vec=${args[0]}/${args[1]} soft=${args[2]} stack=${bytesAt(cpu.S, 12)}`)
    }
    return origInterrupt.apply(cpu, args as any)
  }

  const ring: string[] = []
  const cap = 300000
  const orig = cpu.processInstruction.bind(cpu)
  cpu.processInstruction = (cb: any) => {
    const pb = cpu.PB
    const pc = cpu.PC
    const addr = ((pb << 16) | pc) & 0xffffff
    const opcode = memGet24(addr, false)
    if (ring.length < cap) {
      let extra = ""
      if (opcode === 0x6b || opcode === 0x40 || opcode === 0x00 || opcode === 0x02 || opcode === 0x20) {
        const bytes = [1, 2, 3].map((d) => memGet24(((cpu.S + d) & 0xffff)).toString(16).padStart(2, "0"))
        extra = ` STACK=${bytes.join("")}`
        if (writes < 3000) log.push(`EVENT OP=${hex(opcode, 2)} PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} S=${hex(cpu.S, 3)} P=${hex(cpu.P)} stack=${bytesAt(cpu.S, 8)}`)
      }
      ring.push(`PC=${hex(pb, 2)}:${hex(pc, 4)} OP=${hex(opcode, 2)} A=${hex(cpu.A, 4)} X=${hex(cpu.X, 4)} Y=${hex(cpu.Y, 4)} S=${hex(cpu.S, 3)} P=${hex(cpu.P)}${extra}`)
    }
    return orig(cb)
  }

  setKeyboardState({ key: 0x20, isDown: true, repeat: false, domCode: "Space" })
  pump(10)
  setKeyboardState({ key: 0x20, isDown: false, repeat: false, domCode: "Space" })
  pump(500)

  log.push(`POST-SPACE PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} S=${hex(cpu.S, 3)} P=${hex(cpu.P)} stackS=${bytesAt(cpu.S, 16)} stack0=${bytesAt(0x1e0, 16)}`)
  fs.writeFileSync(TRACE_PATH, ring.join("\n"))
  fs.writeFileSync(TRACE_PATH.replace(".txt", ".frame.txt"), log.join("\n"))
  console.log(`[NFC-CURTRACE] wrote ${ring.length} instructions to ${TRACE_PATH}`)
  console.log(`[NFC-CURTRACE] wrote ${log.length} frame lines`)
  console.log(`[NFC-CURTRACE] pre=${log[0]} post=${log[log.length - 1]}`)
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 900000)
