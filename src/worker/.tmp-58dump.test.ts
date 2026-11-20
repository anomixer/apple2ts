// TEMPORARY probe: dump bank-0 $5800-$5FFF at the first execution of code in that region.
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

const hexRange = (start: number, end: number): string => {
  let out = ""
  for (let a = start; a < end; a++) out += memGet24(a).toString(16).padStart(2, "0")
  return out
}

describe("bank0 5800 dump at first entry", () => {
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

  test("dump", () => {
    if (!hasDisks) { console.warn("disks missing"); return }
    mount(4, D1)
    mount(5, D2)
    doSetSpeedMode(1)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)

    const cpu = getCPU() as CPU65816
    const ring: string[] = []
    let frame = 0
    let dumped = false
    const orig = cpu.executeOpcode.bind(cpu)
    cpu.executeOpcode = (op: number) => {
      const pb = cpu.PB & 0xff
      const pc = (cpu.PC - 1) & 0xffff
      const hit = pb === 0 && pc >= 0x5800 && pc < 0x6000
      if (hit && !dumped) {
        dumped = true
        console.log(`[x] entry f=${frame} cyc=${s6502.cycleCount} pc=00:${pc.toString(16)} op=${op.toString(16)} A=${cpu.A.toString(16)} X=${cpu.X.toString(16)} Y=${cpu.Y.toString(16)} P=${cpu.P.toString(16)} D=${(cpu as any).D?.toString(16)} S=${cpu.S.toString(16)}`)
        console.log(`[x] ring ${ring.slice(-120).join(" ")}`)
        for (let base = 0x5800; base < 0x6000; base += 0x100) {
          console.log(`[x] mem ${base.toString(16)}=${hexRange(base, base + 0x100)}`)
        }
        console.log(`[x] b2 1fe0=${hexRange(0x021fe0, 0x022020)}`)
        console.log(`[x] b2 0000=${hexRange(0x020000, 0x020040)}`)
      }
      orig(op)
      ring.push(`${pb.toString(16).padStart(2, "0")}:${pc.toString(16).padStart(4, "0")}`)
      if (ring.length > 200) ring.shift()
    }
    for (; frame < FRAMES && !dumped; frame++) {
      jest.advanceTimersByTime(17)
    }
    console.log(`[x] done frames=${frame} dumped=${dumped}`)
    if (!dumped) {
      console.log(`[x] mem ${hexRange(0x5800, 0x5900)}`)
    }
  }, 1800000)
})
