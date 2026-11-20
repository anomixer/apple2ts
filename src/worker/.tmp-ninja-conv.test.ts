import { doSetMachineName, doSetRunMode, doSetSpeedMode, getExternalMachineState, resetCpuSpeedForTesting } from "./motherboard"
import { getTextPage } from "./memory"
import { convertTextPageValueToASCII } from "../common/utility"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { setKeyboardState } from "./devices/keyboard"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const DISK_PATH = "C:\\dev\\emu\\ap2\\DISKS\\NinjaTracker.2mg"
const OUT_DIR = "C:\\dev\\apple2ts\\.tmp-ninja-conv"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

const press = (key: number) => {
  setKeyboardState({ isDown: true, key, repeat: false })
  pump(5)
  setKeyboardState({ isDown: false, key, repeat: false })
  pump(5)
}

test("ninja tracker MOD Converter probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    doSetSpeedMode(1)
    expect(doSetEmuDriveNewData({
      index: 4, hardDrive: false, drive: 1, filename: "NinjaTracker.2mg", status: "",
      motorRunning: false, diskHasChanges: false, isWriteProtected: false,
      diskData: new Uint8Array(fs.readFileSync(DISK_PATH)), lastAppleWriteTime: 0,
      cloudData: null, writableFileHandle: null, lastLocalFileWriteTime: 0,
    } as DriveProps)).toBe(true)

    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    fs.mkdirSync(OUT_DIR, { recursive: true })
    pump(4000)

    press(0x6d)

    for (let f = 1; f <= 500; f++) {
      jest.advanceTimersByTime(17)
      if (f === 500) {
        const raw = getTextPage()
        fs.writeFileSync(`${OUT_DIR}\\raw-${f}.bin`, raw)
        const ui80 = (alt: boolean) => Array.from(raw)
          .map((v) => convertTextPageValueToASCII(v, alt, true, true, false)).join("")
        console.log(`frame ${f} rawLen=${raw.length}`)
        console.log(`UI alt=false row0=${JSON.stringify(ui80(false).slice(0, 80))}`)
        console.log(`UI alt=true row0=${JSON.stringify(ui80(true).slice(0, 80))}`)
        console.log(`masks row0=${JSON.stringify(Array.from(raw).slice(0,80).map(v => String.fromCharCode(v & 0x7f)).join(""))}`)
      }
    }
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
