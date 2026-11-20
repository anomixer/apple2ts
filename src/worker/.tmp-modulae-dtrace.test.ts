import { doSetMachineName, doSetRunMode, doSetSpeedMode, resetCpuSpeedForTesting, doBoot, getCPU } from "./motherboard"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { setKeyboardState } from "./devices/keyboard"
import { MouseCardEvent } from "./devices/mouse"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { memGet24, getCurrentMemory, gsRAM, megaIIAux, megaIIMain } from "./memory"
import * as fs from "fs"

const DISK_PATH = process.env.MODULAE_DISK ||
  "C:\\dev\\emu\\ap2\\DISKS\\modulae (1990)(free tools association).2mg"
const OUT_DIR = process.env.MODULAE_OUT || "C:\\dev\\apple2ts\\.tmp-modulae-dtrace"

test("modulae direct page trace probe", () => {
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
    let lastD = 0
    const dlog: string[] = []
    const ilog: string[] = []
    const origPI = debugCpu.processInstruction.bind(debugCpu)
    debugCpu.processInstruction = function (this: any, traceCb: any) {
      const beforeD = this.D
      const beforePC = this.PC
      const beforePB = this.PB
      const beforeEm = this.emulationMode
      const r = origPI(traceCb)
      if (this.D !== beforeD) {
        dlog.push(`f${curFrame} ${beforePB.toString(16)}:${beforePC.toString(16)} -> ${this.PB.toString(16)}:${this.PC.toString(16)} D ${beforeD.toString(16)} -> ${this.D.toString(16)} em ${beforeEm} -> ${this.emulationMode}`)
      }
      if (traceSteps > 0) {
        traceSteps--
        ilog.push(`f${curFrame} ${beforePB.toString(16)}:${beforePC.toString(16)} D=${beforeD.toString(16)} -> ${this.PB.toString(16)}:${this.PC.toString(16)} D=${this.D.toString(16)} em=${this.emulationMode}`)
      }
      lastD = this.D
      return r
    }
    const origInt = debugCpu.interrupt.bind(debugCpu)
    debugCpu.interrupt = function (this: any, nativeVector: number, emulationVector: number, software: boolean) {
      const r = origInt(nativeVector, emulationVector, software)
      if (curFrame >= 2500 && curFrame <= 2600 && traceSteps === 0 && traceTarget === 0) {
        traceTarget = curFrame
        traceSteps = 3000
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
    fs.writeFileSync(`${OUT_DIR}\\dlog.txt`, dlog.join("\n"))
    fs.writeFileSync(`${OUT_DIR}\\trace.txt`, ilog.join("\n"))
    const dump = (addr: number, n: number) => Array.from({ length: n }, (_, i) => memGet24(addr + i).toString(16).padStart(2, "0")).join(" ")
    fs.writeFileSync(`${OUT_DIR}\\dump-e1-0010.txt`, dump(0x0E10010, 64))
    fs.writeFileSync(`${OUT_DIR}\\dump-bank2-e800.txt`, dump(0x020E800 & 0xFFFFFF, 512))
    fs.writeFileSync(`${OUT_DIR}\\dump-bank4-ff00.txt`, dump(0x040FF00, 256))
    fs.writeFileSync(`${OUT_DIR}\\dump-zero-ff.txt`, dump(0x00000FF0, 32))
    fs.writeFileSync(`${OUT_DIR}\\mem-2600.bin`, getCurrentMemory())
    fs.writeFileSync(`${OUT_DIR}\\gstram-bank2.bin`, gsRAM.subarray(0x020000, 0x030000))
    fs.writeFileSync(`${OUT_DIR}\\mega2aux.bin`, megaIIAux)
    fs.writeFileSync(`${OUT_DIR}\\mega2main.bin`, megaIIMain)
    console.log(`trace target frame ${traceTarget}, dlog ${dlog.length}, ilog ${ilog.length}, lastD=${lastD.toString(16)}`)
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
