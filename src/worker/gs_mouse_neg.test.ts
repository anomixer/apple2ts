import { doSetMachineName, doSetRunMode, doBoot, resetCpuSpeedForTesting, getCPU } from "./motherboard"
import { memGet24, memSet24 } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { MouseCardEvent, resetMouse } from "./devices/mouse"
import { iigsADB } from "./iigs_adb"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

// A leftward host move must move the Apple IIgs cursor leftward.
//
// The IIgs ROM's mouse accumulator (FF:9D44-FF:9D9E) decodes the $C024 report
// like this: it masks off the button bit, uses bit 6 as the sign, pushes $FF as
// the sign-extension byte on a negative report, and adds the 16-bit pair to the
// cursor. The result is that the 7-bit displacement field is *two's
// complement*: a -63 displacement arrives as $41 and decodes to -63, a -1
// arrives as $7F.
//
// apple2ts used to encode the absolute magnitude instead, so every negative
// report decoded as (magnitude - 64): -63 arrived as $FF and decoded to -1, and
// -1 arrived as $FF and decoded to -1 too. Leftward motion was therefore
// essentially lost, and the cursor only ever climbed.
//
// This asserts the accumulator's own result, mid-gesture, before the ROM's
// separate reconciliation code at FF:9EC1-FF:9ED4 copies GS/OS's saved cursor
// ($E1:02B8-$E1:02BD) back over the holes. That reconciliation is a separate,
// still-open problem; the arithmetic this test pins is not.
const FRAMES = Number(process.env.GSNEG_FRAMES || 4000)
const PO_PATH = process.env.GSNEG_PO || "C:\\dev\\emu\\ap2\\GSOS601.po"

const hex = (v: number, n = 2) => "$" + v.toString(16).toUpperCase().padStart(n, "0")
const XLO = 0x047c, XHI = 0x057c, YLO = 0x04fc, YHI = 0x05fc
const xpos = () => memGet24(XLO) | (memGet24(XHI) << 8)
const ypos = () => memGet24(YLO) | (memGet24(YHI) << 8)

test("GSOS601: a leftward move subtracts from the cursor, a rightward move adds", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    resetMouse()
    iigsADB.reset()
    const data = fs.readFileSync(PO_PATH)
    expect(doSetEmuDriveNewData({
      index: 0, hardDrive: true, drive: 1, filename: "GSOS601.po", status: "",
      motorRunning: false, diskHasChanges: false, isWriteProtected: false,
      diskData: new Uint8Array(data), lastAppleWriteTime: 0, cloudData: null,
      writableFileHandle: null, lastLocalFileWriteTime: 0,
    } as DriveProps)).toBe(true)

    doBoot()
    doSetRunMode(RUN_MODE.RUNNING, false)
    for (let f = 0; f < FRAMES; f++) jest.advanceTimersByTime(17)

    const cpu = getCPU() as any
    const adb = iigsADB as any

    // The report bytes the guest reads, and the cursor as the ROM accumulator
    // leaves it after each of the two reports it applies. FF:9D92 is the
    // STA $047C that commits the X delta and FF:9D7A the STA $04FC for Y. The
    // value has to be sampled at the instruction itself: the reconciliation
    // code at FF:9EC1-FF:9ED4 overwrites the holes again in the same frame.
    const reports: number[] = []
    const origRead = adb.readMouseData.bind(adb)
    adb.readMouseData = () => {
      const v = origRead()
      reports.push(v)
      return v
    }
    let watching = false
    const xAfter: number[] = []
    const yAfter: number[] = []
    const origPI = cpu.processInstruction.bind(cpu)
    cpu.processInstruction = (cb?: any) => {
      const r = origPI(cb)
      if (watching && cpu.PB === 0xff) {
        if (cpu.PC - 3 === 0x9d92) xAfter.push(xpos())
        if (cpu.PC - 3 === 0x9d7a) yAfter.push(ypos())
      }
      return r
    }

    // Park the cursor somewhere unambiguous, then let the machine settle.
    const park = () => {
      for (const [a, v] of [[XLO, 0x80], [XHI, 0x01], [YLO, 0x40], [YHI, 0x00]] as const) {
        memSet24(a, v)
      }
      for (let f = 0; f < 10; f++) jest.advanceTimersByTime(17)
    }

    // A 0.15 step across the pointer is 0.15 * 640 = 96 counts, which the ADB
    // has to split across two reports: 63 and 33.
    const probe = (nx: number, ny: number) => {
      park()
      reports.length = 0
      xAfter.length = 0
      yAfter.length = 0
      watching = true
      MouseCardEvent({ x: nx, y: ny, buttons: -1 })
      for (let f = 0; f < 25; f++) jest.advanceTimersByTime(17)
      watching = false
      return { reports: reports.slice(), x: xAfter.slice(), y: yAfter.slice() }
    }

    // Establish the baseline, then step right.
    MouseCardEvent({ x: 0.30, y: 0.30, buttons: -1 })
    for (let f = 0; f < 25; f++) jest.advanceTimersByTime(17)

    const right = probe(0.45, 0.30)
    console.log(`[MOVERIGHT] reports ${right.reports.map((b) => hex(b)).join(" ")}` +
      `  X after each accumulator store: ${right.x.join(" ")} (from 384)`)
    expect(right.reports.length).toBeGreaterThan(0)
    // The accumulator applies the first 63 counts of the 96 straight away.
    expect(right.x[0]).toBe(384 + 63)
    // The raw bytes: +63 is $3F with the button released.
    expect(right.reports[0] & 0x7f).toBe(0x3f)
    expect(right.reports[0] & 0x40).toBe(0x00)

    const left = probe(0.30, 0.30)
    console.log(`[MOVELEFT]  reports ${left.reports.map((b) => hex(b)).join(" ")}` +
      `  X after each accumulator store: ${left.x.join(" ")} (from 384)`)
    // The same first 63 counts, backwards. This is the assertion that used to
    // fail: the report byte said $FF and decoded as -1, so X moved 384 -> 383.
    expect(left.x[0]).toBe(384 - 63)
    // And the raw report bytes, so a future encoding change has to be a
    // deliberate one: -63 is $41 with the button released, -33 is $5F.
    expect(left.reports[0] & 0x7f).toBe(0x41)
    expect(left.reports[0] & 0x40).toBe(0x40)
    expect(left.reports[2] & 0x7f).toBe(0x5f)
    expect(left.reports[2] & 0x40).toBe(0x40)

    // The vertical axis behaves the same way, on the smaller 0..199 range.
    MouseCardEvent({ x: 0.30, y: 0.30, buttons: -1 })
    for (let f = 0; f < 25; f++) jest.advanceTimersByTime(17)
    const up = probe(0.30, 0.15)
    console.log(`[MOVEUP]    reports ${up.reports.map((b) => hex(b)).join(" ")}` +
      `  Y after each accumulator store: ${up.y.join(" ")} (from 64)`)
    expect(up.y[0]).toBe(64 - 30)
    expect(up.reports[1] & 0x7f).toBe(0x62)
    expect(up.reports[1] & 0x40).toBe(0x40)

  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
