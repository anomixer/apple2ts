// TEMPORARY probe: follow our machine after the bank0 $58A3 thunk to the fatal point.
import * as fs from "fs"
import { doSetMachineName, doSetSpeedMode, doSetRunMode, resetCpuSpeedForTesting, getCPU } from "./motherboard"
import { memGet24, iigsGetIwmEnable35 } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { CPU65816 } from "./cpu65816"
import { s6502 } from "./instructions"

const D1 = "C:\\dev\\emu\\ap2\\DISKS\\rastan1.woz"
const D2 = "C:\\dev\\emu\\ap2\\DISKS\\rastan2.woz"
const hasDisks = fs.existsSync(D1) && fs.existsSync(D2)
const FRAMES = 8400

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

describe("after 58A3 follow", () => {
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

  test("follow", () => {
    if (!hasDisks) { console.warn("disks missing"); return }
    mount(4, D1)
    mount(5, D2)
    doSetSpeedMode(1)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)

    const cpu = getCPU() as CPU65816
    let frame = 0
    let entered = false
    let c6xxLogged = 0
    let lastSnap = -1
    const ring: string[] = []
    const orig = cpu.executeOpcode.bind(cpu)
    cpu.executeOpcode = (op: number) => {
      const pb = cpu.PB & 0xff
      const pc = cpu.PC & 0xffff
      if (!entered && pb === 0 && (pc - 1) === 0x58a3) entered = true
      if (entered && c6xxLogged < 3 && pb === 0 && (pc - 1) >= 0xc600 && (pc - 1) < 0xc700) {
        c6xxLogged++
        console.log(`[x] c6xx#${c6xxLogged} f=${frame} pc=00:${((pc - 1) & 0xffff).toString(16)} op=${op.toString(16)} A=${cpu.A.toString(16)} X=${cpu.X.toString(16)} Y=${cpu.Y.toString(16)} P=${cpu.P.toString(16)} S=${cpu.S.toString(16)} en35=${iigsGetIwmEnable35()} c31=${memGet24(0xc031).toString(16)} c36=${memGet24(0xc036).toString(16)}`)
        console.log(`[x]   ring ${ring.slice(-30).join(" ")}`)
      }
      orig(op)
      ring.push(`${pb.toString(16).padStart(2, "0")}:${((pc - 1) & 0xffff).toString(16).padStart(4, "0")}`)
      if (ring.length > 64) ring.shift()
    }
    for (; frame < FRAMES; frame++) {
      jest.advanceTimersByTime(17)
      if (entered && frame > 7740 && (frame % 60) === 0 && frame !== lastSnap) {
        lastSnap = frame
        console.log(`[x] f=${frame} snap ${ring.slice(-24).join(" ")}`)
        console.log(`[x]   en35=${iigsGetIwmEnable35()} c31=${memGet24(0xc031).toString(16)} c36=${memGet24(0xc036).toString(16)} cyc=${s6502.cycleCount}`)
      }
    }
    console.log(`[x] done frames=${frame} entered=${entered} c6xx=${c6xxLogged}`)
    console.log(`[x] tail ${ring.slice(-40).join(" ")}`)
  }, 1800000)
})
