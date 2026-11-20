import { doSetMachineName, doSetRunMode, getExternalMachineState, getIigsFrameUnits, getIigsVideoClock, resetCpuSpeedForTesting } from "./motherboard"
import { getShr, getShrDisplayed, setShrDbgTrace, shrDbg } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { setKeyboardState } from "./devices/keyboard"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const DISK_PATH = "C:\\dev\\emu\\ap2\\DISKS\\timepilot_gs_v1.6.po"
const OUT_DIR = "C:\\dev\\apple2ts\\.tmp-timepilot-gameplay"
const FRAMES = Number(process.env.TIMEPILOT_FRAMES || 1560)
const TRACE_START = Number(process.env.TIMEPILOT_TRACE_START || 1548)

const hash = (a: Uint8Array) => {
  let h = 2166136261
  for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) }
  return h >>> 0
}

const press = (key: number, domCode: string) => {
  setKeyboardState({ key, isDown: true, repeat: false, domCode })
  setKeyboardState({ key, isDown: false, repeat: false, domCode })
}

test("timepilot gameplay probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    const data = new Uint8Array(fs.readFileSync(DISK_PATH))
    expect(doSetEmuDriveNewData({
      index: 0, hardDrive: true, drive: 1, filename: "timepilot_gs_v1.6.po", status: "",
      motorRunning: false, diskHasChanges: false, isWriteProtected: false,
      diskData: data, lastAppleWriteTime: 0, cloudData: null,
      writableFileHandle: null, lastLocalFileWriteTime: 0,
    } as DriveProps)).toBe(true)

    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    fs.mkdirSync(OUT_DIR, { recursive: true })

    for (let f = 1; f <= FRAMES; f++) {
      jest.advanceTimersByTime(17)
      if (f >= 700 && (f - 700) % 90 === 0) {
        press(32, "Space")
      }
      if (f === TRACE_START) {
        setShrDbgTrace(true)
        shrDbg.events.length = 0
      }
      if (f >= TRACE_START) {
        const shown = getShrDisplayed()
        fs.writeFileSync(`${OUT_DIR}\\shown-${f}.bin`, shown)
        fs.writeFileSync(`${OUT_DIR}\\raw-${f}.bin`, getShr())
        const traceFrame = Math.floor(getIigsVideoClock() / getIigsFrameUnits())
        console.log(`frame ${f} traceFrame ${traceFrame} pc=${getExternalMachineState().execution.PC} shown=${hash(shown)} raw=${hash(getShr())}`)
      }
    }
    const units = getIigsFrameUnits()
    const eventDump = shrDbg.events.map((e) => ({
      pc: e.pc,
      offset: e.pc === -2 ? e.offset : `0x${e.offset.toString(16)}`,
      frame: Math.floor(e.clock / units),
      phase: Math.round(e.clock % units),
      data: e.data,
      late: e.late ? 1 : 0,
    }))
    fs.writeFileSync(`${OUT_DIR}\\events.json`, JSON.stringify(eventDump, null, 1))
    console.log("events", eventDump.length, "firstFrame", eventDump[0]?.frame, "lastFrame", eventDump[eventDump.length - 1]?.frame)
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
