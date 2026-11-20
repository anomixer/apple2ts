import { doSetMachineName, doSetRunMode, doSetSpeedMode, getExternalMachineState, resetCpuSpeedForTesting, doBoot, getCPU } from "./motherboard"
import { getShr, getTextPageAsString, iigsSlotRegister, shrDbg, getCurrentMemory, iigsShrScb, getIigsMousePos, iigsInterruptPending, iigsGetVblPending } from "./memory"
import { SWITCHES } from "./softswitches"
import { doSetEmuDriveNewData, getHardDriveState } from "./devices/drivestate"
import { setKeyboardState } from "./devices/keyboard"
import { MouseCardEvent, getMouseUiEventCount } from "./devices/mouse"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { s6502 } from "./instructions"
import * as fs from "fs"

const DISK_PATH = process.env.MODULAE_DISK ||
  "C:\\dev\\emu\\ap2\\DISKS\\modulae (1990)(free tools association).2mg"
const OUT_DIR = process.env.MODULAE_OUT || "C:\\dev\\apple2ts\\.tmp-modulae-debug"

const hash = (a: Uint8Array) => {
  let h = 2166136261
  for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) }
  return h >>> 0
}

test("modulae debug probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    doSetSpeedMode(1)
    const slot = process.env.MODULAE_SLOT || "5"
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

    const debugCpu = getCPU() as any
    const originalInterrupt = debugCpu.interrupt.bind(debugCpu)
    let curFrame = 0
    let irqCount = 0
    const irqEvents: string[] = []
    debugCpu.interrupt = function (this: any, nativeVector: number, emulationVector: number, software: boolean) {
      irqCount++
      irqEvents.push(`frame ${curFrame} pre PB=${this.PB.toString(16)} PC=${this.PC.toString(16)} D=${this.D.toString(16)} A=${this.A.toString(16)} X=${this.X.toString(16)} P=${this.P.toString(16)} vec=${software ? "sw" : "hw"} memirq=${iigsInterruptPending()} vbl=${iigsGetVblPending()}`)
      const result = originalInterrupt.call(this, nativeVector, emulationVector, software)
      irqEvents[irqEvents.length - 1] += ` -> PB=${this.PB.toString(16)} PC=${this.PC.toString(16)} D=${this.D.toString(16)} P=${this.P.toString(16)}`
      return result
    }

    const frames = Number(process.env.MODULAE_FRAMES || 2600)
    const pressEvery = Number(process.env.MODULAE_PRESS_EVERY || 600)
    const memAt = (i: number) => getCurrentMemory()[i]
    for (let f = 1; f <= frames; f++) {
      curFrame = f
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
        const dp = cpu.D + 0xF6
        const f6 = memAt(dp & 0xFFFF)
        console.log(`frame ${f} run=${state.runMode} vidhd=${state.vidhdActive} slot=${iigsSlotRegister.toString(2)} cpu=${cpu.PB.toString(16)}:${cpu.PC.toString(16)} lit=${Array.from(shr).filter(Boolean).length}/${Array.from(shown).filter(Boolean).length} text=${SWITCHES.TEXT.isSet}/${SWITCHES.COLUMN80.isSet} newvideo=${SWITCHES.NEWVIDEO.isSet} hd=${JSON.stringify(hd.status)} motor=${hd.motorRunning} qt=${hd.quarterTrack} mouse=${m.x},${m.y} mouseevents=${getMouseUiEventCount()} cpuA=${cpu.A.toString(16)} cpuX=${cpu.X.toString(16)} cpuY=${cpu.Y.toString(16)} cpuS=${cpu.S.toString(16)} cpuD=${cpu.D.toString(16)} cpuP=${cpu.P.toString(16)} I=${(cpu.P & 0x04) !== 0} em=${cpu.emulationMode} irq=${cpu.irqPending} memirq=${iigsInterruptPending()} vbl=${iigsGetVblPending()} s6502irq=${s6502.flagIRQ} irqcount=${irqCount} f6=${f6.toString(16)}`)
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
    }
    fs.writeFileSync(`${OUT_DIR}\\irq-events.txt`, irqEvents.join("\n"))
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 900000)
