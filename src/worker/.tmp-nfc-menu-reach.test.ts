import { doSetMachineName, doSetRunMode, getCPU } from "./motherboard"
import { getShrDisplayed, getTextPageAsString, gsRAM } from "./memory"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { doRestoreSaveState, doGetSaveState } from "./save_restore"
import { setKeyboardState } from "./devices/keyboard"
import * as fs from "fs"

const SAVE_IN = process.env.NFC_SAVE_IN || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-resume20-long\\state-40000.json"
const MEM_IN = process.env.NFC_MEM || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-resume20-long\\full-40000.bin"
const OUT_DIR = process.env.NFC_OUT || "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\nfc-menu-reach"

const pump = (frames: number) => {
  for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
}

const key = (domCode: string, keyCode = -1, hold = 10, after = 60) => {
  setKeyboardState({ key: keyCode, isDown: true, repeat: false, domCode })
  pump(hold)
  setKeyboardState({ key: keyCode, isDown: false, repeat: false, domCode })
  pump(after)
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

const dump = (label: string) => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const shr = getShrDisplayed()
  fs.writeFileSync(`${OUT_DIR}\\${label}-shr.bin`, shr)
  saveShrToBmp(shr, `${OUT_DIR}\\${label}.bmp`)
  fs.writeFileSync(`${OUT_DIR}\\${label}.txt`, getTextPageAsString())
  const cpu = getCPU() as any
  console.log(`[NFC-REACH] ${label} PB=${cpu.PB.toString(16)} PC=${cpu.PC.toString(16)} A=${cpu.A.toString(16)} S=${cpu.S.toString(16)} E=${cpu.emulationMode} cycles=${cpu.cycles}`)
}

test("reach NFCDemo main menu from 40k title state", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  const saved = JSON.parse(fs.readFileSync(SAVE_IN, "utf8"))
  doRestoreSaveState(saved, true, false, 2.0)
  doSetRunMode(RUN_MODE.RUNNING, false)
  doRestoreSaveState(saved, false, false, 2.0)
  const cpu = getCPU() as any
  cpu.setSaveState(saved.state6502.cpu65816)
  const full = fs.readFileSync(MEM_IN)
  for (let bank = 0x02; bank < 0x80; bank++) {
    gsRAM.set(full.subarray(bank * 0x10000, (bank + 1) * 0x10000), bank * 0x10000)
  }
  dump("beforeKey")
  key("Space", 32, 10, 100)
  dump("afterSpace")
  for (let f = 2000; f <= 20000; f += 2000) {
    pump(2000)
    dump(`after${f}`)
  }
  fs.writeFileSync(`${OUT_DIR}\\after20000-state.json`, JSON.stringify(doGetSaveState(true)))
  doSetRunMode(RUN_MODE.PAUSED, false)
  jest.useRealTimers()
}, 1200000)
