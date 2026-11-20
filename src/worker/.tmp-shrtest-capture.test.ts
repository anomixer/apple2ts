import { doSetMachineName, doSetRunMode, resetCpuSpeedForTesting } from "./motherboard"
import { getShrDbg, setShrDbgTrace, shrDbg } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const DISK_PATH = "C:\\dev\\emu\\ap2\\DISKS\\Kernkompetenz.2mg"

const ranges = (rows: number[]) => {
  const out: string[] = []
  let start = -1
  for (let i = 0; i <= rows.length; i++) {
    const on = i < rows.length && rows[i] !== 0
    if (on && start < 0) start = i
    if (!on && start >= 0) {
      out.push(`${start}-${i - 1}`)
      start = -1
    }
  }
  return out.join(",") || "none"
}

test("kernkompetenz capture rows", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    const data = new Uint8Array(fs.readFileSync(DISK_PATH))
    expect(doSetEmuDriveNewData({
      index: 4, hardDrive: false, drive: 1, filename: "Kernkompetenz.2mg", status: "",
      motorRunning: false, diskHasChanges: false, isWriteProtected: false,
      diskData: data, lastAppleWriteTime: 0, cloudData: null,
      writableFileHandle: null, lastLocalFileWriteTime: 0,
    } as DriveProps)).toBe(true)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    for (let f = 1; f <= 6200; f++) {
      if (f === 6060) setShrDbgTrace(true)
      if (f >= 6060) shrDbg.events.length = 0
      jest.advanceTimersByTime(17)
      if (f >= 6100 && f % 20 === 0) {
        const dbg = getShrDbg()
        const rows = dbg.capturedRows
        const events = dbg.events ?? []
        const lines = events.filter(e => e.pc === -2).map(e => e.offset)
        if (f === 6140) {
          const prefixWrites = events
            .filter(e => e.pc >= 0 && e.offset >= 0x2000 && e.offset < 0x2000 + 44 * 160)
            .slice(-100)
          console.log(`prefix writes ${JSON.stringify(prefixWrites)}`)
          const prefixLate = events
            .filter(e => e.pc === -1 && e.offset < 44 * 160)
            .slice(-100)
          console.log(`prefix late ${JSON.stringify(prefixLate)}`)
          const lineClocks = events.filter(e => e.pc === -2 && e.offset < 60).slice(0, 60)
          console.log(`line clocks ${JSON.stringify(lineClocks)}`)
        }
        console.log(`frame ${f} captured=${ranges(rows)} lines=${lines.length > 0 ? lines.join(",") : "none"}`)
      }
    }
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
