import { createExternalSessionSnapshot, doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { getShrDisplayed, getTextPageAsString, memGet24 } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { setKeyboardState } from "./devices/keyboard"
import * as fs from "fs"

const DISK_PATH = process.env.NFC_PATH || "C:\\dev\\emu\\ap2\\DISKS\\NFCDemoDrive.2mg"
const OUT_DIR = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-snapshot"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

const dump = (label: string) => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(`${OUT_DIR}\\${label}-shr.bin`, getShrDisplayed())
  fs.writeFileSync(`${OUT_DIR}\\${label}.txt`, getTextPageAsString())
  const cpu = getCPU() as any
  console.log(`[NFC-SNAP] ${label} PB=${cpu.PB.toString(16)} PC=${cpu.PC.toString(16)} S=${cpu.S.toString(16)} E=${cpu.emulationMode}`)
}

const key = (domCode: string, keyCode = -1, hold = 10, after = 60) => {
  setKeyboardState({ key: keyCode, isDown: true, repeat: false, domCode })
  pump(hold)
  setKeyboardState({ key: keyCode, isDown: false, repeat: false, domCode })
  pump(after)
}

test("NFCDemo snapshot at press-any-key prompt", () => {
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
  key("ArrowDown")
  key("ArrowDown")
  key("Enter", 13)
  pump(9500)
  dump("prompt")

  // Dump all 8 MB of fast RAM from the raw 65816 address space. NFCDemo's
  // decompressor lives above bank $3F, so a 4 MB dump is not enough.
  const banks = 128
  const mem = new Uint8Array(banks * 65536)
  for (let bank = 0; bank < banks; bank++) {
    const base = bank * 65536
    for (let addr = 0; addr < 65536; addr++) mem[bank * 65536 + addr] = memGet24(base + addr)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(`${OUT_DIR}\\prompt-memory-full.bin`, mem)

  doSetRunMode(RUN_MODE.PAUSED, false)
  const receipt = createExternalSessionSnapshot("nfc-prompt")
  console.log(`[NFC-SNAP] snapshot ${JSON.stringify(receipt)}`)
  jest.useRealTimers()
}, 900000)
