import { doSetMachineName, doSetRunMode, resetCpuSpeedForTesting, getCPU } from "./motherboard"
import { getShrDisplayed, getTextPageAsString, memGetC000 } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { setKeyboardState } from "./devices/keyboard"
import * as fs from "fs"

const DISK_PATH = process.env.NFC_PATH || "C:\\dev\\emu\\ap2\\DISKS\\NFCDemoDrive.2mg"
const OUT_DIR = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-select"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

const state = () => {
  const cpu = getCPU() as any
  return `PB=${cpu.PB.toString(16)} PC=${cpu.PC.toString(16)} E=${cpu.emulationMode} P=${cpu.P.toString(16)} A=${cpu.A.toString(16)} X=${cpu.X.toString(16)} Y=${cpu.Y.toString(16)} S=${cpu.S.toString(16)}`
}

const dump = (label: string) => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(`${OUT_DIR}\\${label}-shr.bin`, getShrDisplayed())
  fs.writeFileSync(`${OUT_DIR}\\${label}.txt`, getTextPageAsString())
  console.log(`[NFC-SELECT] ${label} ${state()} c000=${memGetC000(0xC000).toString(16)}`)
  console.log(JSON.stringify(getTextPageAsString().replace(/\r/g, "\n").slice(0, 800)))
}

const key = (domCode: string, keyCode = -1) => {
  setKeyboardState({ key: keyCode, isDown: true, repeat: false, domCode })
  pump(10)
  setKeyboardState({ key: keyCode, isDown: false, repeat: false, domCode })
  pump(60)
}

test("NFCDemo boot menu navigation probe", () => {
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

  pump(300)
  dump("menu0")
  key("ArrowDown")
  dump("down1")
  key("ArrowDown")
  dump("down2")
  key("ArrowUp")
  dump("up1")
  key("Enter", 13)
  pump(300)
  dump("enter")

  resetCpuSpeedForTesting()
  jest.useRealTimers()
}, 120000)
