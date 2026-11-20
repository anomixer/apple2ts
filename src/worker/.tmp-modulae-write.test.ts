import { doSetMachineName, doSetRunMode, doSetSpeedMode, getExternalMachineState, resetCpuSpeedForTesting, doBoot, getCPU } from "./motherboard"
import { getShr, getCurrentMemory, iigsSlotRegister, getIigsMousePos } from "./memory"
import { SWITCHES } from "./softswitches"
import { doSetEmuDriveNewData, getHardDriveState } from "./devices/drivestate"
import { setKeyboardState } from "./devices/keyboard"
import { MouseCardEvent } from "./devices/mouse"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const DISK_PATH = process.env.MODULAE_DISK ||
  "C:\\dev\\emu\\ap2\\DISKS\\modulae (1990)(free tools association).2mg"
const OUT_DIR = process.env.MODULAE_OUT || "C:\\dev\\apple2ts\\.tmp-modulae-write"

test("modulae write probe", () => {
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
    const origWrite = debugCpu.write8.bind(debugCpu)
    let curFrame = 0
    const logs: string[] = []
    debugCpu.write8 = function (this: any, address: number, value: number) {
      const a = address & 0xFFFF
      if (a === 0x0FF6 || a === 0x00F6) {
        logs.push(`frame ${curFrame} write addr=${address.toString(16)} PC=${this.PB.toString(16)}:${this.PC.toString(16)} D=${this.D.toString(16)} val=${value.toString(16)}`)
      }
      return origWrite(address, value)
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
    fs.writeFileSync(`${OUT_DIR}\\write-log.txt`, logs.join("\n"))
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
