# Mockingboard 6522 Timer — Investigation & Stopping Point

> **Status: stopped at `dd2f7ec0` (best version). origin/fix/mockingboard-timing = `dd2f7ec0`.**
> mb-audit passes through **11:09**, stuck at **11:0A:03 (Expected 04, Actual 03)**.
> The 11:0A fix is **not found** — two independent implementations both regressed
> 11:09 and were reverted.

---

## 1. Goal

Make apple2ts pass mb-audit's Mockingboard 6522 timing test sequence
(T6522_1 … T6522_A …).

mb-audit is a 65C02 emulator that exercises the 6522 timer with **real 6502
instruction sequences** (indirect-indexed writes to T1C, read-back of the
counter, and `SBC`/`CMP` assertions). It is **not** a unit test — it runs a full
emulator and checks the read-back value, so only **real cycle counts** and **real
read/write phase** matter.

**There is no headless way to run mb-audit — browser only.** This is the core
constraint of the whole task (see §6).

---

## 2. Fixes that passed (11:01 → 11:09, all in `dd2f7ec0`)

Five commits on `fix/mockingboard-timing`, stacked on top of latest main:

| commit | what it fixed | mb-audit |
|---|---|---|
| `670a1c00` | T6522_1 interrupt + AY detection | 11:01:01 |
| `f34f0dc5` | counter load value = latch+1 (not latch) | 11:03:00 |
| `c02d410d` | load value independent of store opcode (`extraTimerWriteCycles` compensation) | 11:03:03 |
| `8dfeb6d6` | read samples at the read instruction's data phase (`extraTimerReadCycles`) | 11:05:23 |
| `dd2f7ec0` | one-shot reloads from latch after underflow (T1C_h no longer stuck at $FFFF) | 11:09:01 |

Each one was corrected **to match the known-correct behavior of applewin /
emu6502**, not guessed. `dd2f7ec0` passes all 698 local tests; tsc/eslint clean.

### Key timing functions (`src/worker/devices/mockingboard.ts`)

- `handleTimerT1(slot, chip, cycleDelta)` (L57) — core decrement.
  **apple2ts is "batch-decrement per instruction"**: `counter = counter - cycleDelta`,
  not once per CPU cycle. This is the **structural difference** vs emu6502/applewin
  (see §5).
- `extraTimerWriteCycles()` (L271) — extra-cycle compensation for store opcodes
  (STA abs,Y=+1, STA (zp,X)=+2, …)
- `extraTimerReadCycles()` (L304) — data-phase compensation for read opcodes
  ((zp,X)=+2, (zp),Y=+1, …)
- `readTimerCounterByte(...)` (L316) — applies read compensation when reading the counter
- `handleMockingboard` (L324) — address dispatch; T1C_L/T1C_H/T1L_L/T1L_H cases

### `dd2f7ec0` handleTimerT1 logic (current)

```
counter -= cycleDelta                       // 16-bit batch decrement
if (underflow):
    if (started):
        if (!fired):                        // one-shot fires only once
            set fired (one-shot) / IFR; IRQ if enabled
        reload counter from latch           // 0 -> $FFFF -> latch (period = latch+1)
```

period = **latch+1** (after 0 it goes straight to latch; no dedicated $FFFF fire-state).

---

## 3. The blocker: 11:0A (T6522_A) — small-latch underflow bounds

### mb-audit's test (source in `c:\dev\mb-audit\chip-6522.a`, T6522_A)

```
ACR = one-shot
for N = 7,6,5,4,3,2,1,0:
    T1C_L = N          ; lda zpTmp2 / ldy #T1L / sta (MBBase),y
    T1C_H = 0          ; lda #0   / ldy #T1H / sta (MBBase),y   <- loads counter = latch
    read T1C_L         ; ldy #T1L (2cy) / lda (MBBase),y (5cy)
    expected:
      N=7->01  N=6->00  N=5->FF  N=4->04  N=3->02  N=2->00  N=1->01  N=0->00
```

mb-audit's own expected-value formula (in the source): `expected = N - 6`, and if
that underflows, `+= N + 2` (because "6522 counts N+2 cycles"). → **period = N+2**,
and **$FF is a real, readable state** (N=5→FF).

### `dd2f7ec0` browser results (provided by the user)

| N | expected | dd2f7ec0 |
|---|---|---|
| 7 | 01 | pass |
| 6 | 00 | pass |
| 5 | FF | pass |
| **4** | **04** | **03** ← off by 1 cycle |
| 3 | 02 | pass |
| 2 | 00 | pass |
| 1 | 01 | pass |
| 0 | 00 | pass |

**Only N=4 is off by 1 cycle (03 instead of 04).** N=5→FF passes, so the $FFFF
fire-state does exist; the small-latch phase is just 1 cycle off.

---

## 4. The correct 6522 timer model (verified against emu6502 source)

I read emu6502's `w65c22::tick()` (`c:\dev\emu6502\emulator\src\mockingboard.rs` L446):

```rust
let old_t1c = self.t1c;
self.t1c = old_t1c.wrapping_sub(1);            // decrement by 1 each tick
if old_t1c == 0 {
    self.ifr |= (self.t1_loaded as u8) << 6;    // 0 -> fire (sets IFR)
    self.t1_loaded &= self.acr & 0x40 != 0;     // one-shot clears loaded; free-run keeps it
} else if old_t1c == 0xffffffff {
    self.t1c = self.t1l as u32;                 // 0xFFFFFFFF -> reload latch
}
```

**Model: the counter is a 32-bit value walking `N, N-1, …, 1, 0, 0xFFFFFFFF(fire), N, …`**
- period = **N+2**
- **$FFFF (0xFFFFFFFF) is a real 1-cycle fire state, reads back as $FF**
- 0 -> $FFFF is the fire (sets IFR); $FFFF -> latch is the reload
- `t1_loaded` (≈ apple2ts's `!T1fired`) controls "whether to fire the interrupt",
  not "whether to reload"

On load (`T1C_H` write): `t1c = latch + 1` (emu6502 L624-625), `t1_loaded = true`.

### Verifying all 8 N of 11:0A with this model (read back 7 cycles after load)

Load → counter = N+1, then 7 ticks (the `0->0xFFFF->latch` transition counts as ticks):

| N | load | value after 7 ticks | reads | expected |
|---|---|---|---|---|
| 7 | 8 | 1 | 01 | 01 ok |
| 6 | 7 | 0 | 00 | 00 ok |
| 5 | 6 | 0xFFFF | FF | FF ok |
| **4** | **5** | **4 (reloaded)** | **04** | **04 ok** |
| 3 | 4 | 2 | 02 | 02 ok |
| 2 | 3 | 0 | 00 | 00 ok |
| 1 | 2 | 1 | 01 | 01 ok |
| 0 | 1 | 0 | 00 | 00 ok |

**All 8 match.** So the emu6502 model is correct; `dd2f7ec0`'s period=latch+1 is
missing the $FFFF slot, which is why N=4 is off by 1 cycle.

---

## 5. Why 11:0A won't fix cleanly (root cause)

### 5a. Structural difference: batch decrement vs per-cycle tick

apple2ts's `handleTimerT1` is **batch-decrement per instruction**
(`counter -= cycleDelta`); emu6502 ticks **once per CPU cycle** (inside the CPU
main loop, calling `tick(1)` every cycle).

For large latches (T6522_3/9, where the counter never crosses 0 within one
instruction) the two are **equivalent** — which is why T6522_3/4/9 pass on
`dd2f7ec0`. But for small latches (N=0..7), batch decrement **jumps over** the
`0 -> $FFFF -> latch` transition and lands 1 cycle off — exactly the N=4→03 bug.

To truly match, `handleTimerT1` must become per-cycle — but in apple2ts's
architecture that is a **structural change**: the timer decrement has to move
from "once per instruction" to "once per CPU cycle", touching the CPU↔timer
interface.

### 5b. Both attempts regressed 11:09

| commit | change | browser result |
|---|---|---|
| `2eb54e5e` | `foldT1` (counter folded into `{0..latch}∪{$FFFF}`, period latch+2) | **11:09:00 Expected 01 / Actual FE** |
| `7e3e3728` | per-cycle loop + started gate (0→$FFFF→latch) | **11:09:00 Expected 01 / Actual FE** |

Two **independent implementations**, both regressing 11:09 with the same FE —
not a coincidence. It means "period latch+2 / add a $FFFF fire-state" **conflicts
with 11:09's reload behavior** under apple2ts's architecture. I can't determine
locally which is right; only the browser knows, which just burns the user's
test cycles.

### 5c. Local tests are unreliable (key limitation)

I wrote local Jest tests reproducing T6522_A, but **the read-back values don't
match the browser**:

- Same `dd2f7ec0` code, N=4: browser reads **0x03**, local reads **0x00** (garbage)
- I traced the handler, reset, and address routing and couldn't explain the local divergence
- Local "all 698 green" does **not** predict browser pass — mb-audit runs a **real
  emulator with real instruction sequences**, and local Jest's instruction sequence /
  cycle counts / read-write phase **don't line up** with it

So local "green" has no predictive power for 11:0A; only the browser test is the
real signal.

---

## 6. Core limitation: no headless test

- **mb-audit runs browser-only** (65C02 emulator + real Apple II timing); no CLI / headless.
- Every change requires: commit → push → browser test → paste back Expected/Actual.
- I **cannot verify locally** whether 11:0A passes or 11:09 regresses.
- This turns the whole task into a "guess → test → regress → guess again" loop
  that burns the user's test cycles.

---

## 7. Next steps (for whoever picks this up)

1. **Start from `dd2f7ec0`** (furthest the browser got; passes 11:09, stuck only at 11:0A:03).

2. **The correct model is period = latch+2 with a real $FFFF fire state**
   (§4, verified against emu6502 source). Fix direction: make `handleTimerT1`
   decrement per-cycle, `0 → $FFFF → latch`.

3. **But 11:09 regresses** (both implementations regressed FE) — "adding a $FFFF
   fire-state" conflicts with 11:09's "one-shot reload T1C_h=$02 after underflow".
   Satisfying both 11:09 and 11:0A requires figuring out how 11:09's **reload
   timing** and 11:0A's **$FFFF fire-state** coexist. This is the core hard problem.

4. **Hand it to someone with a browser-test environment** — because local tests
   have no predictive power for 11:0A (§5c). Someone who can run mb-audit locally
   (or at least run the real "load → wait underflow → read-back" instruction
   sequence) can iterate.

5. **Don't touch T6522_3/4/5/9 timing** — they pass on `dd2f7ec0` and are known
   correct. Changing large-latch load/read compensation
   (`extraTimerWriteCycles` / `extraTimerReadCycles`) will regress them.

---

## 8. File & commit index

### Device implementation
- `src/worker/devices/mockingboard.ts` — 6522 + AY-3-8910 implementation
  - `handleTimerT1` (L57) — core decrement (batch, not per-cycle)
  - `extraTimerWriteCycles` (L271) — store opcode compensation
  - `extraTimerReadCycles` (L304) — read data-phase compensation
  - `readTimerCounterByte` (L316)
  - `handleMockingboard` (L324) — dispatch

### Tests
- `src/worker/devices/mockingboard.test.ts` — apple2ts's own 6522/AY tests (698)
  - `lda04a/04b/04c` — read counter twice and subtract to check the decrement
    (apple2ts's own tests, **not** mb-audit tests)

### References (known-correct)
- `c:\dev\emu6502\emulator\src\mockingboard.rs` L446 — `w65c22::tick()`
  (per-cycle, period latch+2, $FFFF fire state)
- `c:\dev\mb-audit\chip-6522.a` — mb-audit's 6522 test source (T6522_1 … T6522_A)
- applewin (not on this machine) — also a known-correct reference

### Commits
- **`dd2f7ec0`** — code stops here (passes 11:09, stuck at 11:0A:03)
- `2eb54e5e` — attempt 1 (foldT1, regressed 11:09, reverted)
- `7e3e3728` — attempt 2 (per-cycle + started gate, regressed 11:09, reverted)
- `670a1c00` → `f34f0dc5` → `c02d410d` → `8dfeb6d6` — the 11:01→11:05 fixes
