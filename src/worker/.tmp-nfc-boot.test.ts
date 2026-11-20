import { doSetMachineName, doSetRunMode, resetCpuSpeedForTesting, getCPU } from "./motherboard"
import { getShrDisplayed, getTextPageAsString, memGet24, memGetC000 } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const DISK_PATH = process.env.NFC_PATH || "C:\\dev\\emu\\ap2\\DISKS\\NFCDemoDrive.2mg"
const OUT_DIR = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

const state = () => {
  const cpu = getCPU() as any
  return `PB=${cpu.PB.toString(16).padStart(2, "0")} PC=${cpu.PC.toString(16).padStart(4, "0")} E=${cpu.emulationMode} P=${cpu.P.toString(16)} DB=${cpu.DB.toString(16)} A=${cpu.A.toString(16)} X=${cpu.X.toString(16)} Y=${cpu.Y.toString(16)} S=${cpu.S.toString(16)}`
}

const dump = (label: string) => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(`${OUT_DIR}\\${label}.txt`, getTextPageAsString())
  fs.writeFileSync(`${OUT_DIR}\\${label}-shr.bin`, getShrDisplayed())
  console.log(`[NFC] ${label} ${state()} c000=${memGetC000(0xC000).toString(16)}`)
  const text = getTextPageAsString().replace(/\r/g, "\n")
  console.log(text.slice(0, 1200))
  console.log("[NFC] ----")
}

test("NFCDemo boot probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")

  const data = fs.readFileSync(DISK_PATH)
  const props: DriveProps = {
    index: 0, hardDrive: true, drive: 1, filename: "NFCDemoDrive.2mg", status: "",
    motorRunning: false, diskHasChanges: false, isWriteProtected: false,
    diskData: new Uint8Array(data), lastAppleWriteTime: 0, cloudData: null,
    writableFileHandle: null, lastLocalFileWriteTime: 0,
  }
  expect(doSetEmuDriveNewData(props)).toBe(true)
  doSetRunMode(RUN_MODE.NEED_BOOT)
  doSetRunMode(RUN_MODE.RUNNING, false)

  let lastText = ""
  for (let f = 0; f < 6000; f++) {
    jest.advanceTimersByTime(17)
    const text = getTextPageAsString()
    if (f % 250 === 0) {
      dump(`boot${f}`)
    }
    if (text !== lastText && f % 25 === 0) {
      console.log(`[NFC] text changed at frame ${f}`)
      dump(`frame${f}`)
      lastText = text
    }
  }
  dump("boot6000")
  resetCpuSpeedForTesting()
  jest.useRealTimers()
}, 600000)
