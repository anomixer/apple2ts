import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { memGet24 } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { setKeyboardState } from "./devices/keyboard"
import * as fs from "fs"

const DISK_PATH = process.env.NFC_PATH || "C:\\dev\\emu\\ap2\\DISKS\\NFCDemoDrive.2mg"
const OUT_PATH = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-frame-origin.txt"

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

test("trace NFCDemo frame origin from fresh boot to prompt", () => {
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

  const cpu = getCPU() as any
  const log: string[] = []
  const MAX_STACK = 20000
  const MAX_INTERRUPT = 5000
  let stackWrites = 0
  let interrupts = 0
  let curInstr = ""

  log.push(`BOOT INITIAL stack 1e0=${bytesAt(0x1e0)}`)

  const origInterrupt = cpu.interrupt.bind(cpu)
  cpu.interrupt = (...args: any[]) => {
    if (interrupts < MAX_INTERRUPT) {
      interrupts++
      log.push(`INTERRUPT ENTER PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} A=${hex(cpu.A, 4)} X=${hex(cpu.X, 4)} Y=${hex(cpu.Y, 4)} S=${hex(cpu.S, 3)} P=${hex(cpu.P)} em=${cpu.emulationMode} vec=${hex(args[0] as number, 4)}/${hex(args[1] as number, 4)} soft=${args[2]} stackS=${bytesAt(cpu.S, 12)} stack0=${bytesAt(0x1e0, 20)} cause=${curInstr}`)
    }
    return origInterrupt.apply(cpu, args as any)
  }

  const origWrite8 = cpu.write8.bind(cpu)
  cpu.write8 = (address: number, value: number) => {
    if (address >= 0x1e0 && address <= 0x200 && stackWrites < MAX_STACK) {
      stackWrites++
      log.push(`STACKWRITE @${hex(address, 6)}=${hex(value & 0xff, 2)} PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} S=${hex(cpu.S, 3)} E=${cpu.emulationMode} cause=${curInstr}`)
    }
    return origWrite8(address, value)
  }

  const orig = cpu.processInstruction.bind(cpu)
  cpu.processInstruction = (cb: any) => {
    const addr = ((cpu.PB << 16) | cpu.PC) & 0xffffff
    const op = memGet24(addr, false)
    curInstr = `PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} OP=${hex(op, 2)} S=${hex(cpu.S, 3)} P=${hex(cpu.P)}`
    if (op === 0x6b) {
      const bytes = [1, 2, 3, 4].map((d) => memGet24(((cpu.S + d) & 0xffff)).toString(16).padStart(2, "0"))
      log.push(`RTL PC=${hex(cpu.PB, 2)}:${hex(cpu.PC, 4)} S=${hex(cpu.S, 3)} stackSp=${bytes.join("")}`)
    }
    if (op === 0x40) {
      const bytes = [1, 2, 3, 4].map((d) => memGet24(((cpu.S + d) & 0xffff)).toString(16).padStart(2, "0"))
      log.push(`RTI PC=${hex(cpu.PB, 2)}:${hex(cpu.PC, 4)} S=${hex(cpu.S, 3)} stackSp=${bytes.join("")}`)
    }
    return orig(cb)
  }

  pump(300)
  key("ArrowDown")
  key("ArrowDown")
  key("Enter", 13)
  pump(9500)
  log.push(`PRE-SPACE state PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} S=${hex(cpu.S, 3)} stackS=${bytesAt(cpu.S, 12)} stack0=${bytesAt(0x1e0, 20)}`)
  key("Space", 0x20, 10, 500)
  log.push(`POST-SPACE state PB=${hex(cpu.PB, 2)} PC=${hex(cpu.PC, 4)} S=${hex(cpu.S, 3)} stackS=${bytesAt(cpu.S, 12)} stack0=${bytesAt(0x1e0, 20)}`)
  fs.writeFileSync(OUT_PATH, log.join("\n"))
  console.log(`[NFC-ORIGIN] wrote ${log.length} lines to ${OUT_PATH} stackWrites=${stackWrites} interrupts=${interrupts}`)
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 900000)
