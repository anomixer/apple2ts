


---

### 57. IIgs: gssquared-faithful cleanup + boot race fix — 2026-10-22

**Directive**: "所有邏輯都參考 gssquared 這個模範生, 用他程式碼絕對沒問題." (All logic must reference gssquared, the model student; using its code is definitely fine.) AGENTS.md §28 already mandates gssquared as the gold standard. This section records a cleanup pass that removes the last non-gssquared deviations and a real browser-only boot race.

#### A. Remove the async Mega II aux write (§55 hypothesis) — DONE

`iigsADBEvent` in `src/worker/devices/mouse.ts` no longer writes the host pointer
into `megaIIAux[0x00E9..0x00EC]`. gssquared does **not** do this: its cursor
source of truth is the ADB report plus the ROM's own dispatch (`FE:C5C8` reads
`$E1:00E9/$E1:00EB` itself), with the optional KEGS-style dead-reckoning write
happening only at `$C024` read time — never an asynchronous poke. The async poke
was a hazard: it wrote into the ROM's interrupt scratch page (`$E1:00E0-$FF`)
on every mouse event, including during GS/OS boot, and could corrupt the
interrupt manager's state (consistent with the reported "brk beep" + missing disk
icons when the user moved the mouse while GS/OS was booting). `megaIIAux` is no
longer imported in `mouse.ts`.

#### B. Hard-drive (Slot 7) Ctrl-Reset signature clear — DONE

`doReset()` previously cleared `$03F2-$03F4` only when `iigsHasFloppyMedia()`
was true. Mounting a SmartPort hard-disk image (`.2mg`/`.po`/`.hdv`) and pressing
Ctrl-Reset therefore took the ROM's warm path, which never scans Slot 7, so the
disk never booted. Added `iigsHasHardDriveMedia()` (checks `getHardDriveState(1/2)`
filenames) and `iigsHasAnyDiskMedia()`; the signature clear now fires for any
mounted disk (floppy or hard drive), matching section 26a's floppy fix.

#### C. Defer `?boot=true` until the fragment disk is mounted — DONE

`src/ui/inputparams.ts`: `?boot=true` together with a `#http://...` fragment
disk used to call `passSetRunMode(NEED_BOOT)` immediately, while the disk image
was still downloading/mounting, so the ROM scanned an empty drive and the boot
failed (MCS: "INSERT SYSTEM DISK AND RESTART -ERR 01"; GS/OS: desktop with no
disk icons + error beep). The boot is now deferred: `__pendingBootAfterDisk` is
set, and `passSetRunMode(NEED_BOOT)` fires from `handleFragment()` only after
`handleSetDiskFromURL()` resolves (via `.finally`, so a failed mount still boots).

#### D. Verified still working after the cleanup

- `tsc --noEmit` clean (tree-wide).
- Worker suites `gsos_boot`, `gs_disp2`, `gs_ctrl_reset`, `gs_keyboard_adb`,
  `gs_basic_sound`, `gs_tass_click_freeze`: 6 suites / 10 tests pass.
- Headless Chrome: GS/OS 6.0.1 boots to a fully rendered Finder (menu bar,
  MDVOL2 + APPLEDISK + GSHK + Trash icons, cursor overlay) with the deferred
  boot. Speaker click count 93 (boot POST + Finder beeps, not a BRK loop).

#### E. Still open (needs further work / gssquared-level fidelity)

- **MCS "-err 01" in the browser**: even with mount + Ctrl-Reset, MCS's ProDOS
  8 boot fails. The same image boots cleanly in the jest harness, so this is a
  real-time run-loop / interrupt-timing issue, not a logic bug. Candidate:
  `fde0b4c6`'s run-loop catch-up sprint + `5bcc11c6`'s 4-instruction batching
  can starve the SmartPort block reads during boot. Needs a gssquared-style
  cycle-accurate scheduler comparison. The faithful reference is
  `c:\dev\gssquared\src\cpus\base_6502.cpp` + `computer.cpp` run loop.
- **Tass Times in-game input**: §47A wired the IIgs ADB keyboard dual path
  and §54 made keys also drive `$C000`. Needs a live browser play-through to
  confirm end-to-end (the title screen does not advance on CDP-dispatched keys
  in headless Chrome, so it cannot be verified automatically).
- **Silpheed pitch**: requires a live `?ensoniqdbg=1` osc dump from a real
  browser run; the DOC model itself matches gssquared (march math, halt
  semantics, mix/8, signed int8, mono mirror).
- **PostEvent dedup (§56) is a CPU-level hack**, not gssquared-faithful.
  gssquared runs the same ROM without it, so the real cause is a deeper
  discrepancy in our ADB report latching / Event Manager state that makes
  PostEvent return 0 twice. The faithful fix is to make our ADB micro-controller
  match gssquared's `ADB_Micro.hpp` exactly so one press yields one dispatch.
- **Overlay cursor exact-under-pointer mapping** (§53/§54): bezel-inset screen
  rect vs. full window scale/offset.
- **`iigsHasAnyDiskMedia()` is a UI/worker-side heuristic**, not hardware.
  gssquared decides bootability from the IWM/SmartPort device status bytes; our
  `iigsHasFloppyMedia()`/`iigsHasHardDriveMedia()` mirror that intent but are
  checked in `motherboard.ts`, not in the device layer. Acceptable for now.