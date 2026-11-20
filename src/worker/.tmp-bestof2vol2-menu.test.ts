import { doSetMachineName, doSetRunMode, doSetSpeedMode, getCPU, resetCpuSpeedForTesting } from "./motherboard"
import { CPU65816 } from "./cpu65816"
import { getShrCompletedDisplay, getTextPageAsString, memGet24, setIigsRomVersion, megaIIAux, megaIIMain, iigsRegisters } from "./memory"
import { doSetEmuDriveNewData, getDriveStateByIndex } from "./devices/drivestate"
import { setKeyboardState } from "./devices/keyboard"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const DISK_PATH = "C:/dev/emu/ap2/DISKS/Bestof2vol2.2mg"
const BESTOF_ROM = process.env.BESTOF_ROM || "01"
const OUT_DIR = "C:/dev/apple2ts/.tmp-bestof2vol2-menu"
const FRAMES = Number(process.env.BESTOF_FRAMES || 30000)
const KEY_FRAMES = Number(process.env.BESTOF_KEY_FRAMES || 0)
const RETURN_DELAY = Number(process.env.BESTOF_RETURN_DELAY || 200)
const DIGIT_KEY = Number(process.env.BESTOF_DIGIT_KEY || 0x31)
const DIGIT_CODE = process.env.BESTOF_DIGIT_CODE || "Digit1"

test("Bestof2vol2.2mg menu probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    setIigsRomVersion(BESTOF_ROM)
    doSetMachineName("APPLE2GS")
    doSetSpeedMode(2)
    const data = new Uint8Array(fs.readFileSync(DISK_PATH))
    expect(doSetEmuDriveNewData({
      index: 4, hardDrive: false, drive: 1, filename: "Bestof2vol2.2mg", status: "",
      motorRunning: false, diskHasChanges: false, isWriteProtected: false,
      diskData: new Uint8Array(data), lastAppleWriteTime: 0, cloudData: null,
      writableFileHandle: null, lastLocalFileWriteTime: 0,
    } as DriveProps)).toBe(true)
    console.log(`drive35=${getDriveStateByIndex(4).is35} blockMedia35=${getDriveStateByIndex(4).blockMedia35}`)

    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    fs.mkdirSync(OUT_DIR, { recursive: true })

    const cpu = getCPU() as CPU65816
    let monitorFrame = -1
    let monitorText = ""
    let monitorState = ""
    let lastText = ""
    let menuFrame = -1
    let spaceDownFrame = -1
    let digitDownFrame = -1
    let trace: any[] = []
    let crashInfo: any = null

    const origProc = cpu.processInstruction.bind(cpu)
    cpu.processInstruction = function (...args: any[]) {
      const pb = cpu.PB, pc = cpu.PC, op = memGet24((pb << 16 | pc) >>> 0)
      const rawStack = []
      for (let i = 0; i < 24; i++) rawStack.push(memGet24((0x00 << 16 | (0x01E0 + i)) >>> 0))
      trace.push({ pb, pc, op, a: cpu.A, x: cpu.X, y: cpu.Y, s: cpu.S, d: cpu.D, p: cpu.P, stack: rawStack })
      if (trace.length > 4000) trace.shift()
      if (op === 0x00 || op === 0x02) {
        const dump = (start: number, len: number, bank: number) => {
          const out = []
          for (let i = 0; i < len; i++) out.push(memGet24((bank << 16 | ((start + i) & 0xFFFF)) >>> 0))
          return out
        }
        const mem = []
        for (let i = 0; i < 0x100; i++) mem.push(memGet24((0x00 << 16 | (0x100 + i)) >>> 0))
        crashInfo = {
          pb, pc, opcode: op,
          a: cpu.A, x: cpu.X, y: cpu.Y, s: cpu.S, d: cpu.D, p: cpu.P,
          trace: trace.slice(),
          stack: mem,
          bank0E5: dump(0x0E00, 0x80, 0x00),
          bankD0300: dump(0x0300, 0x40, 0x0D),
          bankFE00A: dump(0x00A0, 0x90, 0xFE),
          aux1F0: Array.from(megaIIAux.slice(0x01F0, 0x01F8)),
          aux100: Array.from(megaIIAux.slice(0x0100, 0x0200)),
          main1F0: Array.from(megaIIMain.slice(0x01F0, 0x01F8)),
          c068: iigsRegisters[0x68],
          c029: iigsRegisters[0x29],
          c035: iigsRegisters[0x35],
          c036: iigsRegisters[0x36],
        }
        fs.writeFileSync(OUT_DIR + "/crash-" + pb.toString(16) + "-" + pc.toString(16) + ".json", JSON.stringify(crashInfo, null, 2))
      }
      return origProc(...args)
    }

    for (let f = 0; f < FRAMES; f++) {
      jest.advanceTimersByTime(17)

      if (KEY_FRAMES) {
        if (f === KEY_FRAMES) {
          setKeyboardState({ key: -1, isDown: true, repeat: false, domCode: "Space" })
        }
        if (f === KEY_FRAMES + 2) {
          setKeyboardState({ key: -1, isDown: false, repeat: false, domCode: "Space" })
        }
      }

      if (spaceDownFrame >= 0 && spaceDownFrame > 0 && f === spaceDownFrame + 2) {
        setKeyboardState({ key: -1, isDown: false, repeat: false, domCode: "Space" })
        spaceDownFrame = -2
      }
      if (digitDownFrame > 0 && f === digitDownFrame + 2) {
        setKeyboardState({ key: DIGIT_KEY, isDown: false, repeat: false, domCode: DIGIT_CODE })
        digitDownFrame = -1
      }

      if (f % 50 === 0) {
        const shr = getShrCompletedDisplay()
        const lit = Array.from(shr).filter(Boolean).length
        if (spaceDownFrame === -1 && lit > 30000 && f > 500 && KEY_FRAMES === 0) {
          setKeyboardState({ key: -1, isDown: true, repeat: false, domCode: "Space" })
          spaceDownFrame = f
          console.log(`FRAME ${f} press-space lit=${lit}`)
        }
        if (menuFrame < 0 && spaceDownFrame === -2 && lit < 25000) {
          menuFrame = f
          fs.writeFileSync(OUT_DIR + "/menu-shr.bin", shr)
          fs.writeFileSync(OUT_DIR + "/menu-text.txt", getTextPageAsString())
          console.log(`FRAME ${f} menu lit=${lit} PB=${cpu.PB.toString(16).padStart(2, "0")} PC=${cpu.PC.toString(16)}`)
        }
        if (menuFrame > 0 && digitDownFrame === -1 && f === menuFrame + 50) {
          setKeyboardState({ key: DIGIT_KEY, isDown: true, repeat: false, domCode: DIGIT_CODE })
          digitDownFrame = f
          console.log(`FRAME ${f} press-digit-${DIGIT_CODE} after menu`)
        }
        if (f % 500 === 0) {
          fs.writeFileSync(OUT_DIR + "/shr-" + f + ".bin", shr)
          console.log(`FRAME ${f} lit=${lit} PB=${cpu.PB.toString(16).padStart(2, "0")} PC=${cpu.PC.toString(16)}`)
        }
      }

      const text = getTextPageAsString().replace(/\r/g, "\n")
      if (text !== lastText) {
        lastText = text
        if (f % 100 === 0) fs.writeFileSync(OUT_DIR + "/text-" + f + ".txt", text)
      }
      if (text.includes("BRK")) {
        monitorFrame = f
        monitorText = text
        monitorState = `PB=${cpu.PB.toString(16).padStart(2, "0")} PC=${cpu.PC.toString(16).padStart(4, "0")} A=${cpu.A.toString(16).padStart(4, "0")} X=${cpu.X.toString(16).padStart(4, "0")} Y=${cpu.Y.toString(16).padStart(4, "0")} S=${cpu.S.toString(16)} D=${cpu.D.toString(16)} P=${cpu.P.toString(16)} e=${cpu.emulationMode}`
        const shr = getShrCompletedDisplay()
        fs.writeFileSync(OUT_DIR + "/monitor-text.txt", text)
        fs.writeFileSync(OUT_DIR + "/monitor-shr.bin", shr)
        break
      }
    }

    if (!fs.existsSync(OUT_DIR + "/trace.json")) {
      fs.writeFileSync(OUT_DIR + "/trace.json", JSON.stringify(trace, null, 2))
    }
    console.log(`RESULT monitorFrame=${monitorFrame} menuFrame=${menuFrame} crash=${JSON.stringify(crashInfo && { pb: crashInfo.pb.toString(16), pc: crashInfo.pc.toString(16), opcode: crashInfo.opcode, s: crashInfo.s, traceLen: crashInfo.trace.length })}`)
    console.log(`STATE ${monitorState}`)
    console.log("MONITOR TEXT >>>")
    console.log(monitorText)
    console.log("<<< MONITOR TEXT")
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    setIigsRomVersion(BESTOF_ROM)
    jest.useRealTimers()
  }
}, 1800000)
