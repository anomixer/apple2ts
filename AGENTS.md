# Apple IIgs Emulation Notes (apple2ts, branch `test/gs`)

Working notes for the 65816 / IIgs support. This used to be a 4000-line
chronological log; it is now a reference organised by subsystem: the hardware
facts we model, the traps that cost real time, and what is still open. History
lives in git.

---

## 0. Ground rules

**Reference implementations**

| path | use it for |
|---|---|
| `c:\dev\gssquared` | **gold standard.** `src/cpus/*`, `src/mmus/mmu_iigs.hpp`, `src/mmus/mmu_iie.cpp`, `src/devices/iwm/IWM2.hpp`, `src/devices/rtc/RTC_PRAM.hpp`, `src/devices/es5503/ensoniq.cpp`, `src/devices/adb/{ADB_Micro,ADB_Mouse,ADB_Keyboard}.hpp`, `src/display/display.cpp`, `src/display/VideoScannerIIgs.cpp`, `Docs/DevelopLog.md` |
| `c:\dev\kegs` | second opinion, plain C: `adb.c`, `doc.c`. Kenton's comments explain intent |
| `c:\dev\gsplus` | third opinion |

`web-a2e` is **not** authoritative — its cold-reset states, IWM softswitches and
status flags are incomplete, and copying them produced the `System Bad: GGGG0000`
loop. Never "improve" a gssquared behaviour by inventing something; port it.

**Machine facts that make sense of everything else**

- 65816 runs at **2.8 MHz in both modes**. `$C036` bit 7 = fast (1) / slow
  (1.024 MHz). There is no native-mode speed factor (one was added and removed:
  commit `76d9f58b`). Native code is simply faster because it does more per cycle.
- One video refresh is always 1/60 s. Speed mode changes how many CPU cycles fit
  into it; `$C036` changes what a cycle is worth. Both are handled by the video
  clock (§8), never by changing the frame length mid-flight.
- Banks `$00-$DF` are RAM, `$D0-$FF` is ROM. `$E0/$E1` are Mega II main/aux.

**Workflow constraints (learned the hard way)**

- **Never copy a disk image into `public/disks`.** Vite's watcher dies with
  `EBUSY` on a 32 MB file and kills the dev server; the browser then shows
  `ERR_CONNECTION_REFUSED`, which reads as "the emulator has no display".
  Serve images from `C:\Users\USER\AppData\Local\Temp\opencode\diskserver.cjs`
  (port 6503, `Access-Control-Allow-Origin: *`) and deep-link them:
  `http://localhost:6502/?machine=apple2gs&boot=true&drive=0#http://localhost:6503/GSOS601.po`
- Check the page before blaming the emulator: zero canvases = page never loaded;
  a canvas of the right size with `lit = 0` = emulator problem.
- Debug hooks are **request/response**, never sticky worker flags: a worker
  module can be re-evaluated under a live page (Vite HMR, machine switch) and
  silently lose module state.
- Headless-Chrome claims must be about observed data, and an ear test beats any
  offline analysis of buffer contents (a UI-gain or render-side fault is
  invisible in the PCM we hand to the audio graph).

---

## 1. CPU (65816)

- **Cycle accounting**: every bus access costs 1 cycle (`read8`/`write8`),
  `phantomRead()` charges a dummy read without touching the bus,
  `ADDR_CYCLES_816` holds the internal cycles per addressing mode (read / write /
  RMW), plus per-instruction extras (implied +1, shifts +1, pushes +1, pulls +2,
  taken branch +1 (+1 on page cross), JSR +1, JSL +1, RTS +3, RTI +2, RTL +2,
  BRK/COP +1, PER +1, MVN/MVP +2 first pass / +1 after). `processInstruction()`
  returns the accumulator and the run loop does `s6502.cycleCount += cycles`.
  `src/worker/gs_cycles.test.ts` pins published WDC counts (128 cases) and
  asserts emulation-mode instr/cycle parity with the IIe (~0.36-0.38).
- **`$AA` = TAX, `$8A` = TXA, `$CA` = DEX in every mode.** gssquared does the
  same in all five cores (`opcodes.hpp:271/281/142`). Do not "fix" this to PLY /
  BRK / PHY — that breaks the GS/OS boot, and gssquared is the reference.
- **8-bit mode: the high byte of A is the B register.** It must survive 8-bit
  ops untouched (`AND #$7F`, `ASL A`, ...). Seeing `A=$84FF` with M=1 is normal.
- **Overflow flag** must be computed bitwise:
  `(~(a ^ b) & (a ^ r) & 0x80) !== 0` (and `0x8000` for 16-bit). The obvious
  `!((a^b)&0x80) && ((a^r)&0x80) !== 0` is a JS type bug: `&&` returns `false`
  whenever the first term fails, and `false !== 0` is `true`, so V was set
  exactly when overflow is impossible. Six sites (8/16-bit ADC, 8/16-bit SBC,
  and both decimal-mode ADCs) shared it; the ROM's cursor reconcile trusts V
  absolutely, which is why mouse motion pinned to the screen edge.
- **Stack**: native instructions (JSL, RTL, PHD, PLD, PHB, PLB, PHK, PEA, PEI,
  PER) use `push8Wide`/`push16Wide`/... and `normaliseStack()` **after** the
  whole instruction. The plain helpers wrap to page 1 per byte and corrupt the
  high byte of JSL return addresses.
- **Interrupts**: the IIgs IRQ line is **level triggered** on `$C046` bit 7 and
  must be re-evaluated **every instruction**, not only inside the VBL window.
  Sampling only during VBL left `cpu.irqPending` asserted across the long
  non-VBL part of each frame and produced a spurious IRQ into `$C074` the next
  time the guest cleared I.
- **Run housekeeping runs every instruction.** An 8-instruction batch (11 % of
  V8 profile) deferred VBL/IRQ/motor/DOC catch-up/mouse stepper and starved the
  SmartPort reads during a ProDOS 8 boot (`INSERT SYSTEM DISK -ERR 01`), only
  in the real-time browser loop.
- **Peripheral hooks**: `specialJumpTable[$C7C0]` / `[$C7C3]` are checked before
  the opcode fetch in bank 00, syncing A/X/Y/S/P with `s6502`.

---

## 2. Memory map / MMU

- `$FE`/`$FF` → the 128 KB system ROM (image offset 0 = `$FE`, `0x10000` = `$FF`).
- Banks `$00`, `$E0`, `$E1` see the fast ROM through the language-card window
  for `$D000-$FFFF` while `BSRREADRAM` is clear, and slot space `$C100-$CFFF`
  via `memGet`. `$C071-$C07F` is **BRK/IRQ firmware code** (the vectors point
  there), always read from bank `$FF` ROM, never from RAM.
- `$C100-$C7FF` must call `manageC800(slot)`: accessing slot 3 with `SLOTC3ROM`
  clear asserts `INTC8ROM` (80-column firmware owns `$C800-$CFFF`); `$CFFF`
  clears it. Skipping this sent A2DeskTop's `$C366 → $C803` into the Slot 7 card
  and popped the stack.
- `$E0` = `megaIIMain`, `$E1` = `megaIIAux`. Both are separate 64 KB arrays,
  **filled with `0x00` at power-on** (`0xFF` made the ROM take the
  `LDA $E115FE / BMI` error path straight into uninitialised RAM).
- `$01` = fast RAM at `memory[RamWorksMemoryStart + off]`. **Language-card RAM is
  never shadowed between bank 01 and bank `$E1`.** A stray `megaIIAux[off] = data`
  in the bank-01 LC write path corrupted the GS/OS volume prefix and produced
  `Fatal system error 0308`.
- **IOLC shadow inhibit**: `$C035` bit 6 (`SHADOW_INH_IOLC`) set means banks
  `$00`/`$01` **stop** shadowing I/O and the language-card ROM across
  `$C000-$CFFF`; those addresses become plain fast RAM (bank `$00` main or aux by
  ALTZP, bank `$01` always aux). gssquared models this as
  `is_iolc_shadowed() == !(reg_shadow & SHADOW_INH_IOLC)` plus
  `bank_shadow_read/write`, and `shadow_is_enabled()` never shadows `$C0xx`.
  Ignoring it corrupts anything that relocates code through bank 1 `$C000` —
  MCS's music driver did and ran off into `$00:E03B` (§11.1). `isIigsIolcShadowed()`
  gates both `memGet24` and `memSet24`, but only for `$C000-$CFFF`; the
  `$D000-$FFFF` language-card half still follows the `BSRREADRAM` rules on the
  assumption that nobody sets the inhibit expecting RAM there.
- **Bank-$00 shadow target follows the *effective* bank** (`iigsEffectiveAuxWrite` +
  `shadowIigsWrite`, from gssquared `calc_aux_write` / `shadow_is_enabled`). The
  video scanner reads Mega II main/aux, not fast RAM, so every bank-$00 store has
  to be mirrored into the same bank the IIe switch table picked: 80STORE+PAGE2
  for text pages `$04-$07` and hires `$20-$3F`, ALTZP for pages `$00-$01` and
  `$C0-$FF`, RAMWRT above that. Mirroring everything into Mega II **main** and
  skipping `$6000-$9FFF` entirely left RAMWRT SHR blits invisible: the SilkyGS
  ports (Super Mario Bros) draw with DB=$00 while RAMWRT is set, so the screen
  stayed a uniform palette-0 blue although the game was blitting every frame
  (§11.7). `$2000-$5FFF` needs either the SHR or the AUXHGR inhibit clear,
  `$6000-$9FFF` is SHR only.
- **Floating bus**: `memory.ts` keeps a byte (power-on `$EE`) refreshed from the
  video scanner. An empty slot's `$C0xx` read returns it. Returning
  `Math.random()` made every run of MCS differ (76 reads, the first at `$C300`,
  the 80-column firmware entry, which software branches on). The Apple IIe
  `$C070-$C07F` paddle noise and `rand() <= 0xB4` are deliberate and tested
  (Castle Wolfenstein) — leave them.
- **Aux linearization (SHR / `$C029` bit 6)**: `phys = $2000 + ((x & 1) << 14) | (x >> 1)`
  for the `$2000-$9FFF` window; `is_aux_linear()` is `auxLinear || shrEnabled`,
  matching gssquared. Applied to bank `$E1` reads/writes, the bank `$01` shadow
  that feeds it, and inverted in `getShr()`.
- **Trap**: `vidhd.extractShrBuffer(memory, auxStart)` **adds `$2000` itself**.
  Passing the SHR window start doubled the offset and `slice()` clamped the
  result, so `processSuperHiRes()` returned `false` on every frame and the SHR
  screen was never drawn at all (the boot text still looked fine). Pass `0` and
  size the buffer `0xA000`. Whenever a fixed-size buffer comes back short,
  suspect a clamped `slice`.

---

## 3. Soft switches and registers

| addr | behaviour |
|---|---|
| `$C000/$C010` | legacy keyboard data / any-key-down. Real hardware clears bit 7 of `$C000` on **any** `$C010` access. |
| `$C02D` | `SLTROMSEL`, default `0b11110110` (slots 7,6,5,4,2,1 = card). Must track the configured cards. |
| `$C02E/$C02F` | video counter. `$C02E = (vcounter >> 1) & 0xFF` (`$80-$DF` visible, `$E0-$FF` VBL, `$E8` = scanline 240); `$C02F = ((vcounter & 1) << 7) \| hcounter`, `hcounter` runs `$00` then `$40-$7F`. Tass Times spins at `$2F90` until `$C02E == $E8`. |
| `$C029` | bit 7 SHR, bit 6 aux linearize, bit 5 mono |
| `$C030` | speaker. The cone toggles on **reads as well as writes** (Applesoft `BELL` is `LDA $C030`); both paths must call `checkSoftSwitches`. |
| `$C031` | disk control: bit 6 `EN35` selects the 3.5"/5.25" family, bit 7 `HDSEL` |
| `$C033/$C034` | RTC data/control (see below) |
| `$C035` | `STAT` shadowing: bit 0 = text page 1, bit 5 = text page 2 (clear = shadowed into Mega II main), bit 6 = `SHADOW_INH_IOLC` (see §2) |
| `$C036` | bit 7 = CPU clock: 1 = 2.8 MHz, 0 = 1.024 MHz |
| `$C03C-$C03F` | Ensoniq DOC (§5) |
| `$C046` | `INTFLAG`: bit 7 = a source is pending AND enabled. **Cold boot must read 0**, or the ROM runs its diagnostic self-test and prints `System Bad: GGGG0000`. |
| `$C047` | interrupt acknowledge |
| `$C054/$C055` | 80-column page 1/2 firmware. On ROM 01 `FF:C054-C056` is a firmware epilogue and `$E1:00FF` is the ROM's **interrupt-nesting counter**, not a page register. |
| `$C068` | `STATE` register, read/write: ALTZP, PAGE2, RAMRD, RAMWRT, RDROM (`!BSRREADRAM`), BSRBANK2, INTCXROM. Must call `updateAddressTables()`. |
| `$C0E0-$C0EF` | IWM (§7) |
| `$C100-$CFFF` | slot space; see `manageC800` above |

`$C050-$C05D` deliberately keep the **generic** softswitch path. Replacing them
with gssquared's explicit status bits changed GS/OS's rendered palette (6
colours instead of >8) and broke six suites; returning floating bus for
`$C050-$C05F` and 0 for `$C000` were tried and reverted too.

**RTC / battery RAM** (`src/worker/iigs_clock.ts`, ported from
`RTC_PRAM.hpp`): two-byte command framing for 256 bytes of BRAM, a real seconds
counter from Unix epoch, and the warm-reset signature
`CB D2 C7 C2 10 A2 E8 03` seeded at BRAM `$B0-$B7`. `reset(coldBoot)` must clear
the transaction state, or a reboot mid-transaction fails BRAM framing and the
ROM takes the fatal-error path.

**Interrupt dispatchers** installed by `iigsInitInterrupts()`: the ROM overwrites
them with its own (`$E1:0010 = JML $FFB7CC`, the full manager), so the
hand-written minimal manager is dead code — harmless, do not build on it.
`$E1:0034 = JML $FEC5C8` **is** needed (the ROM never writes it); it is the ADB
mouse dispatch that publishes the event record.

---

## 4. Video

- Super Hi-Res source is 640x200 (or 320x200); output is **640x400**, each of the
  200 scanlines emitted twice, aspect 1.6. 320 mode also doubles X. Legacy Apple
  II output stays 560x384 / 1.458. Rendering is destination-driven, so games and
  the desktop fill the same space and the window never resizes.
- `getShr()` reads Mega II aux through the interleaved window; see §2.
- **Scanline interrupt**: while exporting a visible line, if
  `memGet24(0xE19D00 + line) & 0x40` (SCB bit 6) call `iigsSignalScanline()`
  (gssquared `VideoScannerIIgs.cpp`). Without it GS/OS's Event Manager never
  erases/redraws its arrow and the factory cursor sits in the top-left corner
  forever. **The emulator no longer draws a cursor overlay** — the guest does
  (`drawIigsCursor`, `setHostCursorNorm`, `cursorX/Y` in `MachineState` are all
  deleted; do not bring them back).
- **Text page source**: the scanner reads **Mega II main/aux RAM**, not fast RAM,
  when `$C035` says the page is shadowed (`iigsTextMainSource` /
  `iigsTextAuxSource`). ProDOS 16 systems (`$E0:$0400` / `$E1:$0400`) render
  black without this.
- MouseText decoding must be enabled for `APPLE2GS` as well as `APPLE2EE`
  (`graphics.ts`, `copycanvas.ts`), or the startup bar shows `@ A L` instead of
  the Apple glyphs and lines.
- Known rendering defects still open: see §11.

---

## 5. Audio — Ensoniq ES5503 (DOC)

Registers (`src/worker/devices/iigs_ensoniq.ts`), from the Apple IIgs Hardware
Reference (the DOC has no public datasheet):

```
$E0  Oscillator Interrupt Register  bit7 IRQ, bits5-1 oscillator
$E1  Oscillator Enable   osce = ((v >> 1) & 0x1f) + 1, reset count 1, reset value 2
$E2  A/D
$00+n/$20+n  frequency (16-bit)      $40+n  volume (0-255)
$60+n  data (last byte read)         $80+n  wavetable pointer (page aligned)
$A0+n  control: 7-4 channel, 3 IRQ enable, 2-1 mode (00 free-run, 01 one-shot,
       10 sync, 11 swap), 0 halt
$C0+n  size: bits 5-3 (256B..32KB), bits 2-0 address resolution
SR = 894886 / (osce + 2)              DOC RAM: 64 KB, zero-filled at power-on
```

Rules that are easy to get wrong:

- `$C03D` is a **pipeline**: return the previously latched value and fetch the
  byte at the current address. `$E0` is fetched once per transaction (the ROM's
  IRQ dispatcher reads `$C03D` twice; without this it acknowledges two
  oscillators for one interrupt).
- A `$C03C` write with bit 6 clear must **clear `soundadrh`**.
- **`$E0` must return the oscillator it just acknowledged**: `retval = i << 1;
  rege0 = retval | 0x80; return retval | 0x41`. Returning the previous latch made
  every read look like "no interrupt", the ROM manager entered 35 times and
  dispatched to nothing, and Tass Times' `WAI` sound driver never woke.
- **Never gate sample generation on `vol > 0`.** The Apple TN #23 timer trick is
  a zero-volume oscillator with a frequency and the halt bit clear; it is what
  wakes the driver. Gate on `!(control & 1) && freq > 0`.
- Halt/wrap semantics (`haltOsc`, ported from `ensoniq.cpp`): free-run stops at
  the end of the wave **or at a zero byte**; sync/AM loops and retriggers the odd
  partner; swap starts the partner (`control &= ~1`, `acc = 0`); free-run wrap
  subtracts `(wtsize - 1) << resshift` to keep fractional phase; in every case
  `if (control & 0x08) irqpend = 1`. A CPU-written halt with bit 3 clear does
  not IRQ.
- **Wave data is signed int8**: `d = (byte ^ 0x80)`, sign-extended; mix is
  `trunc(sum / 8)`. gssquared does exactly this (`ensoniq.cpp:181,194`), and the
  unsigned version's DC rail made the old build *look* 1.7x bassier and ~3.7 dB
  louder while adding clipping harmonics. The `$C03C` low nibble (analog volume)
  is **not** applied to the DOC stream in gssquared (its slew is behind `#if 0`,
  `apply_volume=false`); keep it for diagnostics only.
- **Mono mirror**: if every non-halted enabled oscillator shares the same CA0,
  copy that channel to both L and R (`ensoniq_mirror_mono_to_stereo`).
- **Sampling is interleaved, not per frame**: `ensoniqCatchUp` in the run loop
  generates the samples due for the current cycle position into a scratch buffer;
  the buffer is posted once per refresh. Generating one block per frame capped
  the timer oscillator's halt rate at 60/s and played Tass Times' title at
  **exactly half tempo** with correct pitch — a bug an FFT cannot see.
- **The per-refresh budget *is* the tempo.** `ensoniqSamplesPerRefresh =
  outputRate/60` (439 at `osce=32`); generating more than that per refresh clocks
  the whole march fast, so both the TN #23 timer tick and streamed samples speed
  up together. The 667/refresh overshoot was the module-state lookahead bug; the
  333/refresh shortfall was the active-oscillator gate. Both are fixed (see §11.2).
- UI transport: `iigs_ensoniq_audio.ts` queues blocks with
  `nextTime += frames / rate`, and the gain is **1.0** (unity, as gssquared's
  `apply_volume=false` stream). Open: `$00-$FF` of DOC RAM must be non-zero
  before the Note Synthesizer path is used (TN #23).

---

## 6. Input

### Keyboard

The IIgs's keyboard is ADB device 2 **and** drives the legacy `$C000`/`$C010`
register in parallel (both pipelines get every key). `setKeyboardState()` must
therefore queue the ADB event **and fall through** to `setKeyStrobe`; the early
return that shipped with ADB delivery left ProDOS-8-era software (Tass Times)
with no keys at all. ADB event bytes: keycode on down, `code | 0x80` on **up**
(the opposite of the IIe convention); host auto-repeat is not re-queued.

`handleKeyMapping()` is the identity unless a game matches, so `"\n"` arrives as
10, not RETURN — the Apple II RETURN is `0x0D`.

### ADB micro-controller (`src/worker/iigs_adb.ts`)

Commands to `$C026` are the **ADB micro** command set, classified by bits 7-6:
`00xxxxxx` micro commands (abort/reset/flush/modes/config/micro memory/replies),
`01xxxxxx` FDB housekeeping, `10xxxxxx` transmit 2 bytes (FDB *listen*),
`11xxxxxx` poll FDB (FDB *talk*). Two framing rules that hang GS/OS if wrong:

1. **Controller replies carry no header** — payload starts with the count.
2. **FDB poll replies do** — bit 7 present, bit 6 micro reset, bits 2-0 = count-1.

Also: the argument counter is `cmd.length - 1 === argumentsExpected` (seeding it
with 1 executed 2-argument commands after one argument and parsed the second as
a new command).

Device model: register 3 is the status word `[event, addr | handler | SRQ]`
(init `[0, addr | 0x20]`); mouse register 0 holds the motion report; the keyboard
latch starts at `$FF,$FF` (zeros read as a keypress). Commands `$04`/`$05`
(modes) and `$06` (config, bytes = `mouse_ctl << 4 | kbd_ctl`) change whether
motion is reported at all — KEGS drops `$C024` and the mouse IRQ when
`modes & 0x02` or the device/controller addresses disagree.

**Mouse report layout** (gssquared `ADB_Mouse.hpp`, KEGS `adb.c:1557`):

```
register 0 byte 0:  bit7 = RIGHT button (1 = up) | bit6 = moved right | bits5-0 = X
register 0 byte 1:  bit7 = LEFT  button (1 = up) | bit6 = moved up    | bits5-0 = Y
```

- Magnitude is a **7-bit two's complement** field: `(dx & 0x3f) | (dx < 0 ? 0x40 : 0)`,
  **not** `abs(dx) & 0x3f`. Encoding the absolute value delivered a leftward move
  of `-m` as `m - 64` (only `-32` was correct).
- **Both buttons in the same byte is the bug**: writing one button bit into both
  bytes made one physical click look like two transitions, so GS/OS read a single
  click as a double click (icons opened) and the ROM's post loop ran twice. The
  CPU-level PostEvent dedup that used to paper over this is **removed** — do not
  restore it. `updateButtonDown()` sets bit 7 of each byte only and leaves the
  motion bits alone; `setMouseButton(0|1, pressed)` sets one latch and
  `patchReportButton()` folds the live state into an unread report.
- Y must be captured **before** `consumeReport()` overwrites the register.
  `hasMouseData()` must include an unread report, and `consumeReport()` re-latches
  any leftover motion, so the IRQ deasserts and re-asserts per chunk instead of
  latching forever (one latched IRQ starved the Finder).
- **Closed-loop cursor sync** (`devices/mouse.ts`): the host pointer sets a target
  (`round(normX * 639)`, `round(normY * 399) >> 1`, halved again in 320-mode SHR);
  `iigsMouseStep()` (once per frame) reads the guest cursor from the holes and
  injects a ≤ ±63 chunk toward it, waiting for the guest to consume each step.
  Measured convergence is within one count on both axes, edges included.
- **The loop needs live feedback, not just an Event Manager** (freegemas): the
  Tool Locator says GS/OS is up, but a program can keep its own cursor and read
  the ADB bytes itself. freegemas reads `$C024` twice per frame from bank `$09`
  and accumulates the deltas; the holes stay `(0,0)` forever. Steering against
  that origin applies real motion toward a phantom target, so the game's pointer
  raced into the bottom-right corner and looked dead. `iigsClosedLoopActive()`
  therefore also requires a published position now, and a report the guest
  consumed without the position following marks the feedback stale
  (`adbFeedbackStale`) and falls back to dead reckoning; a position that moves
  while we are not steering re-arms it. Games driven this way track movement
  with an arbitrary constant offset (the first event only seeds the baseline),
  which is correct for a guest that applies relative deltas.
- **Clicks are deferred**: transitions go on a queue and `drainIigsClicks()`
  delivers one per frame, only after the target is reached and no report is
  unread (a press and its release must never share a report — patching an unread
  report would swallow the press). 20-frame timeout so a non-polling guest cannot
  swallow a click. Outside SHR the queue flushes immediately.
- `romAdbTaskActive()` distinguishes a guest that draws its own pointer (Tass
  Times) from one that does not. It stamps **only genuine polls** — `$C027` reads
  from `FF:C4D0-$C560` with bits 7 and 1 both clear — because GS/OS runs the same
  task to *consume* reports; stamping every read made the (now removed) overlay
  blink.
- **F1 captures the mouse** (`canvas.tsx`): pointer lock turns mousemove into
  `movementX/Y`, forwarded as `MouseEventSimple.relative`. The ADB mouse is a
  relative device, so `iigsADBEvent` queues those counts directly — no closed
  loop (there is no absolute pointer to steer toward) and no dead reckoning
  (which would clamp at the screen edges). `stopIigsCursorTarget()` drops any
  steering target and the dead-reckoning baseline first, or both paths would
  move the cursor and leaving capture would replay the captured distance as one
  jump. F1 again or Escape releases the lock; a lock lost mid-drag also sends
  both button releases. Non-IIgs machines have no relative input path, so their
  capture accumulates into a virtual clamped pointer instead — the mouse card
  only takes absolute positions (and still has to enable `MOUSE_ON`), so motion
  stops at the screen edge there; only the IIgs gets unbounded relative motion.
- The boot welcome text page (`panels/help/startuptextpage.ts`) advertises
  `SHIFT+ESC` for the control panel and F1 for mouse capture. It is the same
  drawn text page for every non-game-mode machine, not ROM output. Its strings
  live in `startup.*` in `src/i18n/catalogs/messages.pot` (and each `.po` must
  carry the same msgctxt or `--require-merged` fails); `languages/*.ts` are
  generated with `npm run generate-i18n-catalogs`, so edit the catalogs, not
  those files.

Cursor position lives in the text-page holes `$047C/$057C` (X) and `$04FC/$05FC`
(Y), data-bank relative. On our ROM 01 profile GS/OS reads those, not
`$E1:0190-0193` (gssquared reads the `$E1:0190-0193` bank globals when the
platform is ROM 03).

---

## 7. Storage

- Drive indices: **0/1 = S7** (hard drives / SmartPort), **2/3 = S6** (5.25"),
  **4/5 = S5** (3.5"). `MAX_DRIVES = 6`.
- **Mounting keeps the bay the user chose.** `canDriveTakeImage(index, filename,
  size, hasThreeInchBay)` (in `src/common/utility.ts`) is the only rule allowed to
  move a disk, and it moves one only when that bay physically cannot hold the
  media: S7 takes any block image (an 800 KB one included, as a small SmartPort
  volume), S6 takes 5.25" media only, S5 is the IIgs 3.5" pair and does not exist
  on other machines (`getDefaultDiskDriveIndex` then answers 0). Before this, the
  UI had a two-family clamp that silently re-inserted an 800 KB disk into S6D1 and
  an 800 KB `.po` into S7D1, whatever the user picked.
- A headerless 800 KB image is 3.5" media whatever its name (`.2mg`, `.po`,
  `.dsk`, `.do`); the 2IMG container adds 64 bytes and may carry a short trailing
  chunk.
- **A loaded drive must label its track or the panel looks dead.** The drive
  panel renders `DISK_DRIVE_LABELS[index] + driveProps.status`, and only
  `moveHead()` wrote that label - the 3.5" head moves through `moveHead35()`, so
  S5,D1 showed nothing at all and reads as a crash. A 3.5" `quarterTrack` is a
  **track-side** index (80 tracks x 2 sides, `maxQuarterTrack = 159`), so the
  label is `Trk ${quarterTrack >> 1}`, not `/ 4` as on a 5.25" drive.
- `doResetDiskDrive()` must set `quarterTrack = 0` (real drives spring back to
  track 0). Parked at the outer stop, a Ctrl-Reset read the wrong track.
- **Ctrl-Reset**: clear the `$03F2-$03F4` signature (`$03F3 ^ $A5 == $03F4`) when
  any media is mounted (floppy *or* hard drive, `iigsHasAnyDiskMedia()`), so the
  ROM takes the cold device scan; leave it alone otherwise, which is what keeps
  Ctrl-Reset landing on the Applesoft `]` prompt.
- **IWM** (`$C0E0-$C0EF`): even read with Q6=1,Q7=0 (`$C0EE`) returns
  `(mode & 0x1F) | (motor ? 0x20 : 0)`; odd write with Q6=1,Q7=1 (`$C0EF`)
  latches `mode = v & 0x1F`. Without this the ROM's `SELIWM` polls forever.
  `$C0E8` (Q6=0,Q7=0) is the data register. **An empty bay must keep returning
  the ROM byte** — the power-on disk self-test reads it before any drive is
  enabled, and feeding it live bits derails the boot.
- **SmartPort** (`src/worker/devices/harddrivedata.ts`): status `$F0` on line,
  `$B4` write-protected, `$E0` offline (returns offline for an empty unit so
  GS/OS skips it instead of offering to initialise it). Unit 0 reports the card's
  full unit count. DIB subtype `$20` (hard disk). 0x10000 blocks must report
  `$FFFF`. **Do not set the extended bits `$C0`**: GS/OS switches to the extended
  command set, whose parameter lists carry a 3-byte pointer, and we only decode
  the 2-byte form — the boot stalls on the welcome screen.
- ProDOS block driver hook `$C7C0`: `$42` cmd, `$43` drive, `$44/$45` buffer,
  `$46/$47` block. Error codes: `$27` I/O, `$28` no device, `$2B` write-protected,
  `$2F` offline.
- A 2MG whose header is corrupt (this happens) is fine: detect the `"2IMG"` magic
  and always use offset 64. gssquared trusts `data_offset` and would read garbage.
- **The two floppy families live in different clock domains, and this is the
  subtle part of the IWM.** The **5.25" LSS is clocked by raw CPU cycles** —
  `iwmReadDataRegister()` gets `s6502.cycleCount` with **no speed scaling**, 4
  cycles per bit cell, exactly as gssquared's `Floppy525_woz` does in *every*
  speed mode. The Disk II / ProDOS read loops are cycle-timed too, so the two
  keep their relationship at 2.8 MHz. Scaling the bit model to wall time
  (`frameCycles / 17030`) makes the ROM re-read the same register 2.7 times
  before the next bit cell arrives, the `D5 AA 96` sync loop at `$C65E`/`FF:6700`
  never locks on, and the boot ends at `CHECK STARTUP DEVICE!`. Only the
  **3.5"** drive follows machine time — gssquared overrides `get_current_time()`
  with `get_vid_cycles()` for `Floppy35_woz` alone, because 500 kbit/s media
  cannot be sustained by a 1.02 MHz budget.
- **3.5" media (`src/worker/devices/floppy35.ts`)** is a *block* nibblizer, not a
  captured-bit one: the 800 KB volume image is expanded per track-side into
  self-synchronising GCR fields and streamed at machine time, and the ROM's own
  decoder is the ground truth. Zoned layout is 16 cylinders each of
  12/11/10/9/8 sectors per side (160 track-sides, 1600 blocks). Writes splice the
  sector back into the block image at `64 + sectorOffset(track, sector, side)`,
  flushed on a data-register read (`iwmFlushWrites35`). Captured 3.5" GCR images
  (`.do`/`.woz` from real media) are still not supported.
- `doSetEmuDriveNewData()` must copy `props.isWriteProtected` into the drive
  state, not only the disk data. It used to keep whatever the previous mount
  left there, so a write-protected image mounted as the boot volume made GS/OS
  refuse to write its directory blocks.

---

## 8. Timing

- **The video beam is a function of machine time only.** `iigsVideoClock`
  accumulates refresh-relative units; a CPU cycle is worth
  `frameCycles / 17030`, so slow mode advances the beam 2.74x per cycle and a
  frame is always 1/60 s. `frameCycles` stays `cpuCyclesPerRefresh` and does
  **not** follow `$C036`. Using `cycleCount % frameCycles` as the phase meant
  every `$C036` write moved the beam backwards by up to a whole frame: `$C02E`
  could go back in time, scanline/VBL windows were re-scanned, and the DOC and
  mouse anchors inherited the jump. Reset the clock in `doReset()` and
  `doSetSpeedMode()`.
- VBL is the first `vblCycles` of each frame and must agree with `$C019` and
  `readIigsVideoCounter`.
- Verified: 4074 VBLs / 4074 refreshes over 4000 frames with `$C036` flipping
  both ways.
- Speed modes: 1.02 MHz (17030 cycles/refresh), 2.8 (46727), 7.1, 14.3.
- **`$C036` bit 7 SET means FAST (2.8 MHz)**, clear means 1.024 MHz — verified in
  gssquared `mmu_iigs.hpp` (`set_slow_mode(value & 0x80 ? false : true)`); the
  `// bit 7 slow` comment in `mmu_iigs.cpp` is stale. Cold boot seeds `0x80`
  (ROM 03 uses `0xC0`), and `doReset()` re-seeds it.
- **The IIgs defaults to speed mode 1 (2.8 MHz)** when the host never explicitly
  picked one (`speedModeExplicit` in `doSetMachineName`); classic 8-bit machines
  keep mode 0. `cpuCyclesPerRefresh` is then indexed from the IIgs table, so the
  video clock stays in machine time and the 5.25" LSS keeps counting CPU cycles.
  Everything timed in *frames* has to be re-checked after this: ProDOS 8's
  welcome page is only on screen for a few hundred frames at 2.8 MHz before
  A2DeskTop takes over, so `gs_floppy_late` watches every frame instead of
  sampling the end of the run.

---

## 9. Boot, disks, UI

- `?machine=apple2gs`, `?boot=true`, `?drive=N` (0/1 = S7, 2/3 = S6, 4/5 = S5),
  `?speed=`, `#http://...` fragment disk. Named bay parameters: `?s7d1`/`?s7d2`
  (`?hd1`/`?hd2`), `?s6d1`/`?s6d2` (`?d1`/`?d2`) and `?s5d1`/`?s5d2` for the IIgs
  3.5" pair.
- **`?boot=true` must wait for the fragment disk to mount** (`__pendingBootAfterDisk`
  + `.finally`, so a failed mount still boots). Booting first scanned an empty
  drive.
- Slot configuration for the IIgs is fixed: S1 printer/ssc, S2 modem, S3 80-col
  (no cards), S4 mouse/mockingboard, S5 3.5", S6 5.25", S7 SmartPort. Drives are
  motherboard hardware, so the drive panel must **not** grey them out when the
  slot says `"none"` except for slot 7.
- The drive panel picks its art per bay: `floppy35{on,off}[-empty].png` for the
  IIgs slot-5 pair, `disk2*` for slot 6, `harddrive*` for slot 7. The 3.5" lamp is
  the **spindle** (`dprops.spindleOn`, latched by CONT35), not `motorRunning` —
  the 5.25" motor line never drives it. The icons are composited from
  `apple-35-floppy-drive.png` with the house layout (activity lamp bottom-left,
  filename across the slot, rainbow apple bottom-right so it shares the Disk II
  and hard-card corner, which is also where the swapper badge lands); because the
  face is beige the filename needs `.disk-label-onlight`, which the Disk II and
  the hard card do not because their art is dark where the label lands.
- `iigsInitInterrupts()` runs on **cold boot only**. Ctrl-Reset must preserve low
  memory and `$03F2-$03F4`.
- IIgs speed labels in the dropdown and in `linkbuilder` / MCP settings must match
  `SPEED_MODES`.

---

## 10. Tooling and debug hooks

| tool / hook | what it does |
|---|---|
| `...\Temp\opencode\dis65816.cjs` | 65816 disassembler. `node dis65816.cjs <file.json> [at:N] [count] [m16] [x16]`; opcode table parsed from `c:\dev\gssquared\src\debugger\trace_opcodes.cpp`; accepts a plain `{start, bytes}` object |
| `...\Temp\opencode\diskserver.cjs` | static server on :6503 for `c:\dev\emu\ap2`, CORS open |
| `...\Temp\opencode\mckey.cjs`, `mcpeek.cjs`, `mc1.cjs` | MCS key injection / memory peeking over CDP |
| `?romtrace=1` | PC histogram + `window.__romTrace`, `__romTracePeek(addrs)` reads guest memory (peekPc/peekCode/peekZp) |
| `?iwmgaps=1` | IWM read-cadence stats on `window.__iwmStats` |
| `?adbtrace=1` | ADB log ring on `window.__adbLog` (pc-stamped) |
| `?ensoniqdbg=1` | DOC state on `window.__ensoniqDocStats` (osc rows, osce, irqTicks, block ring, vblCount) |
| `window.__audioDebug` / `__ensoniqDebug` / `__ensoniqBlocks` | speaker clicks, Ensoniq context state, blocks actually started |
| `?shr=1` style dumps | `__shrWindow` memory dump used for SHR inspection |

**Measurement traps**

- A 65816 PC is logged **after** operand fetch in a wrapper (`LDA $C03D` at
  `b915` logs as `b918`). Allow for the operand length.
- A PC filter that ignores the bank silently mixes bank 0 loops into banked
  ranges.
- `readData` is `$C026`; `$C024` is `readMouseData`. Wrapping the wrong one
  reports a confident zero. A helper that reads `$C024` from inside a wrapped
  `readMouseData` re-enters it — guard against recursion.
- GS/OS runs native mode, so `$AD`/`$8D` are 4-byte long forms; an absolute-only
  decoder finds zero `$C02x` accesses. Wrap the device method and read `cpu.PB/PC`.
- **Raw CDP key events need `canvas.focus()`** and `type: "rawKeyDown"`
  (`keyDown` is dropped). Click `#tour-reset-button` instead of synthesising
  Ctrl+R; synthetic Ctrl+R is unreliable.
- Typing multi-character programs through CDP loses characters; real key events
  into the guest are slow. Prefer jest (`setKeyboardState` direct) for anything
  that types.
- A probe that sends `setKeyboardState({key})` **without `isDown: true`** silently
  takes the release branch and types nothing.
- CDP `Runtime.evaluate` needs `awaitPromise: true` for `decodeAudioData`, and
  large dumps must be chunked (~120k floats per call). Channel data is float
  -1..1, not int16.
- `gs_boot_out.txt` and `gsos_boot.bmp` are **rewritten by every run** of
  `gs_boot`/`gsos_boot` and their diff is not evidence: the `$FF:85xx` gate-trace
  A values vary run to run (measured 0x8029/0x802f/0x8033 on the same code), so
  a dirty artifact after a fix says nothing about the fix.

---

## 11. Open issues

1. **MCS (`mcs.2mg`) splash timeout — RESOLVED.** The ProDOS-8 splash
   (`MCS Copyright (c) 1986 Will Harvey` / `PRODOS 8 V1.2 06-SEP-86`) waits at
   `01:33C8` (65816 native mode, bank-1 fast RAM) for a key on the
   **`$E0:C000`** keyboard register and exits via `STA $E0:C010`. With no key it
   times out after ~9.6 s per pass (two passes), loads the demo
   `/MUSICGS/LEROY` into bank 0 `$2000-$4000` (MLI `$CC`/`$C8`/`$C9`/`$CA` all
   return success), then relocates its music driver at `01:a9ee-$aa16`: it
   writes `$C035 = $5F` (**SHADOW_INH_IOLC, bit 6**), block-copies `$1E00`
   bytes from `$00:2512` to `$C000,Y` with DB = `$01`, and restores `$C035`.
   Our `memGet24`/`memSet24` routed bank `$00`/`$01` `$C000-$CFFF` to the Mega
   II unconditionally, so the copy poked soft switches (`$C02D`, `$C03C/D`, ...)
   and the machine ran off into `00:E03B` (`JMP` to itself) instead of
   reaching the editor. Fix: honour bit 6 — while `SHADOW_INH_IOLC` is set,
   banks `$00`/`$01` expose fast RAM across `$C000-$CFFF` (bank 1 = aux, bank 0
   by ALTZP), matching gssquared `is_iolc_shadowed()` /
   `bank_shadow_read/write`. No key now ends in the editor with the LEROY demo
   loaded (SHR on, measures shown, DOC streaming the song); a key at the splash
   goes straight to the empty editor (`01:a64c`). Regression:
   `gs_mcs_nokey.test.ts`. Note the splash timeout is measured in CPU cycles,
   so the frame it lands on follows the speed mode: ~925 at the current 2.8 MHz
   default, ~3200 at 1.02 MHz.
2. **SenseiPlay music too fast — RESOLVED.** Two stacked bugs, both in the run
   loop's Ensoniq catch-up:
   - The catch-up state (`ensoniqRefreshId`/`ensoniqOutCursor`/
     `ensoniqSamplesPerRefresh`/`ensoniqScratch`) was declared *inside*
     `doAdvance6502`, so every call started with `refreshId = -1`, re-ran the
     rollover, generated a look-ahead block at the end of the call that the next
     call threw away, and advanced the DOC march ~1.5 refreshes per refresh
     (measured 40004 generated samples/s against a 26320 Hz chip — ~667 per
     refresh instead of 439). Posted audio stayed 1x (439 frames per block), so
     the timer oscillator ticked at ~76 Hz and the tracker ran 1.5x fast with
     correct pitch.
   - Gating generation on `hasActiveOscillators()` (commit `bd90c7d4`) then
     paused the DOC clock whenever all voices momentarily halted — about a
     quarter of every tracker refresh — so with the lookahead gone the march
     ran ~0.76x and the music dragged. The chip's sample clock must advance
     every refresh regardless of activity (the silence path fills zeros but
     keeps `samplesGenerated` moving).
   Fix: hoist the catch-up state to module scope, drop the `force` look-ahead
   (generate only up to elapsed time), and always generate (silence fast path).
   Verified: generated = 26343 samples/s = 439/refresh exactly (was 40004 then
   20003); the TN #23 timer voice now ticks at 50.2 Hz and the player's
   `Pos:` line advances ~18.3 rows/s.
   - Corrected ground truth: the authored average is **2.735 ticks/row** (pattern
     0 is 3,3,3,2 repeating = 2.75; the song overall 2.81), not 2.05 — the
     earlier 2.05 came from reading only rows 0 and 3 of pattern 0, and the
     "37 rows/s" was the broken (1.5x) build's measurement. At 50.2 Hz that is
     17.8-18.3 rows/s, which is what the fixed build produces.
   - Regression tests: `gs_ensoniq.test.ts` (silence path keeps the clock moving;
     TN #23 timer ticks at the chip's own rate) and `gs_doc_clock.test.ts`
     (run loop: exactly one outRate/60 block per refresh).
3. **Silpheed pitch** — same instrumentation, during playback.
4. **MYCRATE app library** — Silpheed is the only app confirmed to launch
   (reaches its "PRESS A JOY BUTTON" prompt). SynthLab and others: the Finder
   reached, the icon never double-clicked in automation. Unverified, not broken.
   Note that a *joystick button* in apple2ts is Open/Closed Apple (`AltLeft`/
   `AltRight`, numpad `0`/`5`/`.`/Enter), a gamepad button, or the touch joystick;
   arrow keys are axes, and only with "Use Arrow Keys as Joystick" enabled.
5. **Two QuickDraw II rendering defects** (not input related): Finder
   desktop-layer icons render as solid black bars (the same icons inside a volume
   window render correctly), and grayed-out menu items render as garbage glyphs
   while enabled items are fine. Both point at the mask/transfer path of QD II
   copybits (`TOOL034`), compare against `display.cpp`.
6. **3.5" floppies — RESOLVED for 2MG block images.** `src/worker/devices/floppy35.ts`
   expands the 800 KB volume into self-synchronising GCR fields per track-side
   (zoned 12/11/10/9/8 sectors, 160 track-sides), streams them on the machine
   clock and splices writes back into the block image. `SystemDisk.2mg` boots
   from slot 5 into the SHR Finder desktop and every field still decodes to the
   *written* image afterwards (`gs_floppy35`, `gs_floppy35_boot`). Still open:
   captured real-media images (`.do`/`.woz` 3.5") have no importer.
7. **SilkyGS ports render a blank SHR screen — RESOLVED.** Volume `SilkyGS.2mg`
   in S7D2 with `SystemDisk.2mg` in S7D1; picking e.g. Super Mario Bros left the
   screen a uniform palette-0 blue although the game blitted every frame. Every
   bank-$00 store was mirrored into Mega II **main** regardless of the effective
   bank and the `$6000-$9FFF` half of the SHR window was not mirrored at all, so
   the ports' RAMWRT blits (DB=$00) landed in aux fast RAM where the video
   scanner never looked. Fix: `iigsEffectiveAuxWrite` + `shadowIigsWrite` in
   `memSet24` follow gssquared `calc_aux_write`/`shadow_is_enabled` (§2).
   Regression: `gs_silky.test.ts` (Finder double-click into the port, then
   asserts >100 scanlines of SHR pixels and >5000 non-zero Mega II aux bytes).
8. **freegemas.2mg mouse would not move — RESOLVED.** The game is a self-booting
   GS/OS match-3 port that keeps its own cursor: it reads `$C024` twice per
   frame (X then Y) from bank `$09` and accumulates the deltas itself, so the
   Event Manager never publishes a position and the text holes stay `(0,0)`.
   The closed-loop stepper therefore saw the cursor at the origin and injected
   ±63 chunks toward the host target every frame; the game applied them and its
   pointer raced into the bottom-right corner and stuck there. The Tool Locator
   flag is not evidence that a guest maintains the EM cursor. Fix: the loop
   requires a non-zero published position and demotes to dead reckoning when a
   consumed report leaves it unmoved (§6). Verified end to end: the pointer
   tracks relative motion and a left click on "Timetrial mode" starts the board
   (regression: `gs_freegemas.test.ts`).

---

## 12. Myths that were disproved (do not re-chase)

| theory | reality |
|---|---|
| The Event Manager is broken / events never reach GS/OS | They did; one click arrived as two transitions because both report bytes carried the button bit |
| `$AA` must become PLY in native mode | gssquared uses TAX in all cores |
| PostEvent is called twice, dedup it in the CPU | Symptom of the report layout; dedup removed |
| `$47C/$4FC` cursor holes never move, nothing reads `$C024` | True only before the Finder is up (~1100 frames); at ~4000 they track |
| The VBL path / ROM task queue is dead | The ROM's full manager runs constantly; GS/OS replaces `$E1:0030` with its own |
| Publish the host pointer into `$E1:00E9` | Removed; the closed-loop stepper does it without touching guest memory |
| `$E1:00FF` is the 80-column text-page register | It is the ROM's interrupt-nesting counter |
| The DOC mix lost its bass | The old build had a DC rail that faked bass; the real change was −3.7 dB of level |
| `$C029` bit 6 means something to the video mode | It is MMU aux linearization only (gssquared `set_new_video` ignores it) |
| Replacing `$C050-$C05D` with gssquared's explicit bits is an improvement | Changed the palette and broke six suites |
| `extractShrBuffer` was fine, the caller forgot to check | It silently adds `$2000`; the buffer was clamped short |
| An 8-instruction batch is a free perf win | Starved SmartPort reads in the browser only |
| SenseiPlay's 37 rows/s is the authored tempo | Wrong NTP pattern offset (a stray `p++` in the header walk) made the tempo look self-consistent; the real average is ~2.735 ticks/row (~18.3 rows/s at 50 Hz). The 37 rows/s came from a build whose DOC march ran 1.5x fast; the (also wrong) 2.05-ticks/row estimate read only rows 0 and 3 of pattern 0 |
| The MCS splash hangs unless a key arrives | The no-key timeout *is* the demo loader. It crashed because banks `$00`/`$01` kept routing `$C000-$CFFF` to the Mega II soft switches while `$C035` bit 6 asked for fast RAM, so the driver relocation poked I/O instead of copying |
| A live Tool Locator / Event Manager means the guest publishes its cursor | freegemas keeps its own cursor and reads `$C024` directly; the holes stay `(0,0)` and closed-loop steering pinned its pointer in a corner. The flag says GS/OS is up, not that this program uses the EM cursor |
| "One refresh is always 1/60 s, so every peripheral must follow machine time" | True for the beam and the 3.5" drive, **false for the 5.25" LSS**: gssquared counts raw CPU cycles for it in every speed mode, because the Disk II firmware's read loop is cycle-timed as well. Scaling it to wall time broke the 5.25" boot at the 2.8 MHz default |

---

## 13. File map

- `src/worker/cpu65816.ts` — 65816 core, stack normalisation, cycle accounting,
  IRQ sampling, `specialJumpTable`
- `src/worker/memory.ts` — bank map, Mega II main/aux, soft switches, `$C02x`/`$C03x`
  registers, text-page sources, SHR extraction, floating bus, slot strobes
- `src/worker/motherboard.ts` — run loop, video clock, VBL, housekeeping, Ensoniq
  catch-up, speed modes, reset vs cold boot
- `src/worker/iigs_adb.ts` — ADB micro + device model, report latching, buttons
- `src/worker/devices/mouse.ts` — IIgs event routing, closed-loop cursor, click queue
- `src/worker/devices/keyboard.ts` — legacy strobe + ADB, DOM→ADB table
- `src/worker/devices/iigs_ensoniq.ts` — DOC
- `src/worker/devices/diskdata.ts`, `drivestate.ts`, `decodedisk.ts`,
  `harddrivedata.ts` — IWM, drives, 2MG/PO/WOZ, SmartPort
- `src/worker/devices/floppy35.ts` — 3.5" GCR field generation, sector offsets,
  write splice; machine-time media clock (§7)
- `src/worker/iigs_clock.ts` — RTC + battery RAM
- `src/worker/memory.ts::iigsInitInterrupts` — tool vectors, `$E1:0034`
- `src/ui/graphics.ts`, `canvas.tsx`, `copycanvas.ts` — rendering, aspect, text
- `src/ui/inputparams.ts`, `main2worker.ts` — URL params, debug-hook plumbing
- Tests worth knowing: `gsos_boot`, `gs_cycles`, `gs_adc_flags`, `gs_mouse_sync`,
  `gs_mouse_neg`, `gs_mouse_capture`, `gs_cursor_repaint`, `gs_cursor_draw`,
  `gs_cursor_y`, `gs_adb_button`, `gs_vbl_cadence`, `gs_rom_adb_task`,
  `gs_ensoniq`, `gs_doc_clock`, `gs_tass`, `gs_tass_title_tempo`,
  `gs_tass_click_freeze`, `gs_textpage`, `gs_floppy_late`, `gs_ctrl_reset`,
  `gs_keyboard_adb`, `gs_mcs_nokey`, `gs_silky`, `gs_freegemas`,
  `gs_floppy35` / `gs_floppy35_boot` (3.5" read, write, zone layout),
  `gs_speed`, `gs_boot`, `gs_hdd_boot`, `gs_slots_mockingboard`,
  `gs_test_coldboot`, `gs_fatal`

The only known pre-existing failure is `vera.test.ts` (CMDR-DOS), which also
fails on a clean tree.
