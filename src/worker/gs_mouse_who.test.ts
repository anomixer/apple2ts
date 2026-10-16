import { doSetMachineName, doSetRunMode, doBoot, resetCpuSpeedForTesting, getCPU } from "./motherboard"
import { memGet24, megaIIAux } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { MouseCardEvent, resetMouse } from "./devices/mouse"
import { iigsADB } from "./iigs_adb"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

// Who actually talks to the Apple IIgs ADB once GS/OS is running, and does the
// cursor position follow the pointer?
//
// Section 38 measured the cursor words stuck at zero with the ROM's ADB task
// ($FF:C4D0) never running, but that run only reached 1100 frames - the Finder
// was not up yet. An earlier attempt to answer this by decoding opcodes found
// "zero accesses to $C020-$C02F", which was wrong: GS/OS runs in native mode,
// where $AD/$8D/$AF/$8F are *four-byte long* forms ($AD 00 24 C0 = LDA $00C024),
// so a filter that only understands 16-bit absolute addressing misses all of
// them. Wrapping the ADB methods themselves records the real caller instead of
// guessing from the opcode.
const FRAMES = Number(process.env.GSMOUSE_FRAMES || 4000)
const PO_PATH = process.env.GSMOUSE_PO || "C:\\dev\\emu\\ap2\\GSOS601.po"

const hex = (v: number, n = 2) => "$" + v.toString(16).toUpperCase().padStart(n, "0")

test("GSOS601: who reads the ADB registers, and does the cursor follow", () => {
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

    const cpu = getCPU() as any
    const adb = iigsADB as any
    const c024: string[] = []
    const sites = new Map<string, { n: number, phase: number, bytes: string }>()
    let phase = 0
    // Reading memory here re-enters readMouseData (memGet24 of $C024 is what
    // called us), so guard against recursion.
    let inNote = false
    const note = (method: string) => {
      if (inNote) return
      inNote = true
      const pb = cpu.PB, pc = cpu.PC
      // The PC sits inside the instruction's operand fetch, so back up a few
      // bytes; the caller is identified by the bytes around it.
      const start = Math.max(0, pc - 4)
      const bytes = Array.from({ length: 8 }, (_, i) => hex(memGet24((pb << 16) | (start + i)))).join(" ")
      const key = `${hex(pb)}:${hex(pc - 3, 4)} via ${method}`
      const e = sites.get(key)
      if (!e) sites.set(key, { n: 1, phase, bytes })
      else e.n++
      inNote = false
    }
    // readData is $C026; readMouseData is the one memory.ts calls for $C024.
    for (const m of ["readMouseData", "readStatus", "readModifiers", "writeCommand", "writeStatus"]) {
      const orig = adb[m].bind(adb)
      adb[m] = (...a: unknown[]) => {
        note(m)
        const r = orig(...a)
        if (m === "readMouseData" && phase === 1 && typeof r === "number") {
          c024.push(`${hex(cpu.PB)}:${hex(cpu.PC - 3, 4)}=${hex(r)}`)
        }
        return r
      }
    }

    // Who writes the cursor words? Sample them once per instruction and report
    // the instruction that changed them, which names the code regardless of
    // whether it is ROM, GS/OS, or the emulator's own dead-reckoning path.
    const CURSOR = [0x047c, 0x057c, 0x04fc, 0x05fc]
    const prevCursor = CURSOR.map((a) => memGet24(a))
    const writers = new Map<string, { n: number, phase: number, bytes: string }>()
    const noteWrite = () => {
      const pb = cpu.PB, pc = cpu.PC
      const start = Math.max(0, pc - 3)
      const bytes = Array.from({ length: 7 }, (_, i) => hex(memGet24((pb << 16) | (start + i)))).join(" ")
      const key = `${hex(pb)}:${hex(pc - 3, 4)}`
      const e = writers.get(key)
      if (!e) writers.set(key, { n: 1, phase, bytes })
      else e.n++
    }
    const origPI = cpu.processInstruction.bind(cpu)
    cpu.processInstruction = (cb?: any) => {
      const r = origPI(cb)
      for (let i = 0; i < CURSOR.length; i++) {
        const v = memGet24(CURSOR[i])
        if (v !== prevCursor[i]) { prevCursor[i] = v; noteWrite() }
      }
      return r
    }

    doBoot()
    doSetRunMode(RUN_MODE.RUNNING, false)

    const cursor = () => [0x047c, 0x057c, 0x04fc, 0x05fc].map((a) => hex(memGet24(a))).join("/")
    const emGlobals = () => Array.from(megaIIAux.subarray(0x0190, 0x0194)).map((b) => hex(b)).join(",")
    const report = (label: string) =>
      console.log(`[ADB] ${label}: cursor holes=${cursor()}  $E1:0190-93=${emGlobals()}  hasMouseData=${adb.hasMouseData()}`)

    for (let f = 0; f < FRAMES; f++) jest.advanceTimersByTime(17)
    report("after boot")

    phase = 1
    const track: string[] = []
    
    // Right and down first, then back left and up. If the cursor only ever
    // increases, the ADB report's direction bit is wrong and the pointer ends
    // up parked in the corner of the screen.
    for (const [nx, ny] of [[0.30, 0.30], [0.45, 0.45], [0.60, 0.60], [0.75, 0.75]]) {
      MouseCardEvent({ x: nx, y: ny, buttons: -1 })
      for (let f = 0; f < 25; f++) jest.advanceTimersByTime(17)
      track.push(`-> ${nx.toFixed(2)},${ny.toFixed(2)}  ${cursor()}`)
    }
    c024.push("--- now moving back left and up; $C024 reads follow ---")
    // Step the ROM accumulator by hand. The bytes show it runs
    //   TXA / AND #$7F / TAX / ASL A / BPL ...
    // so the direction has to come out of the carry or out of bit 7 of the
    // shifted magnitude. Watching A, X and Y per instruction says which.
    let stepping = false
    const steps: string[] = []
    const origPI2 = cpu.processInstruction.bind(cpu)
    cpu.processInstruction = (cb?: any) => {
      if (stepping && cpu.PB === 0xff && cpu.PC >= 0x9d49 && cpu.PC <= 0x9d6e) {
        steps.push(`   $${cpu.PC.toString(16).toUpperCase()} op=${hex(memGet24((cpu.PB << 16) | cpu.PC))} A=${hex(cpu.A)} X=${hex(cpu.X)} Y=${hex(cpu.Y)} P=${hex(cpu.P)} D=${cpu.D} E=${cpu.emulationMode ? 1 : 0} DB=${hex(cpu.DB)}`)
      }
      return origPI2(cb)
    }

    stepping = true
    for (const [nx, ny] of [[0.60, 0.60], [0.45, 0.45], [0.30, 0.30], [0.15, 0.15]]) {
      MouseCardEvent({ x: nx, y: ny, buttons: -1 })
      for (let f = 0; f < 25; f++) jest.advanceTimersByTime(17)
      track.push(`<- ${nx.toFixed(2)},${ny.toFixed(2)}  ${cursor()}`)
    }
    MouseCardEvent({ x: 0.6, y: 0.5, buttons: 0x10 })
    for (let f = 0; f < 60; f++) jest.advanceTimersByTime(17)
    track.push("press " + cursor())
    MouseCardEvent({ x: 0.6, y: 0.5, buttons: 0x00 })
    for (let f = 0; f < 200; f++) jest.advanceTimersByTime(17)
    track.push("release " + cursor())
    console.log("[ADB] cursor through the gesture:\n   " + track.join("\n   "))
    stepping = false
    console.log("[ADB] first accumulator pass while moving LEFT:\n" + steps.slice(0, 40).join("\n"))
    console.log("[ADB] every $C024 byte the guest read:\n   " + c024.join("\n   "))

    // The ROM accumulator that turns those reports into a cursor position.
    // Hand-decode from these bytes: a disassembler that assumes 6502 operand
    // lengths falls apart here, because the ROM runs in native mode where $0A is
    // ASL A (one byte) rather than ASL abs (two).
    for (const [bank, lo, hi] of [[0xff, 0x9cf0, 0x9da0], [0xff, 0x9e8b, 0x9eb0]] as const) {
      const lines: string[] = []
      for (let a = lo; a <= hi; a += 16) {
        const bytes: string[] = []
        for (let i = 0; i < 16 && a + i <= hi; i++) bytes.push(hex(memGet24((bank << 16) | (a + i))))
        lines.push(`   ${hex(bank)}:${hex(a, 4)}  ${bytes.join(" ")}`)
      }
      console.log(`[ADB] ROM bytes:\n${lines.join("\n")}`)
    }
    report("after moves")

    const rows = Array.from(sites.entries())
      .map(([k, v]) => ({ k, n: v.n, phase: v.phase, bytes: v.bytes }))
      .sort((a, b) => b.n - a.n)
    console.log(`[ADB] ${rows.length} distinct call sites:`)
    for (const r of rows.slice(0, 25)) {
      console.log(`   ${r.k.padEnd(34)} n=${String(r.n).padStart(7)} phase=${r.phase}  bytes ${r.bytes}`)
    }

    const wrows = Array.from(writers.entries())
      .map(([k, v]) => ({ k, n: v.n, phase: v.phase, bytes: v.bytes }))
      .sort((a, b) => b.n - a.n)
    console.log(`[CURSOR] ${wrows.length} distinct writers of $047C/$057C/$04FC/$05FC:`)
    for (const r of wrows.slice(0, 20)) {
      console.log(`   ${r.k.padEnd(14)} n=${String(r.n).padStart(7)} phase=${r.phase}  bytes ${r.bytes}`)
    }
    expect(true).toBe(true)
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
