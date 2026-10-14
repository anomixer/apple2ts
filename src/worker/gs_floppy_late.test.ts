import { doSetMachineName, doSetRunMode, doReset, resetCpuSpeedForTesting } from "./motherboard"
import { doSetEmuDriveNewData, getDriveStateByIndex } from "./devices/drivestate"
import { memory } from "./memory"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

// Regression test for the Apple IIgs 5.25" floppy boot.
//
// Two separate bugs used to stop a 5.25" disk from booting after Ctrl-Reset:
//
//   1. doResetDiskDrive() parked the head at maxQuarterTrack (the outermost
//      track). Only a cold boot re-calibrates the head, so after a warm reset
//      the ROM read the wrong track.
//   2. The IIgs ROM decides cold boot vs warm reset with
//      LDA $03F3 / EOR #$A5 / CMP $03F4, and the boot sequence writes that
//      signature as it goes. With the signature present, a reset takes the
//      warm path, which walks the slots but never touches the IWM at all
//      (0 $C0E0-$C0EF reads after Ctrl-Reset, against 399,707 during the cold
//      boot that does find the disk) - so "insert a floppy, press Ctrl-Reset"
//      could never boot it.
//
// All three scenarios below must now reach the ProDOS welcome screen.
const PO_PATH = process.env.GSFLOPPY_PO || "public/disks/A2DeskTop-VERA.po"

const mkProps = (index: number): DriveProps => ({
  index,
  hardDrive: false,
  drive: 1,
  filename: "A2DeskTop-VERA.po",
  status: "",
  motorRunning: false,
  diskHasChanges: false,
  isWriteProtected: false,
  diskData: new Uint8Array(fs.readFileSync(PO_PATH)),
  lastAppleWriteTime: 0,
  cloudData: null,
  writableFileHandle: null,
  lastLocalFileWriteTime: 0,
})

const run = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

const screenText = () => {
  const lines: string[] = []
  for (let row = 0; row < 24; row++) {
    let line = ""
    const base = 0x400 + (row % 8) * 0x80 + Math.floor(row / 8) * 0x28
    for (let col = 0; col < 40; col++) {
      const ch = memory[base + col] & 0x7F
      line += (ch >= 32 && ch < 127) ? String.fromCharCode(ch) : " "
    }
    if (line.trim().length > 0) lines.push(line.replace(/\s+$/, ""))
  }
  return lines.join("\n")
}

const bootedProDos = () => /ProDOS\s*8/i.test(screenText())

// mountAtBoot: disk present when doBoot() runs. doAReset: Ctrl-Reset afterwards.
const scenario = (mountAtBoot: boolean, doAReset: boolean) => {
  doSetMachineName("APPLE2GS")
  if (mountAtBoot) expect(doSetEmuDriveNewData(mkProps(2))).toBe(true)
  doSetRunMode(RUN_MODE.NEED_BOOT)
  doSetRunMode(RUN_MODE.RUNNING, false)
  run(mountAtBoot ? 1500 : 300)
  if (!mountAtBoot) {
    expect(doSetEmuDriveNewData(mkProps(2))).toBe(true)
  }
  if (doAReset) {
    doReset()
    doSetRunMode(RUN_MODE.RUNNING, false)
    run(1500)
  }
  return bootedProDos()
}

describe("Apple IIgs 5.25 inch floppy boot", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    setIsTesting()
  })

  afterEach(() => {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  })

  test("boots a 5.25 inch disk that is present at power-on", () => {
    expect(scenario(true, false)).toBe(true)
  }, 900000)

  test("boots after Ctrl-Reset when the disk was present at power-on", () => {
    expect(scenario(true, true)).toBe(true)
  }, 900000)

  test("boots a 5.25 inch disk mounted after power-on, on Ctrl-Reset", () => {
    expect(scenario(false, true)).toBe(true)
  }, 900000)

  test("the head is recalibrated to track 0 on reset, not parked at the outer stop", () => {
    doSetMachineName("APPLE2GS")
    expect(doSetEmuDriveNewData(mkProps(2))).toBe(true)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    run(600)
    doReset()
    const ds = getDriveStateByIndex(2)
    expect(ds.quarterTrack).toBe(0)
    expect(ds.quarterTrack).not.toBe(ds.maxQuarterTrack)
  }, 900000)
})
