import { doSetMachineName, doSetRunMode, resetCpuSpeedForTesting } from "./motherboard"
import { megaIIAux } from "./memory"
import { SWITCHES } from "./softswitches"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

// GS/OS 6.0.1 on the Apple IIgs: cold boot the 65816, let the SmartPort hard
// drive in slot 7 drive 1 boot ProDOS -> START.GS.OS, and confirm GS/OS gets
// all the way to the Super Hi-Res Finder desktop.
//
// This is the end-to-end regression test for the IIgs boot path. The browser
// build used to stall on the GS/OS welcome screen because a stale
// cpu.irqPending survived between VBL windows; the emulator now re-evaluates
// the level-driven $C046 IRQ line every instruction.
const PO_PATH = process.env.GSBOOT_PO || "C:\\dev\\emu\\ap2\\GSOS601.po"
const FRAMES = Number(process.env.GSBOOT_FRAMES || 4000)
const OUT_BMP = process.env.GSBOOT_OUT || "gsos_boot.bmp"

// Super Hi-Res page 1 scan control byte table offset.
const SHR_SCB_OFFSET = 0x7D00

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
  bmp.writeUInt32LE(0, 30)
  bmp.writeUInt32LE(pixelArraySize, 34)
  for (let y = 0; y < height; y++) {
    const lineOffset = y * 160
    const scb = shrData[SHR_SCB_OFFSET + y]
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
  console.log(`Saved ${filepath}`)
}

test(`Apple IIgs boots GS/OS 6.0.1 from ${PO_PATH}`, () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")

    const data = fs.readFileSync(PO_PATH)
    const filename = PO_PATH.split("\\").pop() || "GSOS601.po"
    const props: DriveProps = {
      index: 0,
      hardDrive: true,
      drive: 1,
      filename,
      status: "",
      motorRunning: false,
      diskHasChanges: false,
      isWriteProtected: false,
      diskData: new Uint8Array(data),
      lastAppleWriteTime: 0,
      cloudData: null,
      writableFileHandle: null,
      lastLocalFileWriteTime: 0,
    }
    expect(doSetEmuDriveNewData(props)).toBe(true)

    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)

    for (let f = 0; f < FRAMES; f++) {
      jest.advanceTimersByTime(17)
    }

    console.log(`TEXT=${SWITCHES.TEXT.isSet} HIRES=${SWITCHES.HIRES.isSet} 80COL=${SWITCHES.COLUMN80.isSet}`)

    let shrNonZero = 0
    for (let i = 0x2000; i < 0xA000; i++) {
      if (megaIIAux[i] !== 0) shrNonZero++
    }
    console.log(`SHR page 1 non-zero bytes: ${shrNonZero}/32768`)
    expect(shrNonZero).toBeGreaterThan(30000)

    // The Finder fills the whole screen: the menu bar is on scan line 0 and
    // the trash can at the bottom right. The GS/OS welcome screen only draws a
    // box in the middle, so top and bottom rows stay empty when the boot has
    // stalled.
    const rowIsDrawn = (y: number) => {
      const lineOffset = y * 160
      for (let x = 0; x < 160; x++) {
        if (megaIIAux[0x2000 + lineOffset + x] !== 0) return true
      }
      return false
    }
    console.log(`line0 drawn=${rowIsDrawn(0)} line199 drawn=${rowIsDrawn(199)}`)
    expect(rowIsDrawn(0)).toBe(true)
    expect(rowIsDrawn(199)).toBe(true)

    const shrData = new Uint8Array(32768)
    for (let i = 0; i < 32768; i++) shrData[i] = megaIIAux[0x2000 + i]
    saveShrToBmp(shrData, OUT_BMP)
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
})
