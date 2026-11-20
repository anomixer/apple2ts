import { doSetMachineName, doSetRunMode, doSetSpeedMode, resetCpuSpeedForTesting, doBoot, getCPU } from "./motherboard"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { setKeyboardState } from "./devices/keyboard"
import { MouseCardEvent } from "./devices/mouse"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { getCurrentMemory, memGet24, iigsRegisters, iigsShrScb, megaIIAux } from "./memory"
import * as fs from "fs"

const DISK_PATH = process.env.MODULAE_DISK ||
  "C:\\dev\\emu\\ap2\\DISKS\\modulae (1990)(free tools association).2mg"
const OUT_DIR = process.env.MODULAE_OUT || "C:\\dev\\apple2ts\\.tmp-modulae-stage"

test("modulae staged probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    doSetSpeedMode(1)
    expect(doSetEmuDriveNewData({
      index: 4, hardDrive: false, drive: 1,
      filename: DISK_PATH.split("\\").pop()!, status: "",
      motorRunning: false, diskHasChanges: false, isWriteProtected: false,
      diskData: new Uint8Array(fs.readFileSync(DISK_PATH)),
      lastAppleWriteTime: 0, cloudData: null, writableFileHandle: null,
      lastLocalFileWriteTime: 0,
    } as any)).toBe(true)
    doBoot()
    doSetRunMode(RUN_MODE.RUNNING, false)
    fs.mkdirSync(OUT_DIR, { recursive: true })

    const cpu = getCPU() as any
    let curFrame = 0
    const irqs: string[] = []
    const writes: string[] = []
    const scbWrites: string[] = []
    const handler: string[] = []
    const pcs: string[] = []
    let irqFrame = -1
    const snapFrames = (process.env.MODULAE_SNAPS || "1600,1619,1700,1800,2000,2400,2560,2589,2600")
      .split(",").map(Number)
    const origInt = cpu.interrupt.bind(cpu)
    cpu.interrupt = function (this: any, n: number, e: number, s: boolean) {
      irqFrame = curFrame
      irqs.push(`f${curFrame} int native=${n.toString(16)} em=${e.toString(16)} sw=${s} PC=${this.PB.toString(16)}:${this.PC.toString(16)} D=${this.D.toString(16)} c023=${iigsRegisters[0x23].toString(16)} c041=${iigsRegisters[0x41].toString(16)} ff6=${memGet24(0xFF6).toString(16)}`)
      return origInt(n, e, s)
    }
    const origWrite = cpu.write8.bind(cpu)
    cpu.write8 = function (this: any, addr: number, val: number) {
      const a = addr & 0xFFFFFF
      if ((a & 0xFFFF) === 0x0FF6 || (a & 0xFFFF) === 0x00F6) {
        writes.push(`f${curFrame} write ${a.toString(16)} val=${val.toString(16)} PC=${this.PB.toString(16)}:${this.PC.toString(16)} D=${this.D.toString(16)}`)
      }
      if ((a & 0xFFFF) === 0x9DC7 || (a & 0xFFFF) === 0xC023 || (a & 0xFFFF) === 0xC029 ||
          (a & 0xFFFF) === 0xC035 || (a & 0xFFFF) === 0xC036) {
        scbWrites.push(`f${curFrame} write ${a.toString(16)} val=${val.toString(16)} PC=${this.PB.toString(16)}:${this.PC.toString(16)} D=${this.D.toString(16)}`)
      }
      return origWrite(addr, val)
    }
    const origPI = cpu.processInstruction.bind(cpu)
    cpu.processInstruction = function (this: any, traceCb: any) {
      const trace = irqFrame === curFrame && this.PB === 0x02 &&
        this.PC >= 0xE868 && this.PC < 0xE970
      if (trace) {
        handler.push(`f${curFrame} pc=${this.PC.toString(16)} A=${this.A.toString(16)} X=${this.X.toString(16)} Y=${this.Y.toString(16)} D=${this.D.toString(16)} M=${this.M ? 1 : 0} I=${this.I ? 1 : 0} c023=${iigsRegisters[0x23].toString(16)}`)
      }
      const before = `${this.PB.toString(16)}:${this.PC.toString(16)}`;
      const r = origPI(traceCb)
      if (snapFrames.includes(curFrame) && curFrame === (snapFrames.find(f => f >= curFrame) ?? 0)) {
        // no-op, snapshots handled after the frame
      }
      return r
    }

    const frames = Number(process.env.MODULAE_FRAMES || 2600)
    for (let f = 1; f <= frames; f++) {
      curFrame = f
      jest.advanceTimersByTime(17)
      if (f === 700) setKeyboardState({ key: 27, isDown: true, repeat: false, domCode: "Escape" })
      if (f === 702) setKeyboardState({ key: 27, isDown: false, repeat: false, domCode: "Escape" })
      if (f % 600 === 30) MouseCardEvent({ x: 0.75, y: 0.25, buttons: -1, relative: false })
      if (f % 600 === 100) MouseCardEvent({ x: 0.5, y: 0.5, buttons: 0x10, relative: false })
      if (f % 600 === 102) MouseCardEvent({ x: 0.5, y: 0.5, buttons: 0x00, relative: false })
      if (snapFrames.includes(f)) {
        fs.writeFileSync(`${OUT_DIR}\\mem-${f}.bin`, getCurrentMemory())
        fs.writeFileSync(`${OUT_DIR}\\bank0-3C90-${f}.bin`, Buffer.from(Array.from({ length: 128 }, (_, i) => memGet24(0x003C90 + i))))
        pcs.push(`f${f} PC=${cpu.PB.toString(16)}:${cpu.PC.toString(16)} D=${cpu.D.toString(16)} ff6=${memGet24(0xFF6).toString(16)} scb199=${iigsShrScb(199).toString(16)} aux9dc7=${megaIIAux[0x9DC7].toString(16)} c023=${iigsRegisters[0x23].toString(16)} c036=${iigsRegisters[0x36].toString(16)} c035=${iigsRegisters[0x35].toString(16)} c029=${iigsRegisters[0x29].toString(16)}`)
      }
    }
    fs.writeFileSync(`${OUT_DIR}\\irqs.txt`, irqs.join("\n"))
    fs.writeFileSync(`${OUT_DIR}\\writes.txt`, writes.join("\n"))
    fs.writeFileSync(`${OUT_DIR}\\handler.txt`, handler.join("\n"))
    fs.writeFileSync(`${OUT_DIR}\\scb-writes.txt`, scbWrites.join("\n"))
    fs.writeFileSync(`${OUT_DIR}\\snaps.txt`, pcs.join("\n"))
    fs.writeFileSync(`${OUT_DIR}\\mem-end.bin`, getCurrentMemory())
    console.log(`IRQs ${irqs.length}, writes ${writes.length}`)
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
