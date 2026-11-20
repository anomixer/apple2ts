// TEMPORARY probe: instruction-by-instruction trace right after entering bank0 $58A3.
import * as fs from "fs"
import { doSetMachineName, doSetSpeedMode, doSetRunMode, resetCpuSpeedForTesting, getCPU } from "./motherboard"
import { memGet24 } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { CPU65816 } from "./cpu65816"
import { s6502 } from "./instructions"

const D1 = "C:\\dev\\emu\\ap2\\DISKS\\rastan1.woz"
const D2 = "C:\\dev\\emu\\ap2\\DISKS\\rastan2.woz"
const hasDisks = fs.existsSync(D1) && fs.existsSync(D2)
const FRAMES = 9000

const mount = (index: number, path: string) => {
  const data = new Uint8Array(fs.readFileSync(path))
  expect(doSetEmuDriveNewData({
    index, hardDrive: false, drive: index === 5 ? 2 : 1,
    filename: path.split("\\").pop() || "disk", status: "", motorRunning: false,
    diskHasChanges: false, isWriteProtected: false, diskData: data,
    lastAppleWriteTime: 0, cloudData: null, writableFileHandle: null,
    lastLocalFileWriteTime: 0,
  } as DriveProps)).toBe(true)
}

describe("trace after 58A3", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    setIsTesting()
    doSetMachineName("APPLE2GS")
  })
  afterEach(() => {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  })

  test("trace", () => {
    if (!hasDisks) { console.warn("disks missing"); return }
    mount(4, D1)
    mount(5, D2)
    doSetSpeedMode(1)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)

    const cpu = getCPU() as CPU65816
    let frame = 0
    let armed = false
    let count = 0
    const CAPTURE = 300
    const orig = cpu.executeOpcode.bind(cpu)
    cpu.executeOpcode = (op: number) => {
      const pb = cpu.PB & 0xff
      let pc = (cpu.PC - 1) & 0xffff
      if (!armed && frame >= 7600 && pb === 0 && pc === 0x58a3) {
        armed = true
        console.log(`[x] entry f=${frame} cyc=${s6502.cycleCount} A=${cpu.A.toString(16)} X=${cpu.X.toString(16)} Y=${cpu.Y.toString(16)} P=${cpu.P.toString(16)} S=${cpu.S.toString(16)} e=${cpu.P & 0x100 ? 1 : 0}`)
        let st = ""
        for (let a = 0x130; a < 0x150; a++) st += memGet24(a).toString(16).padStart(2, "0")
        console.log(`[x] stack 130-14f=${st}`)
      }
      if (armed && count < CAPTURE) {
        const e = (cpu.P & 0x100) !== 0 ? 1 : 0
        const A = cpu.A & 0xffff
        const S = cpu.S & 0xffff
        orig(op)
        const next = (cpu.PC - 1) & 0xffff
        const len = ((next - pc) & 0xffff) < 0x100 ? ((next - pc) & 0xffff) : -1
        console.log(`[x] ${count.toString().padStart(3)} ${pb.toString(16).padStart(2, "0")}:${pc.toString(16).padStart(4, "0")} op=${op.toString(16).padStart(2, "0")} len=${len.toString(16)} e=${e} A=${A.toString(16)} S=${S.toString(16)} -> ${pb.toString(16)}:${next.toString(16)}`)
        count++
        return
      }
      orig(op)
    }
    for (; frame < FRAMES; frame++) {
      jest.advanceTimersByTime(17)
      if (count >= CAPTURE) break
    }
    console.log(`[x] done frames=${frame} count=${count}`)
  }, 1800000)
})
