// TEMPORARY probe: save the Super Hi-Res screen + text page at a few frames
// around the Rastan "PLAYER 1 READY -> black" window.
import * as fs from "fs"
import { doSetMachineName, doSetSpeedMode, doSetRunMode, resetCpuSpeedForTesting } from "./motherboard"
import { getShr, getTextPageAsString } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"

const D1 = "C:\\dev\\emu\\ap2\\DISKS\\rastan1.woz"
const D2 = "C:\\dev\\emu\\ap2\\DISKS\\rastan2.woz"
const hasDisks = fs.existsSync(D1) && fs.existsSync(D2)
const FRAMES = 8300
const OUT = "C:\\dev\\apple2ts\\.tmp-shot"
const SHOT_FRAMES = [7400, 7600, 7700, 7733, 7747, 7800, 7900]

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
  bmp.write("BM", 0)
  bmp.writeUInt32LE(fileSize, 2)
  bmp.writeUInt32LE(54, 10)
  bmp.writeUInt32LE(40, 14)
  bmp.writeInt32LE(width, 18)
  bmp.writeInt32LE(-height, 22)
  bmp.writeUInt16LE(1, 26)
  bmp.writeUInt16LE(32, 28)
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
  fs.writeFileSync(filepath, bmp)
}

describe("rastan shots", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    setIsTesting()
    doSetMachineName("APPLE2GS")
  })
  afterEach(() => {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  })

  test("rastan shots", () => {
    if (!hasDisks) { console.warn("disks missing"); return }
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })
    for (const [idx, path] of [[4, D1], [5, D2]] as const) {
      const data = new Uint8Array(fs.readFileSync(path))
      expect(doSetEmuDriveNewData({
        index: idx, hardDrive: false, drive: idx === 5 ? 2 : 1,
        filename: path.split("\\").pop() || "disk", status: "", motorRunning: false,
        diskHasChanges: false, isWriteProtected: false, diskData: data,
        lastAppleWriteTime: 0, cloudData: null, writableFileHandle: null,
        lastLocalFileWriteTime: 0,
      } as DriveProps)).toBe(true)
    }
    doSetSpeedMode(1)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    for (let frame = 0; frame < FRAMES; frame++) {
      jest.advanceTimersByTime(17)
      if (SHOT_FRAMES.includes(frame)) {
        const shr = getShr()
        saveShrToBmp(shr, `${OUT}\\f${frame}.bmp`)
        console.log(`[x] shot f=${frame} text=${JSON.stringify(getTextPageAsString())}`)
      }
    }
    console.log(`[x] done`)
  }, 1800000)
})
