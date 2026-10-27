import {
  decodeSector62,
  encodeSector62,
  FLOPPY35_BLOCK_BYTES,
  getFloppy35PayloadInfo,
} from "./devices/floppy35"
import { getDriveBitstreamByIndex, getDriveDataByIndex, getDriveStateByIndex, doSetEmuDriveNewData } from "./devices/drivestate"
import { doSetMachineName } from "./motherboard"
import { iigsGetIwmEnable35, iigsSetIwmEnable35, memGet24, memSet24 } from "./memory"
import { iwmFlushWrites35, iwmResetTiming } from "./devices/diskdata"
import { s6502 } from "./instructions"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

const DISK_PATH = process.env.GS_FLOPPY35_PATH || "C:\\dev\\emu\\ap2\\mcs.2mg"

const readByteAt = (stream: Uint8Array, bit: number) => {
  let byte = 0
  for (let b = 0; b < 8; b++) {
    const value = (stream[bit >> 3] >> (7 - (bit & 7))) & 1
    byte = (byte << 1) | value
    bit++
  }
  return byte
}

// Sync bytes are 10 bits wide, so fields after a gap are not byte-aligned in
// the containing buffer. Slide a bit window to find a marker.
const findBitPattern = (stream: Uint8Array, fromBit: number, toBit: number, pattern: number[]) => {
  for (let bit = fromBit; bit + pattern.length * 8 <= toBit; bit++) {
    let match = true
    for (let i = 0; i < pattern.length; i++) {
      if (readByteAt(stream, bit + i * 8) !== pattern[i]) { match = false; break }
    }
    if (match) return bit
  }
  return -1
}

test("6-and-2 sector encode/decode round-trips", () => {
  const buffer = new Uint8Array(524)
  for (let i = 0; i < buffer.length; i++) buffer[i] = (i * 37 + 11) & 0xFF
  buffer.fill(0, 0, 12)
  const nibbles = encodeSector62(buffer)
  expect(nibbles.length).toBe(703)
  const decoded = decodeSector62(nibbles)
  expect(decoded).not.toBeNull()
  expect(Array.from(decoded!)).toEqual(Array.from(buffer))
})

test("800K block image mounts as a 3.5\" disk with a full GCR bit stream", () => {
  setIsTesting()
  doSetMachineName("APPLE2GS")
  const data = new Uint8Array(fs.readFileSync(DISK_PATH))
  const info = getFloppy35PayloadInfo(data)
  expect(info.size).toBe(FLOPPY35_BLOCK_BYTES)

  // The mount path routes an 800K image into slot 5 (drive-state index 4),
  // nibblizes it, and keeps the raw bytes for writeback.
  expect(doSetEmuDriveNewData({
    index: 4, hardDrive: false, drive: 1, filename: "test.2mg", status: "",
    motorRunning: false, diskHasChanges: false, isWriteProtected: false,
    diskData: data, lastAppleWriteTime: 0, cloudData: null,
    writableFileHandle: null, lastLocalFileWriteTime: 0,
  } as DriveProps)).toBe(true)

  const ds = getDriveStateByIndex(4)
  expect(ds.is35).toBe(true)
  expect(ds.blockMedia35).toBe(true)
  expect(ds.maxQuarterTrack).toBe(159)
  expect(ds.optimalTiming).toBe(16)

  const stream = getDriveBitstreamByIndex(4)
  expect(stream.length).toBeGreaterThan(FLOPPY35_BLOCK_BYTES)
  for (let index = 0; index < 160; index++) {
    // Track 0 has to start past the padding byte or the read engine treats it
    // as an empty track (offset 0 means "no data").
    expect(ds.trackStart[index]).toBeGreaterThan(0)
    expect(ds.trackNbits[index]).toBeGreaterThan(0)
  }

  // Track 0 side 0 starts with GAP A sync bytes, then the first physical
  // sector, which the interleave table makes logical sector 0. Sync bytes are
  // 10 bits wide, so scan at the bit level rather than in byte steps.
  const trackStartBit = ds.trackStart[0] * 8
  const trackEndBit = trackStartBit + ds.trackNbits[0]
  const addressBit = findBitPattern(stream, trackStartBit, trackEndBit, [0xD5, 0xAA, 0x96])
  expect(addressBit).toBeGreaterThanOrEqual(0)
  // 3 prologue + 5 encoded address bytes + DE AA FF, then GAP B.
  const dataBit = findBitPattern(
    stream, addressBit + 11 * 8, trackEndBit, [0xD5, 0xAA, 0xAD])
  expect(dataBit).toBeGreaterThanOrEqual(0)
  const sectorNibble = readByteAt(stream, dataBit + 24) // encoded sector 0
  expect(sectorNibble).toBe(0x96)
  const sectorNibbles = new Uint8Array(703)
  for (let i = 0; i < 703; i++) {
    sectorNibbles[i] = readByteAt(stream, dataBit + 32 + i * 8)
  }
  const decoded = decodeSector62(sectorNibbles)
  expect(decoded).not.toBeNull()

  // Interleave position 0 is logical sector 0 = the image's first block.
  expect(Array.from(decoded!.slice(12))).toEqual(
    Array.from(data.slice(info.offset, info.offset + 512)))
})

test("3.5\" async write clocks a data field onto the media and splices it back", () => {
  setIsTesting()
  doSetMachineName("APPLE2GS")
  const data = new Uint8Array(fs.readFileSync(DISK_PATH))
  const info = getFloppy35PayloadInfo(data)
  expect(doSetEmuDriveNewData({
    index: 4, hardDrive: false, drive: 1, filename: "test.2mg", status: "",
    motorRunning: false, diskHasChanges: false, isWriteProtected: false,
    diskData: data, lastAppleWriteTime: 0, cloudData: null,
    writableFileHandle: null, lastLocalFileWriteTime: 0,
  } as DriveProps)).toBe(true)

  const ds = getDriveStateByIndex(4)
  const stream = getDriveBitstreamByIndex(4)
  expect(ds.is35).toBe(true)

  // Track 0, side 0: find the first address field and the data field that
  // follows it (logical sector 0).
  const trackStartBit = ds.trackStart[0] * 8
  const trackEndBit = trackStartBit + ds.trackNbits[0]
  const addressBit = findBitPattern(stream, trackStartBit, trackEndBit, [0xD5, 0xAA, 0x96])
  expect(addressBit).toBeGreaterThanOrEqual(0)
  const dataBit = findBitPattern(stream, addressBit + 11 * 8, trackEndBit, [0xD5, 0xAA, 0xAD])
  expect(dataBit).toBeGreaterThanOrEqual(0)
  const sectorNibble = readByteAt(stream, dataBit + 24)

  // A payload different from the mounted image, so a successful splice shows.
  const buffer = new Uint8Array(524)
  for (let i = 12; i < 524; i++) buffer[i] = (i * 7 + 3) & 0xFF
  const field = [0xD5, 0xAA, 0xAD, sectorNibble, ...Array.from(encodeSector62(buffer)), 0xDE, 0xAA, 0xFF]

  // Put the IWM into 3.5" async-write mode the way the ROM does: Q6 on, then a
  // mode-register write with ENABLE released, then ENABLE asserted.
  iigsSetIwmEnable35(true)
  ds.spindleOn = true
  memSet24(0xC0ED, 0)
  memSet24(0xC0EF, 0xFF)
  memSet24(0xC0E9, 0)
  expect(iigsGetIwmEnable35()).toBe(true)

  iwmResetTiming()
  ds.quarterTrack = 0
  ds.trackLocation = dataBit - trackStartBit

  const handshake = () => memGet24(0xC0EC) & 0xFF
  for (const byte of field) {
    let guard = 0
    while ((handshake() & 0x80) === 0 && guard++ < 64) s6502.cycleCount += 6
    expect(guard).toBeLessThan(64)
    s6502.cycleCount += 4
    memSet24(0xC0ED, byte)
  }
  // The ROM waits for bit 6 to clear after the epilogue, i.e. until the last
  // byte has actually been clocked onto the media.
  let guard = 0
  while ((handshake() & 0x40) !== 0 && guard++ < 64) s6502.cycleCount += 6
  expect(guard).toBeLessThan(64)

  iwmFlushWrites35(4)
  expect(ds.diskHasChanges).toBe(true)
  iwmFlushWrites35(4)
  const image = getDriveDataByIndex(4)
  expect(Array.from(image.slice(info.offset, info.offset + 512)))
    .toEqual(Array.from(buffer.slice(12)))
  // Neighbouring sectors are untouched.
  expect(image[info.offset + 512]).toBe(data[info.offset + 512])
})

test("write-protected 3.5\" media does not record an async write", () => {
  setIsTesting()
  doSetMachineName("APPLE2GS")
  const data = new Uint8Array(fs.readFileSync(DISK_PATH))
  const info = getFloppy35PayloadInfo(data)
  expect(doSetEmuDriveNewData({
    index: 4, hardDrive: false, drive: 1, filename: "test.2mg", status: "",
    motorRunning: false, diskHasChanges: false, isWriteProtected: true,
    diskData: data, lastAppleWriteTime: 0, cloudData: null,
    writableFileHandle: null, lastLocalFileWriteTime: 0,
  } as DriveProps)).toBe(true)

  const ds = getDriveStateByIndex(4)
  expect(ds.isWriteProtected).toBe(true)
  const stream = getDriveBitstreamByIndex(4)
  const trackStartBit = ds.trackStart[0] * 8
  const trackEndBit = trackStartBit + ds.trackNbits[0]
  const addressBit = findBitPattern(stream, trackStartBit, trackEndBit, [0xD5, 0xAA, 0x96])
  const dataBit = findBitPattern(stream, addressBit + 11 * 8, trackEndBit, [0xD5, 0xAA, 0xAD])
  expect(dataBit).toBeGreaterThanOrEqual(0)
  const sectorNibble = readByteAt(stream, dataBit + 24)
  const buffer = new Uint8Array(524)
  for (let i = 12; i < 524; i++) buffer[i] = (i * 5 + 9) & 0xFF
  const field = [0xD5, 0xAA, 0xAD, sectorNibble, ...Array.from(encodeSector62(buffer)), 0xDE, 0xAA, 0xFF]

  iigsSetIwmEnable35(true)
  ds.spindleOn = true
  memSet24(0xC0ED, 0)
  memSet24(0xC0EF, 0xFF)
  memSet24(0xC0E9, 0)
  iwmResetTiming()
  ds.quarterTrack = 0
  ds.trackLocation = dataBit - trackStartBit

  const handshake = () => memGet24(0xC0EC) & 0xFF
  for (const byte of field) {
    let guard = 0
    while ((handshake() & 0x80) === 0 && guard++ < 64) s6502.cycleCount += 6
    expect(guard).toBeLessThan(64)
    s6502.cycleCount += 4
    memSet24(0xC0ED, byte)
  }
  let guard = 0
  while ((handshake() & 0x40) !== 0 && guard++ < 64) s6502.cycleCount += 6
  expect(guard).toBeLessThan(64)

  iwmFlushWrites35(4)
  expect(ds.diskHasChanges).toBe(false)
  const image = getDriveDataByIndex(4)
  expect(Array.from(image.slice(info.offset, info.offset + 524)))
    .toEqual(Array.from(data.slice(info.offset, info.offset + 524)))
})
