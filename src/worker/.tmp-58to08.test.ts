// TEMPORARY probe: what leads our machine back to the $08A4 boot-loader loop?
import * as fs from "fs"
import { doSetMachineName, doSetSpeedMode, doSetRunMode, resetCpuSpeedForTesting, getCPU } from "./motherboard"
import { memGet24, iigsGetIwmEnable35 } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { CPU65816 } from "./cpu65816"

const D1 = "C:\\dev\\emu\\ap2\\DISKS\\rastan1.woz"
const D2 = "C:\\dev\\emu\\ap2\\DISKS\\rastan2.woz"
const hasDisks = fs.existsSync(D1) && fs.existsSync(D2)
const FRAMES = 8300

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

const hexRange = (start: number, end: number, bank: number): string => {
  let out = ""
  for (let a = start; a < end; a++) out += memGet24((bank << 16) | a).toString(16).padStart(2, "0")
  return out
}

describe("transition to 08A4", () => {
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

  test("transition", () => {
    if (!hasDisks) { console.warn("disks missing"); return }
    mount(4, D1)
    mount(5, D2)
    doSetSpeedMode(1)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)

    const cpu = getCPU() as CPU65816
    let frame = 0
    let entered = false
    let done = false
    const ring: string[] = []
    const orig = cpu.executeOpcode.bind(cpu)
    cpu.executeOpcode = (op: number) => {
      const pb = cpu.PB & 0xff
      const pc = (cpu.PC - 1) & 0xffff
      if (!entered && pb === 0 && pc === 0x58a3) entered = true
      if (entered && !done && pb === 0 && pc === 0x08a4) {
        done = true
        console.log(`[x] first 08a4 f=${frame} op=${op.toString(16)} A=${cpu.A.toString(16)} X=${cpu.X.toString(16)} Y=${cpu.Y.toString(16)} P=${cpu.P.toString(16)} S=${cpu.S.toString(16)} D=${(cpu as any).D?.toString(16)} en35=${iigsGetIwmEnable35()}`)
        console.log(`[x] ring ${ring.slice(-100).join(" ")}`)
        console.log(`[x] mem08 ${hexRange(0x0800, 0x0900, 0)}`)
        console.log(`[x] stack ${hexRange(0x0100, 0x0180, 0)}`)
        console.log(`[x] mem00 ${hexRange(0x0000, 0x0040, 0)}`)
        console.log(`[x] mem2a ${hexRange(0x2a00, 0x2a30, 0)}`)
        console.log(`[x] mem58 ${hexRange(0x5800, 0x5840, 0)}`)
      }
      orig(op)
      ring.push(`${pb.toString(16).padStart(2, "0")}:${pc.toString(16).padStart(4, "0")}:${op.toString(16).padStart(2, "0")}`)
      if (ring.length > 128) ring.shift()
    }
    for (; frame < FRAMES && !done; frame++) {
      jest.advanceTimersByTime(17)
    }
    console.log(`[x] done frames=${frame} entered=${entered} done=${done}`)
    if (!done) console.log(`[x] tail ${ring.slice(-60).join(" ")}`)
  }, 1800000)
})
