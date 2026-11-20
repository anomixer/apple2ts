import { doSetMachineName, doSetRunMode, doSetSpeedMode, getExternalMachineState, resetCpuSpeedForTesting, doBoot, getCPU } from "./motherboard"
import { memGet24, gsRAM } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { setRomTraceEnabled, setRomTraceWatch, getRomTrace, clearRomTrace } from "./romtrace"
import * as fs from "fs"

const DISK_PATH = process.env.MODULAE_DISK ||
  "C:\\dev\\emu\\ap2\\DISKS\\modulae (1990)(free tools association).2mg"
const OUT_DIR = process.env.MODULAE_OUT || "C:\\dev\\apple2ts\\.tmp-modulae-pbprobe"

const hex = (n: number) => "0x" + n.toString(16)

test("modulae PB/bank72 probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    doSetSpeedMode(Number(process.env.MODULAE_SPEED || 1))
    expect(doSetEmuDriveNewData({
      index: 4, hardDrive: false, drive: 1,
      filename: DISK_PATH.split("\\").pop()!, status: "",
      motorRunning: false, diskHasChanges: false, isWriteProtected: false,
      diskData: new Uint8Array(fs.readFileSync(DISK_PATH)),
      lastAppleWriteTime: 0, cloudData: null, writableFileHandle: null,
      lastLocalFileWriteTime: 0,
    } as any)).toBe(true)

    fs.mkdirSync(OUT_DIR, { recursive: true })
    doBoot()
    doSetRunMode(RUN_MODE.RUNNING, false)
    setRomTraceEnabled(true)
    clearRomTrace()
    setRomTraceWatch([], [0x720000, 0x730000])

    const frames = Number(process.env.MODULAE_FRAMES || 1600)
    let lastPb = -1
    let firstBank72Frame = -1
    const frameLog: any[] = []
    for (let f = 1; f <= frames; f++) {
      jest.advanceTimersByTime(17)
      const cpu = getCPU() as any
      if (cpu.PB !== lastPb) {
        if (frameLog.length < 200) frameLog.push({ frame: f, pb: hex(cpu.PB), pc: hex(cpu.PC) })
        lastPb = cpu.PB
      }
      if (cpu.PB === 0x72 && firstBank72Frame < 0) firstBank72Frame = f
      if (f % 100 === 0) {
        const state = getExternalMachineState()
        const cpu = getCPU() as any
        console.log(`frame ${f} cycles=${state.s6502?.cycleCount ?? "?"} pb=${hex(cpu.PB)} pc=${hex(cpu.PC)}`)
        const raw = Array.from({ length: 16 }, (_, i) => gsRAM[((0x72 << 16) | ((0xE6B1 + i) & 0xFFFF)) >>> 0].toString(16).padStart(2, "0")).join(" ")
        const mem72 = Array.from({ length: 16 }, (_, i) => memGet24((0x72E6B1 + i) >>> 0).toString(16).padStart(2, "0")).join(" ")
        console.log(`  bank72 raw=${raw}\n  bank72 mem=${mem72}`)
      }
    }
    const trace = getRomTrace()
    const summary = {
      speed: Number(process.env.MODULAE_SPEED || 1),
      frames,
      firstBank72Frame,
      frameLog,
      instructions: trace.instructions,
      vbls: getExternalMachineState()?.vbls ?? null,
      lastTail: trace.last.slice(-80).map(hex),
      timelineTail: trace.timeline.slice(-60).map(hex),
      histTop: Object.entries(trace.hist).slice(0, 20),
      foreign: trace.foreign,
      watches: trace.watches,
    }
    fs.writeFileSync(`${OUT_DIR}\\trace.json`, JSON.stringify(summary, null, 2))
    console.log("firstBank72Frame", firstBank72Frame)
    console.log("watches", JSON.stringify(trace.watches, null, 1))
    console.log("foreign", JSON.stringify(trace.foreign, null, 1))
  } finally {
    setRomTraceEnabled(false)
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
