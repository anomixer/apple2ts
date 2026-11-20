import { doSetMachineName, doSetRunMode, doSetSpeedMode, getExternalMachineState, resetCpuSpeedForTesting } from "./motherboard"
import { getHires, getShr, getTextPageAsString } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const SYSTEM = "C:/dev/emu/ap2/DISKS/GSOS601.po"
const MERLIN = "C:/dev/emu/ap2/DISKS/merlin 16+ v4.68 (1989)(roger wagner publishing)(disk 1 of 3).2mg"
const OUT_DIR = "C:/dev/apple2ts/.tmp-merlin-gsos"
const FRAMES = Number(process.env.MERLIN_GSOF_FRAMES || 5000)

const hash = (a: Uint8Array) => {
  let h = 2166136261
  for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) }
  return h >>> 0
}

const mount = (index: number, drive: number, path: string) =>
  doSetEmuDriveNewData({
    index, hardDrive: false, drive, filename: path.split("/").pop()!, status: "",
    motorRunning: false, diskHasChanges: false, isWriteProtected: false,
    diskData: new Uint8Array(fs.readFileSync(path)), lastAppleWriteTime: 0,
    cloudData: null, writableFileHandle: null, lastLocalFileWriteTime: 0,
  } as DriveProps)

test("merlin under GSOS probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    doSetSpeedMode(1)
    expect(mount(4, 1, SYSTEM)).toBe(true)
    expect(mount(5, 2, MERLIN)).toBe(true)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    fs.mkdirSync(OUT_DIR, { recursive: true })
    for (let f = 1; f <= FRAMES; f++) {
      jest.advanceTimersByTime(17)
      if (f <= 5 || f % 100 === 0) {
        const state = getExternalMachineState()
        const hgr = state.hires as Uint8Array
        const shr = state.shr as Uint8Array
        const text = getTextPageAsString()
        fs.writeFileSync(`${OUT_DIR}\\hires-${f}.bin`, hgr)
        fs.writeFileSync(`${OUT_DIR}\\shr-${f}.bin`, shr)
        fs.writeFileSync(`${OUT_DIR}\\text-${f}.bin`, Uint8Array.from(text, (c) => c.charCodeAt(0)))
        console.log(`frame ${f} run=${state.runMode} hgr=${hgr.length} hash=${hash(hgr)} shr=${shr.length} hash=${hash(shr)} textTail=${JSON.stringify(text.slice(-80))}`)
      }
    }
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
