// Headless verification harness for the CX16-OTHELLO Apple II / VERA port.
//
// Runs the real compiled image (C:/dev/cx16-othello/vera/build/main.bin) on
// the apple2ts Apple II core with the VERA card in slot 2, services ProDOS MLI
// READ_BLOCK/WRITE_BLOCK out of the shipped .hdv, drives the VERA video core,
// injects keyboard input and writes the 640x480 framebuffer out as BMP so the
// port can be checked pixel-by-pixel without a GUI emulator.
//
// Run from the apple2ts repo:  npx jest othello_headless

import fs from "fs"
import path from "path"
import { enableVera, resetVera, initVera } from "./vera"
import { video_step, video_get_framebuffer } from "./video"
import { memGet, memSet } from "../../memory"
import { doBoot, doSetRunMode } from "../../motherboard"
import { s6502, setPC } from "../../instructions"
import { processInstruction } from "../../cpu6502"
import { sendTextToEmulator } from "../keyboard"
import { setIsTesting } from "../../worker2main"
import { RUN_MODE } from "../../../common/utility"

const ROOT = "C:/dev/cx16-othello-vera/vera"
const OUT = path.join(ROOT, "build", "headless")
const LOAD = 0x1400

const hdv = new Uint8Array(fs.readFileSync(path.join(ROOT, "cx16-othello.hdv")))

let mliCalls = 0
let mliErrors = 0
let mliLog: string[] = []
const mliBlocks = new Set<number>()

const serviceMli = () => {
  const sp = s6502.StackPtr
  // JSR pushes (lastOperandByte) high then low; the top of stack is $0100+SP+1.
  // The MLI opcode byte follows the JSR at ret+1, the 16-bit parameter-pointer
  // address at ret+2..3, and the caller resumes at ret+4.
  const ret = memGet(0x0100 + ((sp + 1) & 0xff), false) | (memGet(0x0100 + ((sp + 2) & 0xff), false) << 8)
  const op = memGet(ret + 1, false)
  const pp = memGet(ret + 2, false) | (memGet(ret + 3, false) << 8)
  let status = 0
  mliCalls++
  if (op === 0x80 || op === 0x81) {
    const buf = memGet(pp + 2, false) | (memGet(pp + 3, false) << 8)
    const blk = memGet(pp + 4, false) | (memGet(pp + 5, false) << 8)
    const src = blk * 512
    mliBlocks.add(blk)
    if (src + 512 > hdv.length) {
      status = 0x27
      mliErrors++
      mliLog.push(`block ${blk} out of range`)
    } else if (op === 0x80) {
      for (let i = 0; i < 512; i++) memSet(buf + i, hdv[src + i])
    } else {
      for (let i = 0; i < 512; i++) hdv[src + i] = memGet(buf + i, false)
    }
    if (mliLog.length < 40) mliLog.push(`op ${op.toString(16)} unit ${memGet(pp + 1, false).toString(16)} blk ${blk} buf $${buf.toString(16)} -> ${status}`)
  } else {
    status = 0x50
    mliErrors++
    mliLog.push(`unsupported MLI op ${op.toString(16)}`)
  }
  memSet(pp + 6, status)
  s6502.Accum = status
  // Pop the JSR return address, skip opcode + parameter pointer, and push the
  // address of the instruction after the MLI call - what ProDOS does.
  s6502.StackPtr = (sp + 2) & 0xff
  s6502.StackPtr = (s6502.StackPtr - 2) & 0xff
  memSet(0x0100 + ((s6502.StackPtr + 1) & 0xff), (ret + 4) & 0xff)
  memSet(0x0100 + ((s6502.StackPtr + 2) & 0xff), ((ret + 4) >> 8) & 0xff)
  setPC(ret + 4)
}

type RunResult = {ran: number, stopped: string, pc: number}

const run = (maxInstructions: number): RunResult => {
  let ran = 0
  while (ran < maxInstructions) {
    const pc = s6502.PC
    if (pc === 0xbf00) {
      serviceMli()
      ran++
      continue
    }
    if (pc < 0x0300) return {ran, stopped: "reset-vector", pc}
    processInstruction()
    ran++
  }
  return {ran, stopped: "budget", pc: s6502.PC}
}

const writeBmp = (file: string, fb: Uint8ClampedArray) => {
  const w = 640
  const h = 480
  const rowBytes = w * 3
  const padded = (rowBytes + 3) & ~3
  const size = 54 + padded * h
  const out = Buffer.alloc(size)
  out.write("BM", 0)
  out.writeUInt32LE(size, 2)
  out.writeUInt32LE(54, 10)
  out.writeUInt32LE(40, 14)
  out.writeInt32LE(w, 18)
  out.writeInt32LE(-h, 22)
  out.writeUInt16LE(1, 26)
  out.writeUInt16LE(24, 28)
  out.writeUInt32LE(padded, 34)
  for (let y = 0; y < h; y++) {
    const src = y * w * 4
    const dst = 54 + y * padded
    for (let x = 0; x < w; x++) {
      out[dst + x * 3] = fb[src + x * 4 + 2]
      out[dst + x * 3 + 1] = fb[src + x * 4 + 1]
      out[dst + x * 3 + 2] = fb[src + x * 4]
    }
  }
  fs.writeFileSync(file, out)
}

// Symbol addresses come from the linker map so the probes never go stale when
// the layout shifts.  Map lines look like:
//       4aaa 4aaa       1     1                 curx
const symAddr = (() => {
  const map = fs.readFileSync(path.join(ROOT, "build", "main.map"), "utf8")
  const table = new Map<string, number>()
  for (const line of map.split("\n")) {
    const m = line.match(/^\s+([0-9a-fA-F]{2,4})\s+([0-9a-fA-F]+)\s+\d+\s+\d+\s+(\w+)\s*$/)
    if (m) table.set(m[3], parseInt(m[1], 16))
  }
  return (name: string) => {
    const a = table.get(name)
    if (a === undefined) throw new Error(`symbol ${name} not in main.map`)
    return a
  }
})()

const stats = (fb: Uint8ClampedArray) => {
  let lit = 0
  const colors = new Map<number, number>()
  for (let i = 0; i < fb.length; i += 4) {
    const r = fb[i]
    const g = fb[i + 1]
    const b = fb[i + 2]
    if (r + g + b > 24) lit++
    const key = (r & 0xf8) << 16 | (g & 0xf8) << 8 | (b & 0xf8)
    colors.set(key, (colors.get(key) ?? 0) + 1)
  }
  const top = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  return {lit, distinct: colors.size, top}
}

const loadImage = (file: string) => {
  const bin = fs.readFileSync(path.join(ROOT, "build", file))
  const addr = bin[0] | (bin[1] << 8)
  for (let i = 0; i < bin.length - 4; i++) memSet(addr + i, bin[4 + i])
  return addr
}

const boot = (file = "main.bin") => {
  doSetRunMode(RUN_MODE.PAUSED, false)
  doBoot()
  initVera()
  resetVera()
  enableVera(true, 2)
  memSet(0xbf30, 0x70) // ProDOS global page: boot unit = slot 7 hard disk
  const addr = loadImage(file)
  expect(addr).toBe(LOAD)
  s6502.StackPtr = 0x00
  s6502.PStatus = 0x24
  setPC(LOAD)
}

describe("CX16-OTHELLO Apple II / VERA port (headless)", () => {
  beforeAll(() => {
    setIsTesting()
    fs.mkdirSync(OUT, {recursive: true})
    if (typeof globalThis.postMessage === "function") {
      jest.spyOn(globalThis, "postMessage").mockImplementation(() => {})
    }
  })

  test("boots to the title screen and renders it through VERA", () => {
    boot()
    // Asset streaming (tiles + font + palette + help) alone is ~600k cycles.
    const r = run(4000000)
    video_step(1, 20000, false)
    const fb = video_get_framebuffer()
    expect(fb.length).toBe(640 * 480 * 4)
    const s = stats(fb)
    writeBmp(path.join(OUT, "01_title.bmp"), fb)
    fs.writeFileSync(path.join(OUT, "01_title.txt"),
      `stopped=${r.stopped} pc=$${r.pc.toString(16)} ran=${r.ran}\n` +
      `mliCalls=${mliCalls} mliErrors=${mliErrors}\n` +
      `lit=${s.lit} distinct=${s.distinct} top=${JSON.stringify(s.top)}\n` +
      mliLog.join("\n"))
    expect(r.stopped).toBe("budget")
    expect(mliErrors).toBe(0)
    expect(mliCalls).toBeGreaterThan(20)
    expect(s.lit).toBeGreaterThan(2000)
    // The 320x240 source is magnified 2:1, so the game must fill the whole
    // 640x480 screen - nothing lit outside, and the far corners in use.
    const a = Buffer.from(fb.buffer, fb.byteOffset, fb.byteLength)
    const litAt = (x: number, y: number) =>
      a[(y * 640 + x) * 4] + a[(y * 640 + x) * 4 + 1] + a[(y * 640 + x) * 4 + 2] > 24
    expect(litAt(0, 0)).toBe(true)
    expect(litAt(639, 0)).toBe(true)
    expect(litAt(0, 479)).toBe(true)
    expect(litAt(639, 479)).toBe(true)
    // Sample the whole screen: every 16x16 block must contain lit pixels.
    let blankBlocks = 0
    for (let y = 0; y < 480; y += 16) {
      for (let x = 0; x < 640; x += 16) {
        let lit = false
        for (let dy = 0; dy < 16 && !lit; dy += 4) {
          for (let dx = 0; dx < 16 && !lit; dx += 4) {
            if (litAt(x + dx, y + dy)) lit = true
          }
        }
        if (!lit) blankBlocks++
      }
    }
    fs.appendFileSync(path.join(OUT, "01_title.txt"),
      `blank 16x16 blocks=${blankBlocks} of 1200\n`, "utf8")
    expect(blankBlocks).toBe(0)
  })

  test("starts a 8x8 computer vs computer game and renders the board", () => {
    boot()
    run(2000000)
    // Title screen: RETURN starts a game.
    sendTextToEmulator(0x0d) // RETURN -> start
    run(2000000)
    video_step(1, 20000, false)
    const fb = video_get_framebuffer()
    const s = stats(fb)
    writeBmp(path.join(OUT, "02_board.bmp"), fb)
    expect(s.lit).toBeGreaterThan(2000)
  })

  test("drives the settings menu and plays a full CPU vs CPU 10x10 game", () => {
    boot()
    const rd = (a: number) => memGet(a, false)
    const snap = () => ({
      gamestate: rd(symAddr("gamestate")), p1: rd(symAddr("player1_type")),
      p2: rd(symAddr("player2_type")), size: rd(symAddr("boardsize")),
      boardType: rd(symAddr("board_type")), c1: rd(symAddr("stone_color1")),
      c2: rd(symAddr("stone_color2")), music: rd(symAddr("music")),
      scroll: rd(symAddr("background_scroll")), player: rd(symAddr("current_player")),
      helppage: rd(symAddr("helppage")),
    })
    const stones = () => {
      const base = symAddr("board")
      let p1 = 0, p2 = 0
      for (let i = 0; i < 100; i++) {
        const v = rd(base + i)
        if (v === 1) p1++
        else if (v === 2) p2++
      }
      return {p1, p2}
    }
    // apple2ts only strobes a buffered key when the Apple has cleared the
    // keyboard latch, so a single send can be swallowed.  Run long enough for
    // the key to land, then cycle the setting until it reaches the target.
    const pressTo = (code: number, getter: () => number, target: number, tries = 8) => {
      for (let i = 0; i < tries; i++) {
        if (getter() === target) return true
        sendTextToEmulator(code)
        run(20000)
      }
      return getter() === target
    }
    const press = (code: number, ok: () => boolean, tries = 8) => {
      for (let i = 0; i < tries; i++) {
        sendTextToEmulator(code)
        run(20000)
        if (ok()) return true
      }
      return false
    }

    const report: string[] = []
    run(2000000)
    report.push(`title  ${JSON.stringify(snap())}`)

    press(0x53, () => snap().gamestate === 3, 12) // 'S' -> settings
    report.push(`settings ${JSON.stringify(snap())}`)
    pressTo(0x31, () => snap().p1, 1)             // '1' player1 -> CPU
    pressTo(0x53, () => snap().size, 10)          // 'S' size -> 10
    pressTo(0x42, () => snap().boardType, 0x20)   // 'B' board -> wood
    pressTo(0x43, () => snap().c1, 7)             // 'C' stone colour 1
    pressTo(0x56, () => snap().c2, 8)             // 'V' stone colour 2
    report.push(`configured ${JSON.stringify(snap())}`)
    const cfg = snap()
    fs.writeFileSync(path.join(OUT, "play.txt"), report.join("\n"))
    expect(cfg.p1).toBe(1)
    expect(cfg.p2).toBe(1)
    expect(cfg.size).toBe(10)
    expect(cfg.boardType).toBe(0x20)
    expect(cfg.c1).toBe(7)
    expect(cfg.c2).toBe(8)

    press(0x1b, () => snap().gamestate === 2, 12) // ESCAPE -> title (GAME_MENU=2)
    report.push(`back   ${JSON.stringify(snap())}`)
    fs.writeFileSync(path.join(OUT, "play.txt"), report.join("\n"))
    expect(snap().gamestate).toBe(2)

    video_step(1, 20000, false)
    writeBmp(path.join(OUT, "03_settings.bmp"), video_get_framebuffer())

    press(0x0d, () => snap().gamestate === 1, 12) // RETURN -> start game
    report.push(`game start ${JSON.stringify(snap())} stones=${JSON.stringify(stones())}`)
    expect(snap().gamestate).toBe(1)

    let samples = 0
    let ended = false
    for (let i = 0; i < 160 && !ended; i++) {
      run(250000)
      video_step(1, 20000, false)
      const st = snap()
      const s = stones()
      if (i % 6 === 0) {
        samples++
        report.push(`frame ${i}: state=${st.gamestate} player=${st.player} p1=${s.p1} p2=${s.p2}`)
        writeBmp(path.join(OUT, `04_game_${String(i).padStart(2, "0")}.bmp`), video_get_framebuffer())
      }
      if (st.gamestate !== 1) ended = true
    }
    const final = stones()
    report.push(`final state=${snap().gamestate} p1=${final.p1} p2=${final.p2} mli=${mliCalls} err=${mliErrors}`)
    video_step(1, 20000, false)
    writeBmp(path.join(OUT, "05_game_end.bmp"), video_get_framebuffer())
    fs.writeFileSync(path.join(OUT, "play.txt"), report.join("\n"))

    // A 10x10 board must fill up: 100 cells, both colours present.
    expect(final.p1 + final.p2).toBeGreaterThan(4)
    expect(ended).toBe(true)
    expect(mliErrors).toBe(0)
    // Asset stream lives at block 900+, the music stream at block 1000+.
    const blocks = [...mliBlocks]
    report.push(`blocks read: n=${blocks.length} min=${Math.min(...blocks)} max=${Math.max(...blocks)}`)
    fs.writeFileSync(path.join(OUT, "play.txt"), report.join("\n"))
    expect(blocks.some(b => b >= 1000)).toBe(true)
    expect(blocks.some(b => b >= 900 && b < 1000)).toBe(true)
  })

  test("arrow keys move the cursor in the expected screen direction", () => {
    boot()
    run(2000000)
    const cur = () => ({
      x: (memGet(symAddr("curx"), false) ^ 0x80) - 0x80,
      y: (memGet(symAddr("cury"), false) ^ 0x80) - 0x80,
      state: memGet(symAddr("gamestate"), false),
      player: memGet(symAddr("current_player"), false),
    })
    // Ground truth for what the player sees: the cursor sprite's pixel box.
    const cursorSprite = () => {
      const base = 0x1fc00 + 101 * 8
      const rdv = (n: number) => {
        memSet(0xc205, 0x00)
        memSet(0xc200, base + n & 0xff)
        memSet(0xc201, (base + n >> 8) & 0xff)
        memSet(0xc202, 0x11)
        return memGet(0xc203, false)
      }
      const x = rdv(2) | (rdv(3) & 3) << 8
      const y = rdv(4) | (rdv(5) & 3) << 8
      return {x, y}
    }
    const report: string[] = []
    // Default setup is player 1 = HUMAN, so RETURN puts a human on the board.
    for (let i = 0; i < 12 && cur().state !== 1; i++) {
      sendTextToEmulator(0x0d)
      run(20000)
    }
    report.push(`start ${JSON.stringify(cur())}`)
    // Prime once: the game only syncs curx/cury through set_cursor() on the
    // first real turn, so the globals are stale until then.
    sendTextToEmulator(0x08)
    run(200000)
    report.push(`primed ${JSON.stringify(cur())} sprite=${JSON.stringify(cursorSprite())}`)
    // [name, key code, grid delta (dx,dy)]; the cursor sprite moves in 16-px
    // steps, so the same delta is checked at 16x scale on the sprite box.
    const seq: Array<[string, number, number, number]> = [
      ["left(0x08)", 0x08, -1, 0],
      ["right(0x15)", 0x15, 1, 0],
      ["up(0x0B)", 0x0b, 0, -1],
      ["down(0x0A)", 0x0a, 0, 1],
    ]
    const moves: boolean[] = []
    for (const [name, code, dx, dy] of seq) {
      const before = cur()
      const beforeSpr = cursorSprite()
      sendTextToEmulator(code)
      run(200000)
      const after = cur()
      const afterSpr = cursorSprite()
      const good = after.x === before.x + dx && after.y === before.y + dy &&
        afterSpr.x === beforeSpr.x + dx * 16 && afterSpr.y === beforeSpr.y + dy * 16
      moves.push(good)
      report.push(`${name}: cur (${before.x},${before.y}) -> (${after.x},${after.y})` +
        ` sprite px (${beforeSpr.x},${beforeSpr.y}) -> (${afterSpr.x},${afterSpr.y})` +
        ` state=${after.state} player=${after.player} ${good ? "OK" : "WRONG"}`)
      // If the key placed a stone the turn flips; restart the game for the next probe.
      if (after.state !== 1) {
        for (let i = 0; i < 12 && cur().state !== 1; i++) {
          sendTextToEmulator(0x0d)
          run(20000)
        }
      }
    }
    fs.writeFileSync(path.join(OUT, "cursor.txt"), report.join("\n"))
    expect(moves).toEqual([true, true, true, true])
  })

  // The help page is 12 fixed-width 20-character rows packed into a 240-byte
  // block with no NUL between rows.  An unbounded strlen() write runs off the
  // end of each row, wraps at the 32-tile map stride and lands on the rows
  // below - which is where the (N) NEXT / (ESC) BACK lines live.  Decode the
  // rendered glyphs and assert every row is exactly what the asset says.
  test("help screen text stays inside its 20-column rows", () => {
    boot()
    const rd = (a: number) => memGet(a, false)
    const press = (code: number, ok: () => boolean, tries = 12) => {
      for (let i = 0; i < tries; i++) {
        sendTextToEmulator(code)
        run(20000)
        if (ok()) return true
      }
      return false
    }
    const font = fs.readFileSync(path.join(ROOT, "generated", "font.bin"))
    const help = fs.readFileSync(path.join(ROOT, "generated", "help.bin"))
    // 96 font tiles (16x16, 8bpp) for ASCII 0x20..0x7F.
    const tiles: Uint8Array[] = []
    for (let i = 0; i < 96; i++) {
      const t = new Uint8Array(256)
      for (let k = 0; k < 256; k++) t[k] = font[i * 256 + k] > 0 ? 1 : 0
      tiles.push(t)
    }
    run(2000000)
    expect(press(0x48, () => rd(symAddr("helppage")) >= 0 &&
      memGet(symAddr("gamestate"), false) === 4)).toBe(true)
    run(200000)
    video_step(1, 20000, false)
    const fb = video_get_framebuffer()
    writeBmp(path.join(OUT, "05_help.bmp"), fb)

    // Each glyph is 16x16 source pixels, magnified 2:1 -> 32x32 on the frame.
    const isText = (x: number, y: number) =>
      fb[(y * 640 + x) * 4] === 34 && fb[(y * 640 + x) * 4 + 1] === 17 &&
      fb[(y * 640 + x) * 4 + 2] === 0
    const decode = (tr: number, tc: number) => {
      const g = new Uint8Array(256)
      let any = false
      for (let r = 0; r < 16; r++) {
        for (let c = 0; c < 16; c++) {
          const v = isText(tc * 32 + c * 2, tr * 32 + r * 2) ? 1 : 0
          g[r * 16 + c] = v
          any = any || v === 1
        }
      }
      if (!any) return " "
      let best = 0, bestD = 1 << 30
      for (let i = 0; i < 96; i++) {
        let d = 0
        for (let k = 0; k < 256; k++) if (tiles[i][k] !== g[k]) d++
        if (d < bestD) { bestD = d; best = i }
      }
      return String.fromCharCode(0x20 + best)
    }
    const rows: string[] = []
    for (let tr = 0; tr < 15; tr++) {
      let s = ""
      for (let tc = 0; tc < 20; tc++) s += decode(tr, tc)
      rows.push(s)
    }
    fs.writeFileSync(path.join(OUT, "05_help.txt"),
      rows.map((r, i) => `row ${String(i).padStart(2, "0")} |${r}|`).join("\n"))

    // load_help_page() writes asset row 0..10 onto screen rows 1..11.
    const want: string[] = []
    for (let y = 0; y < 11; y++) {
      want.push(help.subarray(y * 20, y * 20 + 20).toString("latin1"))
    }
    const mismatches: string[] = []
    for (let y = 1; y < 12; y++) {
      const got = rows[y].padEnd(20, " ")
      const exp = want[y - 1].padEnd(20, " ")
      if (got !== exp) mismatches.push(`row ${y}: got |${got}| want |${exp}|`)
    }
    fs.appendFileSync(path.join(OUT, "05_help.txt"),
      "\n" + (mismatches.length ? mismatches.join("\n") : "help rows match asset"))

    // The menu lines must survive on their own rows.
    expect(rows[13].startsWith("(N) NEXT (P) PREV")).toBe(true)
    expect(rows[14].startsWith("(ESC) BACK  PAGE:")).toBe(true)
    expect(rows[14].endsWith("1/6")).toBe(true)
    expect(mismatches.length).toBe(0)
  })
})
