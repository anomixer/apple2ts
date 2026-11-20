import { doSetMachineName, doSetRunMode, doSetSpeedMode, getExternalMachineState, resetCpuSpeedForTesting, doBoot, getCPU } from "./motherboard"
import { getShr, getTextPageAsString, iigsSlotRegister, shrDbg, getCurrentMemory, iigsShrScb, getIigsMousePos } from "./memory"
import { SWITCHES } from "./softswitches"
import { doSetEmuDriveNewData, getHardDriveState } from "./devices/drivestate"
import { setKeyboardState } from "./devices/keyboard"
import { MouseCardEvent, getMouseUiEventCount } from "./devices/mouse"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { setRomTraceEnabled, getRomTrace, clearRomTrace } from "./romtrace"
import * as fs from "fs"

const DISK_PATH = process.env.MODULAE_DISK ||
  "C:\\dev\\emu\\ap2\\DISKS\\modulae (1990)(free tools association).2mg"
const OUT_DIR = process.env.MODULAE_OUT || "C:\\dev\\apple2ts\\.tmp-modulae"

const hash = (a: Uint8Array) => {
  let h = 2166136261
  for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) }
  return h >>> 0
}

test("modulae boot probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    doSetSpeedMode(Number(process.env.MODULAE_SPEED || 1))
    const slot = process.env.MODULAE_SLOT || "7"
    const mountIndex = slot === "5" ? 4 : 0
    const mountHardDrive = slot === "7"
    expect(doSetEmuDriveNewData({
      index: mountIndex, hardDrive: mountHardDrive, drive: 1,
      filename: DISK_PATH.split("\\").pop()!, status: "",
      motorRunning: false, diskHasChanges: false, isWriteProtected: false,
      diskData: new Uint8Array(fs.readFileSync(DISK_PATH)),
      lastAppleWriteTime: 0, cloudData: null, writableFileHandle: null,
      lastLocalFileWriteTime: 0,
    } as DriveProps)).toBe(true)

    doBoot()
    doSetRunMode(RUN_MODE.RUNNING, false)
    fs.mkdirSync(OUT_DIR, { recursive: true })

    const frames = Number(process.env.MODULAE_FRAMES || 3000)
    const pressEvery = Number(process.env.MODULAE_PRESS_EVERY || 600)
    const debugSpeed = process.env.MODULAE_SPEED_DEBUG === "1"
    if (debugSpeed) {
      setRomTraceEnabled(true)
      clearRomTrace()
      console.log(`debug speed=${process.env.MODULAE_SPEED || 1} frames=${frames}`)
    }
    for (let f = 1; f <= frames; f++) {
      if (debugSpeed) console.log(`START frame ${f}`)
      const frameStart = Date.now()
      jest.advanceTimersByTime(17)
      if (pressEvery > 0) {
        if (f % pressEvery === 0) {
          setKeyboardState({ key: 27, isDown: true, repeat: false, domCode: "Escape" })
        }
        if (f % pressEvery === 2) {
          setKeyboardState({ key: 27, isDown: false, repeat: false, domCode: "Escape" })
        }
        if (f % pressEvery === 30) {
          MouseCardEvent({ x: 0.75, y: 0.25, buttons: -1, relative: false })
        }
        if (f % pressEvery === 100) {
          MouseCardEvent({ x: 0.5, y: 0.3, buttons: 0x10, relative: false })
        }
        if (f % pressEvery === 102) {
          MouseCardEvent({ x: 0.5, y: 0.3, buttons: 0x00, relative: false })
        }
      }
      if (f % 100 === 0) {
        const state = getExternalMachineState()
        const shr = getShr()
        const shown = state.shr as Uint8Array
        const text = getTextPageAsString()
        const cpu = getCPU()
        const hd = getHardDriveState(0)
        const m = getIigsMousePos()
        console.log(`frame ${f} run=${state.runMode} vidhd=${state.vidhdActive} slot=${iigsSlotRegister.toString(2)} cpu=${cpu.PB.toString(16)}:${cpu.PC.toString(16)} lit=${Array.from(shr).filter(Boolean).length}/${Array.from(shown).filter(Boolean).length} text=${SWITCHES.TEXT.isSet}/${SWITCHES.COLUMN80.isSet} newvideo=${SWITCHES.NEWVIDEO.isSet} hd=${JSON.stringify(hd.status)} motor=${hd.motorRunning} qt=${hd.quarterTrack} mouse=${m.x},${m.y} mouseevents=${getMouseUiEventCount()}`)
        if (f % 500 === 0) {
          fs.writeFileSync(`${OUT_DIR}\\shrraw-${f}.bin`, shr)
          fs.writeFileSync(`${OUT_DIR}\\shrshown-${f}.bin`, shown)
          fs.writeFileSync(`${OUT_DIR}\\text-${f}.bin`, Uint8Array.from(text, (c) => c.charCodeAt(0)))
          fs.writeFileSync(`${OUT_DIR}\\mem-${f}.bin`, getCurrentMemory())
          console.log(`  hash=${hash(shr)}/${hash(shown) ?? 0} raw text=${JSON.stringify(text.slice(0, 320))}`)
          console.log(`  switches text=${SWITCHES.TEXT.isSet} newvideo=${SWITCHES.NEWVIDEO.isSet} column80=${SWITCHES.COLUMN80.isSet} hires=${SWITCHES.HIRES.isSet} dhires=${SWITCHES.DHIRES.isSet} mixed=${SWITCHES.MIXED.isSet} page2=${SWITCHES.PAGE2.isSet} altzp=${SWITCHES.ALTZP.isSet} store80=${SWITCHES.STORE80.isSet}`)
          console.log(`  scb=${Array.from({ length: 25 }, (_, i) => iigsShrScb(i).toString(16).padStart(2, "0")).join(",")} e1=${shrDbg.e1} b01=${shrDbg.b01} b00=${shrDbg.b00} b00aux=${shrDbg.b00aux}`)
        }
      }
      if (debugSpeed) {
        const trace = getRomTrace()
        console.log(`DONE frame ${f} ms=${Date.now() - frameStart} instr=${trace.instructions} last=${trace.last.slice(-4).map((x) => x.toString(16)).join(",")} peak=${Object.entries(trace.hist).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([pc, n]) => pc + "=" + n).join(",")}`)
      }
    }
  } finally {
    setRomTraceEnabled(false)
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
