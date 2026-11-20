// TEMPORARY probe: when does bank-0 $5800-$5FFF get written during boot, and by whom?
import * as fs from "fs"
import { doSetMachineName, doSetSpeedMode, doSetRunMode, resetCpuSpeedForTesting, getCPU } from "./motherboard"
import { memGet } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { CPU65816 } from "./cpu65816"

const D1 = "C:\\dev\\emu\\ap2\\DISKS\\rastan1.woz"
const D2 = "C:\\dev\\emu\\ap2\\DISKS\\rastan2.woz"
const hasDisks = fs.existsSync(D1) && fs.existsSync(D2)
const FRAMES = 2400

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

const sum58 = (): string => {
  let h = 0
  for (let a = 0x5800; a < 0x6000; a++) h = (h * 31 + memGet(a)) | 0
  let first = ""
  for (let a = 0x5800; a < 0x5820; a++) first += memGet(a).toString(16).padStart(2, "0")
  return `${h.toString(16)}|${first}`
}

describe("$5800 writer probe", () => {
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

  test("who fills $5800", () => {
    if (!hasDisks) { console.warn("disks missing"); return }
    mount(4, D1)
    mount(5, D2)
    doSetSpeedMode(1)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)

    const cpu = getCPU() as CPU65816
    const ring: string[] = []
    let frame = 0
    let prev = sum58()
    let changes = 0
    const orig = cpu.executeOpcode.bind(cpu)
    cpu.executeOpcode = (op: number) => {
      const pb = cpu.PB & 0xff
      const pc = cpu.PC & 0xffff
      orig(op)
      ring.push(`${pb.toString(16).padStart(2, "0")}:${(pc - 1).toString(16).padStart(4, "0")}`)
      if (ring.length > 40) ring.shift()
    }
    for (; frame < FRAMES; frame++) {
      jest.advanceTimersByTime(17)
      if ((frame & 7) === 0) {
        const now = sum58()
        if (now !== prev) {
          changes++
          if (changes <= 40) {
            console.log(`[x] chg f=${frame} ${now}`)
            console.log(`[x] ring ${ring.slice(-24).join(" ")}`)
          }
          prev = now
        }
      }
      if (frame === 300) console.log(`[x] f300 ${sum58()}`)
    }
    console.log(`[x] changes=${changes} frames=${frame} final=${sum58()}`)
  }, 1800000)
})
