import { doSetMachineName, doSetRunMode, getCPU, resetCpuSpeedForTesting } from "./motherboard"
import { getIigsMousePos, isIigsShrActive } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { MouseCardEvent, resetMouse, resetADBTracking } from "./devices/mouse"
import { iigsMouseStep } from "./devices/mouse"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const PO_PATH = process.env.GSBOOT_PO || "C:\\dev\\emu\\ap2\\GSOS601.po"
const FRAMES = Number(process.env.GSBOOT_FRAMES || 4200)

test("IIgs: closed-loop ADB sync converges the guest cursor to the pointer", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    doSetEmuDriveNewData({
      index: 0, hardDrive: true, drive: 1, filename: "GSOS601.po",
      status: "", motorRunning: false, diskHasChanges: false,
      isWriteProtected: false, diskData: new Uint8Array(fs.readFileSync(PO_PATH)),
      lastAppleWriteTime: 0, cloudData: null, writableFileHandle: null,
      lastLocalFileWriteTime: 0,
    } as DriveProps)
    resetMouse()
    resetADBTracking()
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    for (let f = 0; f < FRAMES; f++) jest.advanceTimersByTime(17)

    expect(isIigsShrActive()).toBe(true)

    // Move the pointer to a known spot.
    MouseCardEvent({ x: 0.10, y: 0.10, buttons: -1 })
    for (let f = 0; f < 6; f++) jest.advanceTimersByTime(17)
    MouseCardEvent({ x: 0.60, y: 0.50, buttons: -1 })
    // Let the closed loop converge.
    for (let f = 0; f < 120; f++) {
      jest.advanceTimersByTime(17)
      iigsMouseStep()
    }
    const { x, y } = getIigsMousePos()
    // Expected: round(0.60*639)=383, round(0.50*399)>>1=99
    const wantX = Math.round(0.60 * 639)
    const wantY = Math.round(0.50 * 399) >> 1
    console.log(`[SYNC] guest=${x},${y} want=${wantX},${wantY}`)
    expect(Math.abs(x - wantX)).toBeLessThanOrEqual(2)
    expect(Math.abs(y - wantY)).toBeLessThanOrEqual(2)

    // A second move must also converge, proving it is not a one-shot.
    MouseCardEvent({ x: 0.25, y: 0.75, buttons: -1 })
    for (let f = 0; f < 120; f++) {
      jest.advanceTimersByTime(17)
      iigsMouseStep()
    }
    const p2 = getIigsMousePos()
    const want2X = Math.round(0.25 * 639)
    const want2Y = Math.round(0.75 * 399) >> 1
    console.log(`[SYNC2] guest=${p2.x},${p2.y} want=${want2X},${want2Y}`)
    expect(Math.abs(p2.x - want2X)).toBeLessThanOrEqual(2)
    expect(Math.abs(p2.y - want2Y)).toBeLessThanOrEqual(2)
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
})

test("IIgs: a single click posts one mouseDown, not two", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    doSetEmuDriveNewData({
      index: 0, hardDrive: true, drive: 1, filename: "GSOS601.po",
      status: "", motorRunning: false, diskHasChanges: false,
      isWriteProtected: false, diskData: new Uint8Array(fs.readFileSync(PO_PATH)),
      lastAppleWriteTime: 0, cloudData: null, writableFileHandle: null,
      lastLocalFileWriteTime: 0,
    } as DriveProps)
    resetMouse()
    resetADBTracking()
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    for (let f = 0; f < 4200; f++) jest.advanceTimersByTime(17)

    const cpu = getCPU() as any
    cpu.postEventAccepted = 0
    cpu.postEventDeduped = 0
    MouseCardEvent({ x: 0.55, y: 0.45, buttons: -1 })
    for (let f = 0; f < 10; f++) jest.advanceTimersByTime(17)
    MouseCardEvent({ x: 0.55, y: 0.45, buttons: 0x10 })
    for (let f = 0; f < 20; f++) jest.advanceTimersByTime(17)
    const acceptedPress = cpu.postEventAccepted
    const dedupedPress = cpu.postEventDeduped
    cpu.postEventAccepted = 0
    cpu.postEventDeduped = 0
    MouseCardEvent({ x: 0.55, y: 0.45, buttons: 0x00 })
    for (let f = 0; f < 20; f++) jest.advanceTimersByTime(17)
    console.log(`[CLICK] press accepted=${acceptedPress} deduped=${dedupedPress} release accepted=${cpu.postEventAccepted} deduped=${cpu.postEventDeduped}`)
    // Two JSLs per press, one accepted and one rejected.
    expect(acceptedPress).toBe(1)
    expect(dedupedPress).toBeGreaterThanOrEqual(1)
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
})
