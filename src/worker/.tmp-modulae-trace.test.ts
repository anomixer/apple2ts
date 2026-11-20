import { doSetMachineName, doSetRunMode, doSetSpeedMode, resetCpuSpeedForTesting, doBoot, getCPU } from "./motherboard"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { setKeyboardState } from "./devices/keyboard"
import { MouseCardEvent } from "./devices/mouse"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const DISK_PATH = process.env.MODULAE_DISK ||
  "C:\\dev\\emu\\ap2\\DISKS\\modulae (1990)(free tools association).2mg"
const OUT_DIR = process.env.MODULAE_OUT || "C:\\dev\\apple2ts\\.tmp-modulae-trace"

test("modulae instruction trace probe", () => {
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

    const debugCpu = getCPU() as any
    let curFrame = 0
    let traceSteps = 0
    let traceTarget = 0
    const logs: string[] = []
    const origPI = debugCpu.processInstruction.bind(debugCpu)
    debugCpu.processInstruction = function (this: any, traceCb: any) {
      const before = `f${curFrame} ${this.PB.toString(16)}:${this.PC.toString(16)} D=${this.D.toString(16)} A=${this.A.toString(16)} P=${this.P.toString(16)}`
      const r = origPI(traceCb)
      if (traceSteps > 0) {
        traceSteps--
        logs.push(`${before} -> ${this.PB.toString(16)}:${this.PC.toString(16)} D=${this.D.toString(16)}`)
      }
      return r
    }
    const origInt = debugCpu.interrupt.bind(debugCpu)
    debugCpu.interrupt = function (this: any, nativeVector: number, emulationVector: number, software: boolean) {
      const r = origInt(nativeVector, emulationVector, software)
      if (curFrame >= 2500 && curFrame <= 2600 && traceSteps === 0 && traceTarget === 0) {
        traceTarget = curFrame
        traceSteps = 400
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
      if (f % 600 === 100) MouseCardEvent({ x: 0.5, y: 0.3, buttons: 0x10, relative: false })
      if (f % 600 === 102) MouseCardEvent({ x: 0.5, y: 0.3, buttons: 0x00, relative: false })
    }
    fs.writeFileSync(`${OUT_DIR}\\trace.txt`, logs.join("\n"))
    console.log(`trace target frame ${traceTarget}, logs ${logs.length}`)
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)

