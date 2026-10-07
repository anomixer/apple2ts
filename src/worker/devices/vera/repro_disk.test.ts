import * as fs from "fs"
import { doSetEmuDriveNewData } from "../drivestate"
import { setIsTesting } from "../../worker2main"
import { doBoot, doSetRunMode } from "../../motherboard"
import { s6502 } from "../../instructions"
import { processInstruction } from "../../cpu6502"
import { RUN_MODE } from "../../../common/utility"
import { enableVera, resetVera, initVera } from "./vera"
import { memGet, memSet, memory } from "../../memory"
import { MouseCardEvent, onMouseVBL, enableMouseCard } from "../mouse"
import { addToBuffer } from "../keyboard"
import { SWITCHES } from "../../softswitches"

// Addresses from vera/build/workspace/vera/build/generated/desktop.list.
// Re-derive these after any change that moves code in the DeskTop segments.
const ADDR = {
  eventDispatch: 0x4077, // after `jsr GetNextEvent`, A = event kind
  handleClick: 0x42da,
  iconClick: 0x4466,
  openWindowImpl: 0x77c6,
  menuSelect: 0x6d4f,
  restoreMenuSavebehind: 0x7076,
  unhiliteCurMenuItem: 0x71f5,
  veraCheckPresent: 0xaf56,
  callMainToAuxImpl: 0xd000,
  veraBlit: 0xbd56,
  veraBlitNow: 0xbdca,
}

// MGTK state used to synchronize input with the guest.
const NO_MOUSE_FLAG = 0x85bc
const CURSOR_X = 0x6085
const CURSOR_Y = 0x6087
const MOUSE_STATUS = 0x608d

// Slot 5 mouse card I/O: MODE=$C0D6, STATUS=$C0D5, COMMAND=$C0DA.
const CARD_COMMAND = 0xc0da
const CMD_READ = 1

type Stats = {
  events: number
  eventKinds: Record<number, number>
  clicks: number
  iconClicks: number
  windowOpens: number
  menuSelects: number
  menuRestores: number
  blits: number
  blitsNow: number
  crash: null | { pc: number; op: number }
}

// Point A2D_VERA_HDV at another build to check it against this test. Used to
// confirm the test actually detects the historical crash: the pre-fix image from
// a2d commit 5ed56809 reproduces BRK at $F236, the current one does not.
const HDV_PATH = process.env.A2D_VERA_HDV || "C:/dev/a2d/vera/images/A2DeskTop-VERA.hdv"

const bootDeskTop = () => {
  setIsTesting()
  initVera()
  resetVera()
  enableVera(true, 2)
  enableMouseCard(true, 5)

  const data = fs.readFileSync(HDV_PATH)
  const props: DriveProps = {
    index: 0,
    hardDrive: true,
    drive: 1,
    filename: "A2DeskTop-VERA.hdv",
    status: "",
    motorRunning: false,
    diskHasChanges: false,
    isWriteProtected: false,
    diskData: new Uint8Array(data),
    lastAppleWriteTime: 0,
    cloudData: null,
    writableFileHandle: null,
    lastLocalFileTime: 0,
    lastLocalFileWriteTime: 0,
  }
  doSetEmuDriveNewData(props)
  doBoot()
  doSetRunMode(RUN_MODE.RUNNING)

  const stats: Stats = {
    events: 0,
    eventKinds: {},
    clicks: 0,
    iconClicks: 0,
    windowOpens: 0,
    menuSelects: 0,
    menuRestores: 0,
    blits: 0,
    blitsNow: 0,
    crash: null,
  }
  const history: string[] = []

  const readAux = (addr: number) => {
    const save = SWITCHES.AUXRAMREAD.isSet
    SWITCHES.AUXRAMREAD.isSet = true
    const v = memGet(addr, false)
    SWITCHES.AUXRAMREAD.isSet = save
    return v
  }
  const readAuxWord = (addr: number) => readAux(addr) | (readAux(addr + 1) << 8)

  const step = () => {
    const pc = s6502.PC
    const op = memGet(pc, false)
    const line = `$${pc.toString(16).padStart(4, "0")} op=$${op
      .toString(16)
      .padStart(2, "0")} A=$${s6502.Accum.toString(16)} X=$${s6502.XReg.toString(
      16,
    )} Y=$${s6502.YReg.toString(16)} SP=$${s6502.StackPtr.toString(16)}`
    history.push(line)
    if (history.length > 40) history.shift()

    if (pc === ADDR.eventDispatch) {
      stats.events++
      if (s6502.Accum !== 0) {
        stats.eventKinds[s6502.Accum] = (stats.eventKinds[s6502.Accum] || 0) + 1
      }
    }
    if (pc === ADDR.handleClick) stats.clicks++
    if (pc === ADDR.iconClick) stats.iconClicks++
    if (pc === ADDR.openWindowImpl) stats.windowOpens++
    if (pc === ADDR.menuSelect) stats.menuSelects++
    if (pc === ADDR.restoreMenuSavebehind) stats.menuRestores++
    if (pc === ADDR.veraBlit) stats.blits++
    if (pc === ADDR.veraBlitNow) stats.blitsNow++

    // Stop *before* executing BRK: apple2ts's doBrk handler dereferences
    // s6502.SP (which does not exist) and throws, masking the faulting PC.
    if (op === 0x00 && pc < 0xc000) {
      stats.crash = { pc, op }
      return
    }
    if (pc === 0xfa59 || pc === 0xff3d) {
      stats.crash = { pc, op }
      return
    }

    try {
      processInstruction()
    } catch (e) {
      stats.crash = { pc, op }
      console.log(`[CRASH] exception executing op=$${op.toString(16)} at $${pc.toString(16)}: ${e}`)
      return
    }

    const cycleInFrame = s6502.cycleCount % 17030
    if (cycleInFrame < 4550) {
      if (SWITCHES.VBLINV.isSet) {
        SWITCHES.VBLINV.isSet = false
        onMouseVBL()
      }
    } else {
      SWITCHES.VBLINV.isSet = true
    }
  }

  const waitFor = (pred: () => boolean, maxCycles: number, what: string) => {
    const end = s6502.cycleCount + maxCycles
    while (s6502.cycleCount < end && !pred() && !stats.crash) step()
    const ok = pred()
    if (!ok) console.log(`[wait] ${what}: TIMEOUT`)
    return ok
  }
  const runCycles = (n: number) => waitFor(() => false, n, "runCycles")

  // MGTK only polls the mouse after INITMOUSE finishes.
  waitFor(() => s6502.PC === 0x4054, 30000000, "MainLoop")
  waitFor(() => readAux(NO_MOUSE_FLAG) === 0, 8000000, "MGTK mouse ready")

  const curX = () => readAuxWord(CURSOR_X)
  const curY = () => readAuxWord(CURSOR_Y)

  // Timing-free input: wait for the guest to observe each change.
  const moveTo = (nx: number, ny: number) => {
    const px = curX()
    const py = curY()
    MouseCardEvent({ x: nx, y: ny, buttons: -1 })
    waitFor(() => curX() !== px || curY() !== py, 8000000, `cursor -> ${nx},${ny}`)
    return { x: curX(), y: curY() }
  }

  // Press and wait for MGTK to report a button_down event.
  const press = (nx: number, ny: number, maxCycles = 4000000) => {
    const before = stats.eventKinds[1] || 0
    MouseCardEvent({ x: nx, y: ny, buttons: 0x10 })
    return waitFor(() => (stats.eventKinds[1] || 0) > before, maxCycles, "button_down")
  }
  const release = (nx: number, ny: number) => MouseCardEvent({ x: nx, y: ny, buttons: 0x00 })

  // apple2ts never sets the card's BUTTON0_PREV on release, so a2d never sees a
  // button_up. Force the card's PREV bookkeeping so the next press reads as a
  // fresh edge instead of "still held". This also ends any drag state.
  const settleCard = () => memSet(CARD_COMMAND, CMD_READ)

  const report = (tag: string) => {
    console.log(
      `[${tag}] events=${stats.events} kinds=${JSON.stringify(stats.eventKinds)} clicks=${stats.clicks} iconClicks=${stats.iconClicks} windows=${stats.windowOpens} menuSelects=${stats.menuSelects} menuRestores=${stats.menuRestores} blits=${stats.blits} blitsNow=${stats.blitsNow}`,
    )
    if (stats.crash) {
      console.log(`[${tag}] CRASH at PC=$${stats.crash.pc.toString(16)} op=$${stats.crash.op.toString(16)}`)
      console.log("[trace]\n" + history.join("\n"))
    }
  }

  return { stats, waitFor, runCycles, moveTo, press, release, settleCard, report, readAux, curX, curY }
}

const desktopIcon = (name: string) => {
  const numIcons = memory[0x17f00 + 0x8df7]
  for (let i = 1; i <= numIcons; i++) {
    const id = memory[0x17f00 + 0x8df8 + i]
    if (id === 0) continue
    const addr = memory[0x17f00 + 0x8e78 + id] | (memory[0x17f00 + 0x8ef8 + id] << 8)
    const x = memory[0x17f00 + addr + 2] | (memory[0x17f00 + addr + 3] << 8)
    const y = memory[0x17f00 + addr + 4] | (memory[0x17f00 + addr + 5] << 8)
    const n = memory[0x17f00 + addr + 7]
    let s = ""
    for (let j = 0; j < n; j++) s += String.fromCharCode(memory[0x17f00 + addr + 8 + j])
    if (s.includes(name)) return { x, y }
  }
  return null
}

describe("VERA DeskTop regressions", () => {
  test("double-click disk icon opens a window without BRK", () => {
    const m = bootDeskTop()
    const icon = desktopIcon("DeskTop")
    expect(icon).not.toBeNull()

    const tx = (icon!.x + 10) / 560
    const ty = (icon!.y + 5) / 192
    m.moveTo(0.5, 0.5)
    const pos = m.moveTo(tx, ty)
    console.log(`[icon] clicked at a2d (${pos.x},${pos.y}); icon at (${icon!.x},${icon!.y})`)

    m.press(tx, ty)
    m.release(tx, ty)
    m.settleCard()
    m.press(tx, ty)
    m.release(tx, ty)

    m.runCycles(20000000)
    m.report("disk")

    expect(m.stats.windowOpens).toBeGreaterThan(0)
    expect(m.stats.crash).toBeNull()
  }, 300000)

  test("menu clicks blit to VERA without BRK", () => {
    const m = bootDeskTop()

    // Apple menu sits at the far left of the menu bar, above the icons.
    const mx = 16 / 560
    const my = 6 / 192
    m.moveTo(0.5, 0.5)
    m.moveTo(mx, my)

    m.press(mx, my)
    m.waitFor(() => m.stats.menuSelects > 0, 6000000, "MenuSelectImpl")
    m.runCycles(300000) // let the drop-down draw and blit

    // Hover a lower item so the highlight changes (the `imi_change` blit).
    const ix = mx
    const iy = 40 / 192
    m.moveTo(ix, iy)
    m.runCycles(300000)

    // Dismiss with Escape. apple2ts never reports a button_up, so releasing the
    // mouse does not close the menu; drop the card state, then send Escape so
    // `RestoreMenuSavebehind` (the third `vera_blit_now` call site) is reached.
    m.release(ix, iy)
    m.settleCard()
    m.runCycles(300000)
    addToBuffer("\x1b")
    m.waitFor(() => m.stats.menuRestores > 0, 4000000, "RestoreMenuSavebehind")
    m.runCycles(3000000)
    m.report("menu")

    expect(m.stats.menuSelects).toBeGreaterThan(0)
    // `vera_blit_now` must be reached: the menu paths blit directly, bypassing
    // `vera_check_present`, so this is what exercises the new LC bank guard.
    expect(m.stats.blitsNow).toBeGreaterThan(0)
    expect(m.stats.menuRestores).toBeGreaterThan(0)
    expect(m.stats.crash).toBeNull()
  }, 300000)
})