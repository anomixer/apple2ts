import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { doGetSaveState } from "./save_restore"
import { getShrDisplayed, getShr, getTextPageAsString, memGetC000, memGet24, gsRAM } from "./memory"
import { doSetEmuDriveNewData, getDriveStateByIndex } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { setKeyboardState } from "./devices/keyboard"
import * as fs from "fs"

const DISK_PATH = process.env.NFC_PATH || "C:\\dev\\emu\\ap2\\DISKS\\NFCDemoDrive.2mg"
const OUT_DIR = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-bbs"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

const key = (domCode: string, keyCode = -1, hold = 10, after = 60) => {
  setKeyboardState({ key: keyCode, isDown: true, repeat: false, domCode })
  pump(hold)
  setKeyboardState({ key: keyCode, isDown: false, repeat: false, domCode })
  pump(after)
}

const dump = (label: string) => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(`${OUT_DIR}\\${label}-shr.bin`, getShrDisplayed())
  fs.writeFileSync(`${OUT_DIR}\\${label}-raw-shr.bin`, getShr())
  fs.writeFileSync(`${OUT_DIR}\\${label}.txt`, getTextPageAsString())
  const cpu = getCPU() as any
  const drive = getDriveStateByIndex(0)
  const regs = [0xc029, 0xc035, 0xc036, 0xc000, 0xc02e, 0xc02f].map(a => `$${a.toString(16).padStart(4, "0")}=${memGet24(a).toString(16)}`).join(" ")
  console.log(`[NFC-BBS] ${label} PB=${cpu.PB.toString(16)} PC=${cpu.PC.toString(16)} A=${cpu.A.toString(16)} X=${cpu.X.toString(16)} Y=${cpu.Y.toString(16)} S=${cpu.S.toString(16)} E=${cpu.emulationMode} cycles=${cpu.cycles} ${regs}`)
  console.log(`[NFC-BBS] drive track=${drive.quarterTrack} motor=${drive.motorRunning} status=${drive.status}`)
}

test("NFCDemo select first menu item (BBS-Demo) and follow black screen", () => {
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
  dump("menu")
  key("ArrowDown")
  dump("selected")
  key("Enter", 13)
  dump("afterEnter")
  for (let f = 500; f <= 5000; f += 500) {
    pump(500)
    dump(`after${f}`)
  }
  const mem = new Uint8Array(0x20 * 0x10000)
  for (let bank = 0; bank < 0x20; bank++) {
    for (let off = 0; off < 0x10000; off++) mem[(bank << 16) | off] = memGet24((bank << 16) | off)
  }
  fs.writeFileSync(`${OUT_DIR}\\after5000-memory-low.bin`, mem)
  fs.writeFileSync(`${OUT_DIR}\\after5000-state.json`, JSON.stringify(doGetSaveState(true)))
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 1200000)
