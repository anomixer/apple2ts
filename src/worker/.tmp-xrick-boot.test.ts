import { doSetMachineName, doSetRunMode, resetCpuSpeedForTesting, getCPU } from "./motherboard"
import { getShrDisplayed, getShr, memGetC000, getTextPageAsString, memGet24 } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { setKeyboardState } from "./devices/keyboard"
import { iigsADB, setAdbLogEnabled, getAdbLog } from "./iigs_adb"
import * as fs from "fs"

const PO_PATH = "C:\\\\dev\\\\emu\\\\ap2\\\\DISKS\\\\xrick800k.po"
const OUT_DIR = "C:\\\\Users\\\\USER\\\\AppData\\\\Local\\\\Temp\\\\opencode\\\\xrick"
const STAGES = (process.env.XRICK_STAGES || "1000,2000,3000,4000,5000,6000,7000,8000")
  .split(",").map(Number)

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

const saveShrToBmp = (shrData: Uint8Array, filepath: string) => {
  const width = 640, height = 200
  const palR = new Uint8Array(256), palG = new Uint8Array(256), palB = new Uint8Array(256)
  for (let p = 0; p < 16; p++) {
    const pOffset = 0x7E00 + p * 32
    for (let c = 0; c < 16; c++) {
      const idx = (p << 4) | c
      const colorWord = shrData[pOffset + c * 2] | (shrData[pOffset + c * 2 + 1] << 8)
      palR[idx] = ((colorWord >> 8) & 0x0F) * 17
      palG[idx] = ((colorWord >> 4) & 0x0F) * 17
      palB[idx] = (colorWord & 0x0F) * 17
    }
  }
  const rowSize = width * 4, pixelArraySize = rowSize * height, fileSize = 54 + pixelArraySize
  const bmp = Buffer.alloc(fileSize)
  bmp.write("BM", 0); bmp.writeUInt32LE(fileSize, 2); bmp.writeUInt32LE(54, 10)
  bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(width, 18); bmp.writeInt32LE(-height, 22)
  bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(32, 28); bmp.writeUInt32LE(0, 30)
  bmp.writeUInt32LE(pixelArraySize, 34)
  for (let y = 0; y < height; y++) {
    const lineOffset = y * 160
    const scb = shrData[0x7D00 + y]
    const palIdx = (scb & 0x0F) << 4
    const is640 = (scb & 0x80) !== 0
    const rowOffset = 54 + y * rowSize
    if (!is640) {
      for (let x = 0; x < 320; x++) {
        const byteVal = shrData[lineOffset + (x >> 1)]
        const color4Bit = (x & 1) ? (byteVal & 0x0F) : ((byteVal >> 4) & 0x0F)
        const c = palIdx | color4Bit
        const px1 = rowOffset + (x * 2) * 4
        bmp[px1] = palB[c]; bmp[px1 + 1] = palG[c]; bmp[px1 + 2] = palR[c]; bmp[px1 + 3] = 255
        const px2 = px1 + 4
        bmp[px2] = palB[c]; bmp[px2 + 1] = palG[c]; bmp[px2 + 2] = palR[c]; bmp[px2 + 3] = 255
      }
    } else {
      const quarterOffsets = [8, 12, 0, 4]
      for (let x = 0; x < 640; x++) {
        const byteVal = shrData[lineOffset + (x >> 2)]
        const shift = (3 - (x & 3)) * 2
        const color2Bit = (byteVal >> shift) & 0x03
        const c = palIdx | quarterOffsets[x & 3] + color2Bit
        const px = rowOffset + x * 4
        bmp[px] = palB[c]; bmp[px + 1] = palG[c]; bmp[px + 2] = palR[c]; bmp[px + 3] = 255
      }
    }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(filepath, bmp)
}

const state = () => {
  const cpu = getCPU() as any
  return `PB=${cpu.PB.toString(16).padStart(2, "0")} PC=${cpu.PC.toString(16).padStart(4, "0")} E=${cpu.emulationMode} P=${cpu.P.toString(16)} DB=${cpu.DB.toString(16)} A=${cpu.A.toString(16)} X=${cpu.X.toString(16)} Y=${cpu.Y.toString(16)}`
}

const dump = (label: string) => {
  const text = getTextPageAsString()
  const shr = getShrDisplayed()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(`${OUT_DIR}\\\\${label}.txt`, text)
  saveShrToBmp(shr, `${OUT_DIR}\\\\${label}.bmp`)
  console.log(`STAGE ${label} ${state()}`)
  console.log(`STAGE ${label} c000=${memGetC000(0xC000).toString(16)} modifiers=${iigsADB.peekModifiers().toString(16)} keyreg=${iigsADB.getKeyboardEvent().map(b => b.toString(16)).join(",")}`)
  console.log(`STAGE ${label} text-start:\n` + text.replace(/\0/g, "·").slice(0, 1200))
}

describe("XRick boot investigation", () => {
  let last = 0
  test("stages", () => {
    jest.useFakeTimers()
    setIsTesting()
    setAdbLogEnabled(true)
    doSetMachineName("APPLE2GS")
    const data = fs.readFileSync(PO_PATH)
    const props: DriveProps = {
      index: 0, hardDrive: true, drive: 1, filename: "xrick800k.po", status: "",
      motorRunning: false, diskHasChanges: false, isWriteProtected: false,
      diskData: new Uint8Array(data), lastAppleWriteTime: 0, cloudData: null,
      writableFileHandle: null, lastLocalFileWriteTime: 0,
    }
    expect(doSetEmuDriveNewData(props)).toBe(true)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    for (const st of STAGES) {
      pump(st - last)
      last = st
      dump(`boot${st}`)
    }
    const adbAny = iigsADB as any
    console.log(`PRE-K modes=${adbAny.modes?.toString(16)} interruptEnables=${adbAny.interruptEnables?.toString(16)} hasKeyData=${iigsADB.hasKeyData()} status=${iigsADB.readStatus().toString(16)}`)
    const logStart = getAdbLog().length
    const cpu = getCPU() as any
    const origPI = cpu.processInstruction.bind(cpu)
    const origRead8 = cpu.read8.bind(cpu)
    const origWrite8 = cpu.write8.bind(cpu)
    let tracing = false
    const trace: string[] = []
    const busTrace: string[] = []
    const watched = [0xc000, 0xc010, 0xc024, 0xc025, 0xc026, 0xc027, 0xc046, 0xc054, 0xc055, 0xc068]
    cpu.read8 = function (address: number) {
      const v = origRead8(address)
      if (tracing && busTrace.length < 600 && watched.includes(address & 0xffff)) {
        busTrace.push(`R ${this.PB.toString(16).padStart(2, "0")}:${this.PC.toString(16).padStart(4, "0")} ${address.toString(16)} -> ${v.toString(16)}`)
      }
      return v
    }
    cpu.write8 = function (address: number, value: number) {
      if (tracing && busTrace.length < 600 && watched.includes(address & 0xffff)) {
        busTrace.push(`W ${this.PB.toString(16).padStart(2, "0")}:${this.PC.toString(16).padStart(4, "0")} ${address.toString(16)} <- ${value.toString(16)}`)
      }
      return origWrite8(address, value)
    }
    cpu.processInstruction = function (traceCb: any) {
      const beforePB = this.PB
      const beforePC = this.PC
      const r = origPI(traceCb)
      if (tracing && trace.length < 900) {
        const tracedPc = (beforePB << 16) | beforePC
        const isIrqPath = (beforePB === 0xff && ((beforePC >= 0x8180 && beforePC < 0x8500) || (beforePC >= 0xb700 && beforePC < 0xbcc0)))
          || (beforePB === 0xe1 && beforePC < 0x80)
        if (isIrqPath) {
          const beforeOp = memGet24(tracedPc)
          const afterOp = memGet24((this.PB << 16) | this.PC)
          const line = `before=${beforePB.toString(16).padStart(2, "0")}:${beforePC.toString(16).padStart(4, "0")} op=${beforeOp.toString(16).padStart(2, "0")} after=${this.PB.toString(16).padStart(2, "0")}:${this.PC.toString(16).padStart(4, "0")} nop=${afterOp.toString(16)} P=${this.P.toString(16)} A=${this.A.toString(16)} X=${this.X.toString(16)} Y=${this.Y.toString(16)} S=${this.S.toString(16)} D=${this.D.toString(16)}`
          trace.push(line)
        }
      }
      return r
    }
    tracing = true
    const before = getShrDisplayed().slice()
    const beforeText = getTextPageAsString()
    setKeyboardState({ key: 0x28, isDown: true, repeat: false, domCode: "KeyK" })
    pump(10)
    console.log(`AFTER K c000=${memGetC000(0xC000).toString(16)} keyreg=${iigsADB.getKeyboardEvent().map(b => b.toString(16)).join(",")} status=${iigsADB.readStatus().toString(16)} pending=${iigsADB.interruptPending()}`)
    console.log("TRACE:\n" + trace.join("\n"))
    console.log("BUS:\n" + busTrace.join("\n"))
    const adbNew = getAdbLog().slice(logStart).filter(e => e.kind !== "stat")
    console.log("ADB-NEW:\n" + JSON.stringify(adbNew.slice(0, 120), null, 2))
    const adbAll = getAdbLog().slice(logStart)
    console.log(`ADB-ALL count=${adbAll.length} first=${JSON.stringify(adbAll.slice(0, 5))} last=${JSON.stringify(adbAll.slice(-5))}`)
    pump(190)
    const changedDown = Array.from(getShrDisplayed()).reduce((n, b, i) => n + (b === before[i] ? 0 : 1), 0)
    dump(`afterKdown${last}`)
    console.log(`SHR pixels bytes changed after K down: ${changedDown}; text changed: ${getTextPageAsString() !== beforeText}`)
    setKeyboardState({ key: 0x28, isDown: false, repeat: false, domCode: "KeyK" })
    pump(200)
    dump(`afterK${last}`)
    const changed = Array.from(getShrDisplayed()).reduce((n, b, i) => n + (b === before[i] ? 0 : 1), 0)
    console.log(`SHR pixels bytes changed after K: ${changed}; text changed: ${getTextPageAsString() !== beforeText}`)
    setKeyboardState({ key: 0x26, isDown: true, repeat: false, domCode: "KeyJ" })
    pump(200)
    dump(`afterJ${last}`)
    expect(true).toBe(true)
  }, 600000)
})
