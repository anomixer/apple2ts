import { doSetMachineName, doSetRunMode, doSetSpeedMode, getCPU, resetCpuSpeedForTesting } from "./motherboard"
import { CPU65816 } from "./cpu65816"
import { getShrCompletedDisplay, getTextPageAsString, setIigsRomVersion } from "./memory"
import { doSetEmuDriveNewData, getDriveStateByIndex } from "./devices/drivestate"
import { setKeyboardState } from "./devices/keyboard"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const DISK_PATH = "C:\\dev\\emu\\ap2\\DISKS\\Bestof2vol2.2mg"
const OUT_DIR = "C:\\dev\\apple2ts\\.tmp-bestof2vol2"
const FRAMES = Number(process.env.BESTOF_FRAMES || 30000)

test("Bestof2vol2.2mg boot probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    setIigsRomVersion("01")
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
    let lastShrLit = 0

    for (let f = 0; f < FRAMES; f++) {
      if (f === 15000) {
        setKeyboardState({ key: 0x20, isDown: true, repeat: false, domCode: "Space" })
      }
      if (f === 15002) {
        setKeyboardState({ key: 0x20, isDown: false, repeat: false, domCode: "Space" })
      }
      jest.advanceTimersByTime(17)
      const text = getTextPageAsString().replace(/\r/g, "\n")
      if (f % 500 === 0) {
        const shr = getShrCompletedDisplay()
        const lit = Array.from(shr).filter(Boolean).length
        lastShrLit = lit
        fs.writeFileSync(`${OUT_DIR}\\shr-${f}.bin`, shr)
        console.log(`FRAME ${f} lit=${lit} PB=${cpu.PB.toString(16).padStart(2, "0")} PC=${cpu.PC.toString(16)} text=${JSON.stringify(text.slice(-80))}`)
      }
      if (text !== lastText) {
        lastText = text
        if (f % 100 === 0) fs.writeFileSync(`${OUT_DIR}\\text-${f}.txt`, text)
      }
      if (text.includes("BRK")) {
        monitorFrame = f
        monitorText = text
        monitorState = `PB=${cpu.PB.toString(16).padStart(2, "0")} PC=${cpu.PC.toString(16).padStart(4, "0")} A=${cpu.A.toString(16).padStart(4, "0")} X=${cpu.X.toString(16).padStart(4, "0")} Y=${cpu.Y.toString(16).padStart(4, "0")} S=${cpu.S.toString(16)} D=${cpu.D.toString(16)} P=${cpu.P.toString(16)} e=${cpu.emulationMode}`
        const shr = getShrCompletedDisplay()
        lastShrLit = Array.from(shr).filter(Boolean).length
        fs.writeFileSync(`${OUT_DIR}\\monitor-text.txt`, text)
        fs.writeFileSync(`${OUT_DIR}\\monitor-shr.bin`, shr)
        break
      }
    }

    console.log(`RESULT monitorFrame=${monitorFrame} state=${monitorState} lit=${lastShrLit}`)
    console.log("MONITOR TEXT >>>")
    console.log(monitorText)
    console.log("<<< MONITOR TEXT")
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    setIigsRomVersion("01")
    jest.useRealTimers()
  }
}, 1800000)
