import { doSetMachineName, doSetRunMode, doSetSpeedMode, getExternalMachineState, resetCpuSpeedForTesting } from "./motherboard"
import { getShr, getTextPageAsString } from "./memory"
import { SWITCHES } from "./softswitches"
import { megaIIMain, megaIIAux } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { MouseCardEvent, resetMouse, resetADBTracking } from "./devices/mouse"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const SYSTEM = "C:/dev/emu/ap2/DISKS/SystemDisk.2mg"
const MERLIN = "C:/dev/emu/ap2/DISKS/merlin 16+ v4.68 (1989)(roger wagner publishing)(disk 1 of 3).2mg"
const OUT_DIR = "C:/dev/apple2ts/.tmp-merlin-click"

const mount = (index: number, drive: number, path: string) =>
  doSetEmuDriveNewData({
    index, hardDrive: false, drive, filename: path.split("/").pop()!, status: "",
    motorRunning: false, diskHasChanges: false, isWriteProtected: false,
    diskData: new Uint8Array(fs.readFileSync(path)), lastAppleWriteTime: 0,
    cloudData: null, writableFileHandle: null, lastLocalFileWriteTime: 0,
  } as DriveProps)

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

const save = (frame: number) => {
  fs.writeFileSync(`${OUT_DIR}\\shr-${frame}.bin`, getExternalMachineState().shr as Uint8Array)
  const text = getTextPageAsString()
  fs.writeFileSync(`${OUT_DIR}\\text-${frame}.bin`, Uint8Array.from(text,(c)=>c.charCodeAt(0)))
  const sw = {
    TEXT: SWITCHES.TEXT.isSet, MIXED: SWITCHES.MIXED.isSet,
    COLUMN80: SWITCHES.COLUMN80.isSet, STORE80: SWITCHES.STORE80.isSet,
    DHIRES: SWITCHES.DHIRES.isSet, HIRES: SWITCHES.HIRES.isSet,
  }
  console.log(`frame ${frame} switches ${JSON.stringify(sw)} text=${JSON.stringify(text.slice(0,80))}`)
  fs.writeFileSync(`${OUT_DIR}\\main-${frame}.bin`, megaIIMain.slice(0x400, 0x800))
  fs.writeFileSync(`${OUT_DIR}\\aux-${frame}.bin`, megaIIAux.slice(0x400, 0x800))

}

test("merlin click probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    doSetSpeedMode(1)
    resetMouse()
    resetADBTracking()
    expect(mount(4, 1, SYSTEM)).toBe(true)
    expect(mount(5, 2, MERLIN)).toBe(true)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    pump(4200)
    fs.mkdirSync(OUT_DIR, { recursive: true })

    // MERLIN.SYS16 icon in the Finder file list, around 355,240 pixels.
    MouseCardEvent({ x: 355 / 639, y: 240 / 399, buttons: -1 })
    pump(80)
    save(4280)

    const clickAt = (buttons: number) => {
      MouseCardEvent({ x: 355 / 639, y: 240 / 399, buttons })
      pump(3)
    }
    clickAt(0x10)
    clickAt(0x00)
    clickAt(0x10)
    clickAt(0x00)
    pump(40)
    save(4320)

    for (let f = 1; f <= 1200; f++) {
      pump(1)
      if (f % 100 === 0 || f === 1200) save(4320 + f)
    }
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
