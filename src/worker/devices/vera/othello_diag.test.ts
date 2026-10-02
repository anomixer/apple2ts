// Diagnostic dump for the CX16-OTHELLO Apple II / VERA port.
// Prints the VERA register file, the two tilemaps, a couple of tiles and
// renders the framebuffer with layers/sprites selectively enabled.
//
// Run from the apple2ts repo:  npx jest othello_diag

import fs from "fs"
import path from "path"
import { enableVera, resetVera, initVera } from "./vera"
import { video_step, video_get_framebuffer, video_read, video_write } from "./video"
import { memGet, memSet } from "../../memory"
import { doBoot, doSetRunMode } from "../../motherboard"
import { s6502, setPC } from "../../instructions"
import { processInstruction } from "../../cpu6502"
import { setIsTesting } from "../../worker2main"
import { setSlotIOCallback } from "../../memory"
import { parseAssembly } from "../../utility/assembler"
import { RUN_MODE } from "../../../common/utility"

const ROOT = "C:/dev/cx16-othello-vera/vera"
const OUT = path.join(ROOT, "build", "headless")
const LOAD = 0x1400

const hdv = new Uint8Array(fs.readFileSync(path.join(ROOT, "cx16-othello.hdv")))
let log: string[] = []
const say = (s: string) => { log.push(s) }

const serviceMli = () => {
  const sp = s6502.StackPtr
  const ret = memGet(0x0100 + ((sp + 1) & 0xff), false) | (memGet(0x0100 + ((sp + 2) & 0xff), false) << 8)
  const op = memGet(ret + 1, false)
  const pp = memGet(ret + 2, false) | (memGet(ret + 3, false) << 8)
  let status = 0
  if (op === 0x80 || op === 0x81) {
    const buf = memGet(pp + 2, false) | (memGet(pp + 3, false) << 8)
    const blk = memGet(pp + 4, false) | (memGet(pp + 5, false) << 8)
    const src = blk * 512
    if (src + 512 > hdv.length) status = 0x27
    else if (op === 0x80) { for (let i = 0; i < 512; i++) memSet(buf + i, hdv[src + i]) }
    else { for (let i = 0; i < 512; i++) hdv[src + i] = memGet(buf + i, false) }
  } else status = 0x50
  memSet(pp + 6, status)
  s6502.Accum = status
  s6502.StackPtr = (sp + 2) & 0xff
  s6502.StackPtr = (s6502.StackPtr - 2) & 0xff
  memSet(0x0100 + ((s6502.StackPtr + 1) & 0xff), (ret + 4) & 0xff)
  memSet(0x0100 + ((s6502.StackPtr + 2) & 0xff), ((ret + 4) >> 8) & 0xff)
  setPC(ret + 4)
}

const run = (max: number) => {
  let n = 0
  while (n < max) {
    if (s6502.PC === 0xbf00) { serviceMli(); n++; continue }
    if (s6502.PC < 0x0300) return `reset-vector @ $${s6502.PC.toString(16)}`
    processInstruction()
    n++
  }
  return "budget"
}

const vramRead = (addr: number, bank: number, len: number) => {
  memSet(0xc205, 0x00)
  memSet(0xc200, addr & 0xff)
  memSet(0xc201, (addr >> 8) & 0xff)
  // Apple II VERA card ADDR_H: bit0 = VRAM bank, bits 7:3 = stride index
  // (index 2 = +1).  This is the encoding vera_set_addr() writes.
  memSet(0xc202, (bank ? 1 : 0) | 0x10)
  const out = new Uint8Array(len)
  for (let i = 0; i < len; i++) out[i] = memGet(0xc203, false)
  return out
}

const writeBmp = (file: string, fb: Uint8ClampedArray) => {
  const w = 640, h = 480
  const padded = (w * 3 + 3) & ~3
  const size = 54 + padded * h
  const out = Buffer.alloc(size)
  out.write("BM", 0); out.writeUInt32LE(size, 2); out.writeUInt32LE(54, 10)
  out.writeUInt32LE(40, 14); out.writeInt32LE(w, 18); out.writeInt32LE(-h, 22)
  out.writeUInt16LE(1, 26); out.writeUInt16LE(24, 28); out.writeUInt32LE(padded, 34)
  for (let y = 0; y < h; y++) {
    const src = y * w * 4, dst = 54 + y * padded
    for (let x = 0; x < w; x++) {
      out[dst + x * 3] = fb[src + x * 4 + 2]
      out[dst + x * 3 + 1] = fb[src + x * 4 + 1]
      out[dst + x * 3 + 2] = fb[src + x * 4]
    }
  }
  fs.writeFileSync(file, out)
}

const loadImage = (file: string) => {
  const bin = fs.readFileSync(path.join(ROOT, "build", file))
  const addr = bin[0] | (bin[1] << 8)
  for (let i = 0; i < bin.length - 4; i++) memSet(addr + i, bin[4 + i])
  return addr
}

const boot = () => {
  doSetRunMode(RUN_MODE.PAUSED, false)
  doBoot()
  initVera()
  resetVera()
  enableVera(true, 2)
  memSet(0xbf30, 0x70)
  const addr = loadImage("main.bin")
  expect(addr).toBe(LOAD)
  s6502.StackPtr = 0x00
  s6502.PStatus = 0x24
  setPC(LOAD)
}

describe("CX16-OTHELLO VERA diagnostics", () => {
  beforeAll(() => {
    setIsTesting()
    fs.mkdirSync(OUT, {recursive: true})
    if (typeof globalThis.postMessage === "function") {
      jest.spyOn(globalThis, "postMessage").mockImplementation(() => {})
    }
  })

  test("dump registers, tilemaps, tiles and palette after boot", () => {
    boot()
    const stopped = run(120000)
    video_step(1, 20000, false)
    say(`stopped=${stopped}`)

    // apple2ts VERA register map (compressed VidHD layout, 0x00-0x1F):
    // 00-02 ADDR0, 03/04 DATA0/1, 05 CTRL, 06 IRQ_EN, 07 IRQ_FLAGS, 08 VCOUNT,
    // 09-0C DC regs (DCSEL-selected), 0D-13 layer0, 14-1A layer1,
    // 1B-1D PCM, 1E/1F SPI.
    const names: Record<number, string> = {
      0x00: "ADDR_L", 0x01: "ADDR_M", 0x02: "ADDR_H", 0x05: "CTRL",
      0x06: "IRQ_ENABLE", 0x07: "IRQ_FLAGS", 0x08: "VCOUNT",
      0x09: "DC0", 0x0a: "DC1", 0x0b: "DC2", 0x0c: "DC3",
      0x0d: "L0_CONFIG", 0x0e: "L0_MAPBASE", 0x0f: "L0_TILEBASE",
      0x10: "L0_HSCROLL", 0x11: "L0_VSCROLL", 0x12: "L0_12", 0x13: "L0_13",
      0x14: "L1_CONFIG", 0x15: "L1_MAPBASE", 0x16: "L1_TILEBASE",
      0x17: "L1_HSCROLL", 0x18: "L1_VSCROLL", 0x19: "L1_19", 0x1a: "L1_1A",
      0x1b: "PCM_CTRL", 0x1c: "PCM_RATE", 0x1d: "PCM_DATA",
    }
    memSet(0xc205, 0x00) // CTRL: DCSEL=0, ADDRSEL=0
    for (const reg of [0x00, 0x01, 0x02, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
      0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c]) {
      say(`reg ${reg.toString(16)} ${names[reg] ?? "?"} = ${video_read(reg, true).toString(16)}`)
    }

    const map0 = vramRead(0xa000, 0, 80)
    const map1 = vramRead(0xa800, 0, 80)
    say(`map0[0..40] = ${[...map0].join(",")}`)
    say(`map1[0..40] = ${[...map1].join(",")}`)

    const tile0 = vramRead(0x0000, 0, 64)
    const tile8 = vramRead(0x2000, 0, 64)
    say(`tile0[0..64] = ${[...tile0].map(v => v.toString(16).padStart(2, "0")).join(" ")}`)
    say(`tile8[0..64] = ${[...tile8].map(v => v.toString(16).padStart(2, "0")).join(" ")}`)

    const pal = vramRead(0xfa00, 1, 64)
    say(`palette[0..32] = ${[...pal].map(v => v.toString(16).padStart(2, "0")).join(" ")}`)
    const decoded: string[] = []
    for (let i = 0; i < 32; i++) {
      const b0 = pal[i * 2], b1 = pal[i * 2 + 1]
      decoded.push(`#${((b0 & 0x0f) * 17).toString(16)}${(((b0 >> 4) & 0x0f) * 17).toString(16)}${((b1 & 0x0f) * 17).toString(16)}`)
    }
    say(`rgb[0..32] = ${decoded.join(" ")}`)

    const spr = vramRead(0xfc00, 1, 32)
    say(`sprite0/1 = ${[...spr].map(v => v.toString(16).padStart(2, "0")).join(" ")}`)

    // Self-test the VRAM write/read path through the slot IO registers.
    memSet(0xc205, 0x00)
    memSet(0xc200, 0x00)
    memSet(0xc201, 0x00)
    memSet(0xc202, 0x10)
    for (let i = 0; i < 16; i++) memSet(0xc203, 0xa0 + i)
    memSet(0xc200, 0x00)
    memSet(0xc201, 0x00)
    memSet(0xc202, 0x10)
    const probe: number[] = []
    for (let i = 0; i < 16; i++) probe.push(memGet(0xc203, false))
    say(`vram write/read probe = ${probe.map(v => v.toString(16)).join(" ")}`)

    // Isolate why a later read of the same address differs.
    memSet(0xc200, 0x00)
    memSet(0xc201, 0x00)
    memSet(0xc202, 0x10)
    const probe2: number[] = []
    for (let i = 0; i < 16; i++) probe2.push(memGet(0xc203, false))
    say(`probe2 (no CTRL write) = ${probe2.map(v => v.toString(16)).join(" ")}`)
    const probe3 = vramRead(0x0000, 0, 16)
    say(`probe3 (vramRead) = ${probe3.map(v => v.toString(16)).join(" ")}`)
    const probe4 = vramRead(0x0000, 1, 16)
    say(`probe4 (vramRead bank1) = ${probe4.map(v => v.toString(16)).join(" ")}`)

    // Where did the tile stream land?  Scan a few candidate bases.
    for (const cand of [0x0000, 0x0400, 0x4000, 0x8000, 0xa000, 0xa800]) {
      const s = vramRead(cand, 0, 16)
      say(`vram $${cand.toString(16)} = ${s.map(v => v.toString(16).padStart(2, "0")).join(" ")}`)
    }
    const t1 = vramRead(0x0000, 0, 1024)
    const nz1 = [...t1].filter(v => v !== 0).length
    const t2 = vramRead(0x0400, 0, 1024)
    const nz2 = [...t2].filter(v => v !== 0).length
    say(`nonzero in vram[0..1024]=${nz1}  vram[0x400..0x800]=${nz2}`)

    // Byte-exact comparison against the shipped asset blobs.
    const wantTiles = new Uint8Array(fs.readFileSync(path.join(ROOT, "generated", "tiles.bin")))
    const wantPal = new Uint8Array(fs.readFileSync(path.join(ROOT, "generated", "palette.bin")))
    const wantFont = new Uint8Array(fs.readFileSync(path.join(ROOT, "generated", "font.bin")))
    const gotTiles = vramRead(0x0000, 0, wantTiles.length)
    const gotPal = vramRead(0xfa00, 1, wantPal.length)
    const gotFont = vramRead(0x4000, 0, 4096)
    const cmp = (a: Uint8Array, b: Uint8Array) => {
      let same = 0
      const n = Math.min(a.length, b.length)
      for (let i = 0; i < n; i++) if (a[i] === b[i]) same++
      return `${same}/${n}`
    }
    say(`tiles match ${cmp(gotTiles, wantTiles)}`)
    say(`palette match ${cmp(gotPal, wantPal)}`)
    say(`font[0..4096] match ${cmp(gotFont, wantFont.subarray(0, 4096))}`)
    say(`wantPal[0..16] = ${[...wantPal.subarray(0, 16)].map(v => v.toString(16).padStart(2, "0")).join(" ")}`)
    say(`gotPal[0..16]  = ${[...gotPal.subarray(0, 16)].map(v => v.toString(16).padStart(2, "0")).join(" ")}`)

    writeBmp(path.join(OUT, "diag_all.bmp"), video_get_framebuffer())

    // Layer / sprite isolation.  DC_VIDEO is DC register 0, reached through
    // CTRL.DCSEL = 0 at register 0x09.
    const setVideo = (mask: number) => {
      video_write(0x05, 0x00)
      video_write(0x09, mask)
    }
    for (const [label, mask] of [["l0", 0x11], ["l1", 0x21], ["spr", 0x41], ["off", 0x01]] as [string, number][]) {
      setVideo(mask)
      video_step(1, 20000, false)
      const fb = video_get_framebuffer()
      let lit = 0
      for (let i = 0; i < fb.length; i += 4) if (fb[i] + fb[i + 1] + fb[i + 2] > 24) lit++
      say(`DC_VIDEO=${mask.toString(16)} (${label}) lit=${lit}`)
      writeBmp(path.join(OUT, `diag_${label}.bmp`), fb)
    }
    setVideo(0x71)

    fs.writeFileSync(path.join(OUT, "diag.txt"), log.join("\n"))
    expect(true).toBe(true)
  })

  test("raw 6502 tile-stream write reaches VRAM", () => {
    log = []
    doSetRunMode(RUN_MODE.PAUSED, false)
    doBoot()
    initVera()
    resetVera()
    enableVera(true, 2)

    // LDA #$00 / STA $C205 / STA $C200 / STA $C201 / STA $C202
    // LDX #$00 / loop: TXA / STA $C203 / INX / BNE loop / RTS
    const asm = [
      " ORG $2000",
      " LDA #$00",
      " STA $C205",
      " STA $C200",
      " STA $C201",
      " LDA #$10",
      " STA $C202",
      " LDX #$00",
      "LOOP:",
      " TXA",
      " STA $C203",
      " INX",
      " BNE LOOP",
      " RTS",
    ]
    const bytes = parseAssembly(0x2000, asm, true)
    bytes.forEach((b: number, i: number) => memSet(0x2000 + i, b))
    say(`raw asm = ${bytes.map((b: number) => b.toString(16).padStart(2, "0")).join(" ")}`)
    s6502.StackPtr = 0xfd
    memSet(0x01fe, 0x00)
    memSet(0x01ff, 0x20)
    setPC(0x2000)
    let guard = 4000
    while (guard-- > 0 && s6502.PC >= 0x0300 && s6502.PC < 0x2100) processInstruction()
    say(`raw tile test pc=$${s6502.PC.toString(16)} sp=${s6502.StackPtr.toString(16)}`)

    const got = vramRead(0x0000, 0, 32)
    say(`raw vram[0..32] = ${got.map(v => v.toString(16).padStart(2, "0")).join(" ")}`)
    const got2 = vramRead(0x00f0, 0, 16)
    say(`raw vram[0xf0..0xff] = ${got2.map(v => v.toString(16).padStart(2, "0")).join(" ")}`)

    // Same stream write at the Layer-0 tilemap address ($A000).
    const asm2 = [
      " ORG $2100",
      " LDA #$00",
      " STA $C205",
      " LDA #$00",
      " STA $C200",
      " LDA #$A0",
      " STA $C201",
      " LDA #$10",
      " STA $C202",
      " LDX #$00",
      "LOOP2:",
      " TXA",
      " STA $C203",
      " INX",
      " BNE LOOP2",
      " RTS",
    ]
    const bytes2 = parseAssembly(0x2100, asm2, true)
    bytes2.forEach((b: number, i: number) => memSet(0x2100 + i, b))
    s6502.StackPtr = 0xfd
    memSet(0x01fe, 0x00)
    memSet(0x01ff, 0x21)
    setPC(0x2100)
    let guard2 = 4000
    while (guard2-- > 0 && s6502.PC >= 0x0300 && s6502.PC < 0x2200) processInstruction()
    say(`raw map test pc=$${s6502.PC.toString(16)}`)
    const got3 = vramRead(0xa000, 0, 32)
    say(`raw vram[$a000..] = ${got3.map(v => v.toString(16).padStart(2, "0")).join(" ")}`)
    fs.writeFileSync(path.join(OUT, "diag_raw.txt"), log.join("\n"))
    expect(got[0]).toBe(0x00)
    expect(got[1]).toBe(0x01)
    expect(got[31]).toBe(0x1f)
  })

  test("trace the program's VERA DATA0 stream", () => {
    log = []
    doSetRunMode(RUN_MODE.PAUSED, false)
    doBoot()
    initVera()
    resetVera()
    enableVera(true, 2)
    memSet(0xbf30, 0x70)
    const addr = loadImage("main.bin")
    expect(addr).toBe(LOAD)

    const strides = [0, 0, 1, -1, 2, -2, 4, -4, 8, -8, 16, -16, 32, -32, 64, -64,
      128, -128, 256, -256, 512, -512, 40, -40, 80, -80, 160, -160, 320, -320, 640, -640]
    let cur = 0
    let inc = 0
    const buckets: Map<string, number> = new Map()
    const tail: string[] = []
    const bucketOf = (a: number) =>
      a < 0x4000 ? "tiles" : a < 0x8000 ? "font" : a < 0xa000 ? "gap8" :
      a < 0xa800 ? "map0" : a < 0xb000 ? "map1" : a < 0x10000 ? "gapB" :
      a < 0x1f9c0 ? "gap10" : a < 0x1fa00 ? "psg" : a < 0x1fc00 ? "palette" : "sprites"
    let total = 0
    setSlotIOCallback(2, (a: number, val = -1) => {
      const r = a & 0xff
      if (val >= 0) {
        if (r === 0x00) cur = (cur & 0x1ff00) | val
        else if (r === 0x01) cur = (cur & 0x100ff) | (val << 8)
        else if (r === 0x02) { cur = (cur & 0x0ffff) | ((val & 1) << 16); inc = strides[val >> 3] }
        if (r === 0x03) {
          total++
          const k = bucketOf(cur)
          buckets.set(k, (buckets.get(k) ?? 0) + 1)
          if (tail.length < 4000) tail.push(`${cur.toString(16)}:${val.toString(16)}`)
          cur += inc
        }
        video_write(r, val)
        return 0
      }
      return video_read(r, false)
    })

    s6502.StackPtr = 0x00
    s6502.PStatus = 0x24
    setPC(LOAD)
    const stopped = run(4000000)
    say(`trace stopped=${stopped} data0 writes=${total}`)
    fs.writeFileSync(path.join(OUT, "diag_trace.txt"), tail.join("\n"))

    const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}x${n}`)
    say(`DATA0 buckets: ${sorted.join(" ")}`)
    say(`last 60 DATA0 writes: ${tail.slice(-60).join(" ")}`)
    fs.writeFileSync(path.join(OUT, "diag_trace_summary.txt"), log.join("\n"))
    expect(total).toBeGreaterThan(1000)
  })
})
