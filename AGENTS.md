# Apple IIgs Emulation Engineering Notes (Apple2ts)

## Overview
This document records the engineering process and troubleshooting steps taken during the implementation of Apple IIgs (65816 CPU) support in the `apple2ts` emulator.

## Core Issues Discovered & Resolved

### 1. 65816 CPU PC Calculation Bug
**Issue**: When executing Immediate mode instructions (e.g. `REP #$30`), the 65816 CPU (`cpu65816.ts`) was incorrectly fetching 2 bytes in 8-bit mode or 1 byte in 16-bit mode, due to a flipped logic flag.
**Fix**: Corrected the `addrImmediate` function to correctly check if the accumulator/index registers are in 8-bit mode (fetching 1 byte) or 16-bit mode (fetching 2 bytes) and increment the PC accordingly.

### 2. ROM Bank Mapping for Vectors
**Issue**: The Apple IIgs vectors (e.g. `$FFFC` for reset, `$FFE6` for COP/BRK) were not being correctly mapped to the `gsROM`. The code was reading from `$00:FFFC` instead of `$FF:FFFC`.
**Fix**: Updated `memGet24` in `memory.ts` to correctly map Bank `FE` and `FF` directly to `gsROM` so that the CPU can fetch the correct boot vectors.

### 3. Missing Cycle Count Increment (The "Frozen Time" Bug)
**Issue**: The system would get stuck in infinite loops at boot (showing `*`). Analysis revealed that `s6502.cycleCount` was never being incremented when executing 65816 instructions in `motherboard.ts`. As a result, time was frozen from the emulator's perspective, meaning hardware timers and VBL interrupts were never fired.
**Fix**: Added `s6502.cycleCount += cycles` after `cpu.processInstruction()` in `motherboard.ts` to ensure time advances properly.

### 4. ADB & RTC (Real-Time Clock) Initialization Hangs
**Issue**: The Apple IIgs OS initialization sequence expects the hardware (specifically the ADB and Clock) to respond with specific status bits. 
- **RTC ($C034)**: The OS writes a command and loops waiting for Bit 7 (Operation in Progress) to become `0`.
- **ADB ($C027)**: The OS waits for Bit 5 to become `1` to indicate the controller is ready.
Because we had not implemented the IIgs-specific I/O hardware, these registers returned `0`, causing the boot process to either time out or loop forever.
**Fix**: Mocked `$C020-$C04F` in `memory.ts` using a dedicated `iigsRegisters` array. Specifically:
- Reading `$C034` now clears Bit 7 (`val &= ~0x80`) to simulate the clock operation finishing.
- Reading `$C027` now forces Bit 5 to `1` (`val | 0x20`) to prevent the ADB timeout.

### 5. The "Sea of FF" Crash Loop
**Issue**: After fixing the cycle count, the CPU would crash into an infinite loop of `FF` opcodes in Bank `E1`.
**Cause**: Before the OS had a chance to fully initialize the Toolbox (which sets up pointers in Zero Page like `$0004`), the ADB initialization would time out (because Bit 5 of `$C027` was 0). The timeout caused the OS to try to display a "Fatal System Error 0911" via the Toolbox. However, because VBL interrupts were now firing, the CPU was interrupted and jumped to the uninitialized interrupt handler (`$E10010`), leading to a corrupted stack and an infinite `BRK` loop in garbage memory.
**Fix**: Fixing the ADB Status Bit 5 (as described in #4) allowed the OS to bypass the timeout, preventing it from invoking the uninitialized Toolbox and avoiding the crash loop.

### 6. Stack Wrapping Bug in JSL/RTL (The "Wrong Return Address" Bug)
**Issue**: RTL (Return from Subroutine Long) was returning to wrong addresses, causing crashes. Example: RTL at `ff:859d` returned to `ff:0005` instead of the correct address.
**Cause**: The 65816 has special stack behavior for its native instructions (JSL, RTL, PHD, PLD, PHB, PLB, PHK, PEA, PEI, PER). In Emulation mode, the stack pointer is normally constrained to page 1 (`$01xx`). However, these 65816-specific instructions need to temporarily push/pop data that might span across the page boundary. They should:
1. Allow the stack pointer to move outside page 1 during the multi-byte operation
2. Re-normalize it back to page 1 only after the entire operation completes

Our original implementation used `push8`/`pop8`/`push16`/`pop16` which enforced page-1 wrapping after **every byte**, causing the high byte of a 16-bit push to wrap to `$01FF` instead of `$0100`, corrupting return addresses.
**Fix**: Added `push8Wide`/`pop8Wide`/`push16Wide`/`pop16Wide` functions that don't wrap during operation, and call `normaliseStack()` only after the complete instruction finishes. This matches the web-a2e reference implementation.

### 7. The "Infinite RTL Loop" Misconception — RESOLVED
**Analysis**: The trace that appeared to show an "infinite RTL loop" at `ff:b5e0` was actually the standard ROM string output routine (`COUT1` / `$FDF0`) being called repeatedly to print the characters of the startup banner ("Apple IIgs", "Copyright Apple Computer, Inc.", "ROM Version 01") onto the screen. Once execution was allowed to continue without premature aborts, the entire banner rendered correctly.

### 8. $C046 Bit 7 & The Self-Test / Warm-Reset Misconception — RESOLVED
**Issue**: Previously, it was believed that the ROM's check at `ff:8552` (`lda $c046` / `bmi $8549`) was a "boot gate" requiring `$C046` bit 7 to be set to proceed. This led to hacks like `iigsRegisters[0x41] = 0x08` during boot.
**Root cause & Discovery**: Cross-referencing `c:\dev\gssquared` (`src/display/display.cpp:564` and `Docs/DevelopLog.md:8026`) revealed:
`/* C046 - INTFLAG: the selftest / reset code checks bit 7, if 1, it jumps into selftest */`
At cold boot / reset, `$C046` bit 7 must be **0** (no interrupts pending and enabled). If bit 7 is set to 1 at power-on:
1. The ROM branches to `ff:8549` (`jsr $a1b8`, the built-in diagnostic self-test).
2. The self-test assumes a warm reset occurred, checks the warm-reset signature at `$0310`, fails, and displays **`System Bad: GGGG0000`**.
**Fix**: Reset `iigsRegisters[0x41] = 0x00` at power-on / reset. `$C046` bit 7 correctly evaluates to 0 during cold boot, allowing the ROM to fall through to `ff:8557` and proceed directly into the true cold boot sequence.

### 9. ADB Register Wiring ($C024-$C027) — RESOLVED
**Issue**: The ADB controller was only partially wired. `$C026`/`$C027` reads/writes still used the fake `iigsRegisters[0x26]/[0x27]` array (the "pretend ADB responds" stub from issue #4), instead of the real `IIGSADB` controller from `iigs_adb.ts`.
**Fix**: Wired `$C026` to `iigsADB.readData()` / `iigsADB.writeCommand(value)`, and `$C027` to `iigsADB.readStatus()` / `iigsADB.writeStatus(value)`. Removed the fake stubs.

### 10. Removal of False "STUCK TRACE" (3,000,000 Cycle Trap) — RESOLVED
**Issue**: The emulator logged a "STUCK TRACE" error if `s6502.cycleCount > 3000000`.
**Root cause**: At 2.8 MHz, 3,000,000 cycles is barely ~1 second of machine time. Normal Apple IIgs memory checking and POST take 1-2 seconds. The emulator was not stuck; it was just in the middle of standard boot diagnostics.
**Fix**: Removed the 3M cycle stuck logger from `motherboard.ts`.

### 11. IWM (Integrated Woz Machine) Mode & Status Registers ($C0E0-$C0EF) — RESOLVED
**Issue**: During cold boot, after drawing the banner, the CPU looped infinitely at `ff:6a5f`.
**Root cause**: ROM routine `SELIWM` at `ff:6a54`:
```assembly
6a57: LDA $C0E8   ; Motor/Enable off
6a5a: LDA $C0ED   ; Q6 on
6a5f: TYA
6a60: STA $C0EF   ; Q7 on (with Q6 on, writes IWM mode register)
6a63: TYA
6a64: EOR $C0EE   ; Q7 off (with Q6 on, reads IWM status register)
6a67: AND #$1F
6a69: BNE $6A5F   ; Loop until mode matches status bits 0-4
```
Because `$C0E0-$C0EF` had no IWM handler in `apple2ts`, reading `$C0EE` returned unmapped bus noise and `$C0EF` writes were ignored, spinning forever.
**Fix**: Implemented IWM softswitch decoding in `memory.ts` mirroring `gssquared` (`IWM2.hpp`) and `web-a2e` (`iwm.cpp`):
- Tracks `iwmQ6`, `iwmQ7`, `iwmMotorOn`, `iwmDriveSelect`, `iwmMode`.
- Even read with `Q6=1, Q7=0` (e.g. `$C0EE`) returns `(iwmMode & 0x1F) | (iwmMotorOn ? 0x20 : 0)`.
- Odd write with `Q6=1, Q7=1` (e.g. `$C0EF`) updates `iwmMode = value & 0x1F` when motor is off.
- `SELIWM` matches on the first iteration and exits immediately.

### 12. STATE Register ($C068) & Fast Language Card / ROM Switching — RESOLVED
**Issue**: After device scanning, the CPU executed RTL at `ff:9ffb` returning to `00:f8b0`, where it immediately hit opcode `FF` and crashed into an infinite loop of `FF` opcodes in bank 00.
**Root cause**: The ROM routine at `ff:1e13` sets speed and writes `A=0x0C` to the State Register `$C068`:
`1e1e: STA $C068`
Bit 3 of `$C068` is `STATE_RDROM` (1 = read ROM, 0 = read language card RAM). Because `$C068` was unmapped in `apple2ts`, this write was dropped. Consequently, `BSRREADRAM` remained set to true, causing the CPU to fetch from bank 00 RAM (which contained power-on 0xFF) instead of the Mega II Monitor ROM at `00:F8B0` (`PLA`, `STA $C036`...).
**Fix**:
1. Implemented `$C068` reads and writes in `memory.ts` matching `web-a2e` (`setStateRegister`):
   - Updates `ALTZP`, `PAGE2`, `RAMRD`, `RAMWRT`, `INTCXROM`.
   - Maps language card bank and read/write enables (`BSRREADRAM`, `BSRBANK2`) and calls `updateAddressTables()`.
2. In `doSetRom("APPLE2GS")`, seeded `ROMmemoryStart` with the upper 16KB of Bank FF (`gsSystemROM[0x1C000..0x20000]`).
**Result**: The RTL cleanly returns to `00:f8b0`, executes `PLA`, restores the speed register, and displays:
```text
Check startup device!
```
with the animated barber pole scan bar, identical to real Apple IIgs hardware!

### 13. Real-Time Clock & Battery RAM State Machine ($C033/$C034) — RESOLVED
**Issue**: IIgs warm-reset and clock routines verify specific signatures in battery RAM (e.g. copying BRAM `$0B0-$0B7` to `$0310-$0317` and verifying signature `CB D2 C7 C2 10 A2 E8 03`). Previous stubs lacked the command/address/data state machine.
**Fix**: Ported the verbatim RTC and 256-byte BRAM state machine from `c:\dev\gssquared\src\devices\rtc\RTC_PRAM.hpp` into `src/worker/iigs_clock.ts`:
- Two-byte command parsing for 256-byte BRAM (`0b00111000`).
- Seconds counter registers with real-time Unix epoch translation.
- Pre-seeded warm-reset signature at BRAM `$B0-$B7` to ensure self-test and reset validation always succeed.

### 14. UI & In-Browser Boot Verification — RESOLVED
**Enhancements & Verification**:
- **URL Parameter Support**: Extended `src/ui/inputparams.ts` to recognize `?machine=apple2gs` and `?boot=true`, enabling direct deep-linking and automated cold boots into Apple IIgs mode.
- **Startup Mode Indicator**: Updated `src/ui/panels/help/startuptextpage.ts` to display "Apple IIgs mode" on idle.
- **Chrome In-Browser Execution**: Verified live boot in Chrome headlessly via CDP. The emulator boots through cold POST, clears memory, displays the startup banner, and reaches the animated "Check startup device!" scan bar at native speed with zero unhandled exceptions.

## Primary Reference Implementation: GSSquared
> [!WARNING]
> **Avoid relying on `web-a2e` as an authoritative core reference!**
> `web-a2e` contains several incomplete or incorrect register behaviors (such as missing/flawed cold reset states, incomplete IWM softswitches, and misleading status flags). Trying to copy its hacks previously caused the self-test `System Bad: GGGG0000` crash loop.
>
> **Always use `c:\dev\gssquared` as the gold standard** — it is a production-grade, highly cycle-accurate emulator with a thorough `DevelopLog.md` and complete hardware implementations.

### Key Hardware Reference Insights from GSSquared

### $C046 Bit 7 & Cold Boot Reset
- In `c:\dev\gssquared\Docs\DevelopLog.md:8026`: Bit 7 of `$C046` indicates interrupt state. The ROM checks bit 7 on reset; if `1`, it assumes a warm reset occurred and jumps to the built-in self-test (`$A1B8`), failing the warm-reset signature at `$0310`.
- Cold boot **must have bit 7 = 0**.

### IWM ($C0E0-$C0EF) Softswitches
- Implemented strictly per `c:\dev\gssquared\src\devices\iwm\IWM2.hpp`:
  - Even read with Q6=1, Q7=0 (`$C0EE`) returns `iwmMode & 0x1F`.
  - Odd write with Q6=1, Q7=1 (`$C0EF`) latches `iwmMode = value & 0x1F`.
  - This instantly resolves the ROM's `SELIWM` polling loop at `ff:6a54`.

### Clock & 256-byte Battery RAM ($C033/$C034)
- Ported verbatim from `c:\dev\gssquared\src\devices\rtc\RTC_PRAM.hpp`:
  - $C033: Clock data register.
  - $C034: Clock control register.
  - 256-byte BRAM with 2-byte command framing (`0b00111000`).
  - Pre-seeded signature at BRAM `$B0-$B7` matching ROM `$FF7350-$FF7357` (`CB D2 C7 C2 10 A2 E8 03`).

### $C071-$C07F: BRK/IRQ Handler Firmware
- **Not I/O registers!** This region contains actual 8-bit firmware code.
- The IIgs BRK/IRQ vectors ($00:FFE6, $00:FFFE) point here (e.g., $C071 for BRK, $C074 for IRQ).
- Firmware code sets status flags, then JML (Jump Long) to the 16-bit interrupt manager in Bank $E1.
- **Must read from Bank $FF ROM**, not from memory or Bus.

### ADB ($C024-$C027) Registers
- $C024: ADB Mouse Data
- $C025: ADB Modifiers (keyboard modifiers)
- $C026: ADB Data (command/response queue)
- $C027: ADB Status - Bit 5 must be 1 during boot (controller ready).
- Wired to `iigsADB` instance in `iigs_adb.ts`.

### 15. Slot 7 SmartPort/Hard Drive Booting ($C02D & specialJumpTable Hook) — RESOLVED
**Issue**: Mounting a bootable Hard Drive (HDV) in Slot 7 did not boot; the machine stayed at "Check startup device!".
**Root causes**:
1. **Hardcoded Internal ROM Override**: In `memGet24` (`memory.ts`), `$C100-$CFFF` in Bank 00 was mapped unconditionally to internal `gsSystemROM`, preventing the CPU from ever seeing the Slot 7 card ROM driver at `$C700-$C7FF`.
2. **Missing Slot Register `$C02D` (SLTROMSEL)**: In Apple IIgs hardware, `$C02D` controls whether each slot is mapped to peripheral card (bit=1) or internal ROM (bit=0). Default is `0b11110110` (slots 7, 6, 5, 4, 2, 1 = card).
3. **`specialJumpTable` Disconnected in `cpu65816.ts`**: The SmartPort/HDV driver uses special hooks at `$C7C0` and `$C7C3` (`processHardDriveBlockAccess` and `processSmartPortAccess`), but `CPU65816` never checked `specialJumpTable`, and its registers (`A, X, Y, S, P`) were isolated from `s6502`.
**Fix**:
1. Implemented `$C02D` read/write in `memory.ts` and updated `memGet24` so that when `!SWITCHES.INTCXROM.isSet` and `(iigsSlotRegister & (1 << slot)) !== 0`, the slot space routes to `memGet(offset, false)`.
2. In `cpu65816.ts`, added `specialJumpTable` checks before opcode fetch in Bank 00, seamlessly syncing CPU registers between `CPU65816` and `s6502`.
**Result**: The Apple IIgs cold boot slot scan detects Slot 7 (`$C701=0x20`), jumps to `$C700`, loads blocks 0 and 1 into `$0800/$0A00` via the block hook, and executes the ProDOS bootloader at `$0801`. Verified with `gs_hdd_boot.test.ts`.

### 16. Ctrl-Reset to Applesoft BASIC Prompt `]` — RESOLVED
**Issue**: Pressing Ctrl-Reset from the "Check startup device!" screen re-looped into the cold boot slot scan instead of dropping into the Applesoft BASIC prompt `]`.
**Root cause**:
1. In `motherboard.ts`, `doReset()` was calling `iigsInitInterrupts()`, which wiped the first 8KB of Bank 00 memory (`memSet24(0x000000 + i, 0)`).
2. The ROM's cold boot sequence had already initialized the Apple II warm reset vector at `$03F2-$03F4` to `00 E0 45` (`$03F4 = $03F3 ^ $A5 = $E0 ^ $A5 = $45`).
3. Wiping low memory with 0 destroyed `$03F2-$03F4`. When the reset vector at `FF:FA62` executed `LDA $03F3; EOR #$A5; CMP $03F4; BNE $FAA6`, the check failed (`0 ^ $A5 = $A5 != 0`), causing the ROM to branch to the cold boot slot scan at `$FAA6`.
**Fix**:
- Moved `iigsInitInterrupts()` to run only during cold boot (`doBoot()` and machine type switch), leaving `doReset()` (Ctrl-Reset) to preserve memory contents, zero page, and `$03F2-$03F4`.
### 17. Apple IIgs MouseText Decoding (Open Apple / Closed Apple Startup Bar) — RESOLVED
**Issue**: On the Apple IIgs "Check startup device!" screen, the animated scan bar showed an inverse `@` / `A` and inverse `L` characters instead of the Open Apple () and Closed Apple () glyphs and horizontal lines.
**Root cause**:
- In `src/ui/graphics.ts:165` and `src/ui/copycanvas.ts:40`, `hasMouseText` was hardcoded to `machineName === "APPLE2EE"`.
- For `APPLE2GS`, `hasMouseText` evaluated to `false`.
- When `hasMouseText` is false:
  1. `convertTextPageValueToASCII` does not translate MouseText characters in the `$40-$5F` range (shifted by 64 to `0xE080-0xE09F` in the PUA font `PrintChar21`). Instead, it treats them as plain ASCII (`$40` = `@`, `$41` = `A`, `$4C` = `L`).
  2. `doInverse` treats all codes `<= 127` as inverse when MouseText is disabled, drawing an inverse background rectangle over the character.
**Fix**:
- Updated `hasMouseText` in both `src/ui/graphics.ts` and `src/ui/copycanvas.ts` to `machineName === "APPLE2EE" || machineName === "APPLE2GS"`.
- In `src/ui/inputparams.ts`, dispatched `passSetSlotConfig(nextSlotConfig)` to ensure custom slot parameters from URL query strings are properly sent to the worker.
**Result**: The scan bar properly renders the authentic MouseText Open Apple (`0xE080`) and Solid Apple (`0xE081`) glyphs and horizontal line characters (`0xE08C`) against the blue screen, exactly matching Apple IIgs ROM 01 hardware. Verified with `copycanvas.test.ts`.

### 18. Apple IIgs Slot Management & Mockingboard Compatibility — RESOLVED
**Issue**: When Apple IIgs (`APPLE2GS`) was selected:
1. Slot Manager retained Apple IIe cards (such as Aux 64KB in Slot 3, Mouse card in Slot 5, etc.), which violate Apple IIgs hardware architecture.
2. In `configureMachine()`, slot configuration had an early return for IIgs that skipped Slot 4 Mockingboard and Slot 7 SmartPort hard drive setup.
3. 65816 CPU was not running peripheral device `cycleCountCallbacks`, preventing Mockingboard 6522 VIA timers from decrementing, and was not sampling peripheral hardware interrupts (`s6502.flagIRQ !== 0`).
**Fix**:
1. **Isolated Slot Definitions & Sanitization**:
   - Created `src/common/slot_options.ts` defining allowed cards per machine:
     - Slot 1: Built-in Printer (`none`) or `ssc`
     - Slot 2: Built-in Modem (`none`)
     - Slot 3: Built-in 80 Columns / Video (Strictly `none`; NO aux/RamWorks/VidHD cards)
     - Slot 4: Built-in Mouse (`none`) or `mockingboard`
     - Slot 5: Built-in 3.5" SmartPort Drive (Strictly `none`; NO Apple II mouse card)
     - Slot 6: Built-in 5.25" Drive (`none`) or `disk2`
     - Slot 7: Hard Drive / SmartPort (`none` or `smartport`)
   - Added `DEFAULT_SLOT_CONFIG_GS` in `utility.ts` with slots 1-6 set to `none` and slot 7 to `smartport`.
   - Added `sanitizeSlotConfig` to strip incompatible cards when loading or switching machine profiles.
2. **UI & Storage Integration**:
   - Updated `src/ui/devices/machineconfig.tsx`, `src/ui/localstorage.ts`, and `src/ui/controls/linkbuilder.tsx` so selecting Apple IIgs resets slots to `DEFAULT_SLOT_CONFIG_GS`.
3. **Motherboard & Hardware Wiring**:
   - In `src/worker/motherboard.ts` `configureMachine()`:
     - Configured Slot 1 (`ssc`), Slot 4 (`mockingboard`), Slot 6 (`disk2`), and Slot 7 (`smartport`).
     - Dynamically synchronized `$C02D` (`SLTROMSEL`) with active expansion cards.
     - Kept internal aux RAM enabled (`setAuxCardEnabled(true)`) while disabling slot 3 card ROMs.
   - In execution loop: invoked `processCycleCountCallbacks()` every instruction in IIgs mode to advance VIA timers.
   - In `src/worker/cpu65816.ts`: sampled `s6502.flagIRQ !== 0` to trigger native hardware IRQs and wake `WAI`.
   - In `src/worker/memory.ts`: extended `memGet24` slot and language card ROM mapping to Banks E0 and E1.
**Result**: Apple IIgs slots strictly conform to hardware specs. Mockingboard in Slot 4 correctly ticks 6522 VIA timers and triggers IRQs. Verified with `gs_slots_mockingboard.test.ts`.

### 19. Apple IIgs Speed Modes (Normal 1.02 MHz, 2.8 MHz, 7.1 MHz, Fast 14.3 MHz) — RESOLVED
**Requirement**:
- Normal: 1.02 MHz
- 2 MHz setting: 2.8 MHz (native Apple IIgs speed)
- 3 MHz setting: 7.1 MHz
- Fast: 14.3 MHz (5x speed)
**Fix**:
- Updated `SPEED_MODES` and UI dropdown in `src/ui/controls/speeddropdown.tsx` to dynamically display the IIgs speeds when `machineName === "APPLE2GS"`.
- Updated `src/ui/controls/linkbuilder.tsx` and MCP settings (`src/ui/mcp/mcp_tool_settings.ts`, `src/ui/mcp/mcp_resources.ts`) to recognize the 2.8 MHz and 7.1 MHz speed definitions.
- Verified with `src/worker/gs_speed.test.ts`.

### 20. Bank 01 vs Bank E1 Separation & Toolbox Vector Dispatchers — RESOLVED
**Issue**: When ProDOS booted, it initialized Language Card RAM and called the 65816 Toolbox (`JSL $E10000`) for tool `$0D03` (`ReadTimeHex`). Additionally, ProDOS called `AUXMOVE` (`MVN $01, $00`), which previously overwrote Toolbox vector dispatchers because Bank 01 and Bank E1 were aliased to the same memory buffer.
**Fix**:
1. Dedicated `megaIIAux = new Uint8Array(65536)` allocated for Bank E1, cleanly isolating Mega II Aux RAM from 65816 Fast RAM Bank 01 (`memory[RamWorksMemoryStart + offset]`).
2. Populated Apple IIgs Toolbox dispatchers in `iigsInitInterrupts()`:
   - `$E10000..$E1000F`: JML jump tables matching ROM `$FE0051..$FE005F` (`$FE00AF`, `$FE00A3`, `$FE0075`, `$FE0069`).
   - `$E10180..$E10187`: Toolbox vector handlers matching ROM `$FE0061..$FE0067`.
   - `$E103C0..$E103CA`: Tool Locator table pointers initialized to ROM Tool tables (`$FE012F`, `$FE01EF`, `$FE012F`).
3. Enabled Super Hi-Res ($2000-$9FFF) shadowing from Bank 01 to `megaIIAux` and updated `getShr()` to render directly from `megaIIAux`.

### 21. Slot 3 80-Column ROM & $C800-$CFFF Strobe Management (A2DeskTop DHIRES Boot) — RESOLVED
**Issue**: Loading `A2DeskTop-VERA.hdv` from Slot 7 loaded ProDOS and read blocks up to block 0x40 (`DESKTOP.SYSTEM`). When `DESKTOP.SYSTEM` initialized 80-column mode via `JSR $C300`, it branched to `$C366` (`JMP $C803`). However, `$C803` read from Slot 7 peripheral C8 space instead of motherboard 80-column ROM, popping unbalanced return addresses off the stack and jumping to `00:0100` (`BRK 00`).
**Root cause**:
- In Apple II hardware (Sather UtA2E 5-28 and GSSquared `mmu_iie.cpp`), any access to `$C100-$C7FF` triggers the peripheral/motherboard C8 scheme:
  - If `!SWITCHES.SLOTC3ROM.isSet`, accessing Slot 3 (`$C3xx`) asserts `INTC8ROM` = 1, assigning `$C800-$CFFF` to internal motherboard ROM.
  - Accessing `$CFFF` resets `INTC8ROM` back to 0.
- `memGet24` was bypassing `manageC800(slot)` and `manageC800(0xFF)`, leaving `INTC8ROM` unasserted.
**Fix**:
- Updated `memGet24` in `src/worker/memory.ts` to invoke `manageC800(slot)` for `$C100-$C7FF` and `manageC800(0xFF)` for `$CFFF`.
- Corrected `getPreferenceMachineName` in `src/ui/localstorage.ts` and imported `passSetSlotConfig` in `src/ui/inputparams.ts`.
**Result**: A2DeskTop cleanly enters 80-column firmware, relocates into Aux memory, displays `Starting Apple IIgs DeskTop...`, transitions into Double Hi-Res graphics (`TEXT=false`, `HIRES=true`, `DHIRES=true`, `80COL=true`), and begins its event loop. Verified with `gs_trace_boot.test.ts`.

## Debugging Techniques Used
- **Instruction Tracing**: Added a circular buffer in `motherboard.ts` to trace instructions when debugging specific loops.
- **ROM Inspection**: Disassembled portions of `gsROM` via Node.js helper scripts to identify hardware polling loops (such as `SELIWM` and diagnostic entry points).
- **GSSquared Cross-Referencing**: Verified exact register logic and development log notes directly against `c:\dev\gssquared`.
- **CDP In-Browser Screenshots**: Automated Chrome screenshot capture via DevTools Protocol to visually verify boot screens.

## Key Files Modified
- `src/worker/cpu65816.ts`: 65816 CPU emulation, stack normalization, IRQ sampling, peripheral `specialJumpTable` execution, 65816 ADC/SBC decimal mode.
- `src/worker/memory.ts`: Memory mapping for Bank E0/E1, dedicated `megaIIAux` allocation, Bank FE/FF ROM, IWM registers ($C0E0-$C0EF), State Register ($C068), Slot Register ($C02D), interrupt flags ($C046), and slot C800 strobe management.
- `src/worker/iigs_adb.ts`: ADB controller emulation.
- `src/worker/iigs_clock.ts`: Full RTC and 256-byte Battery RAM state machine from `gssquared`.
- `src/worker/motherboard.ts`: CPU cycle accounting, VBL→IRQ gated triggering for IIgs, separation of cold boot memory init from warm reset.
- `src/ui/graphics.ts`: Enabled MouseText decoding and inverse-attribute handling for `APPLE2GS`.
- `src/ui/copycanvas.ts`: Enabled MouseText support for `APPLE2GS` during screen copying.
- `src/ui/inputparams.ts`: URL query parameter support for `?machine=apple2gs`, `?boot=true`, and syncing slot changes to the worker.
- `src/ui/controls/speeddropdown.tsx`: Speed dropdown display mappings for IIgs (1.02 MHz, 2.8 MHz, 7.1 MHz, 14.3 MHz).
- `src/ui/localstorage.ts`: Persistence for machine profiles and slot sanitization.
- `src/worker/gs_speed.test.ts`: Apple IIgs speed modes test.
- `src/worker/gs_trace_boot.test.ts`: Regression test verifying ProDOS 8 and A2DeskTop boot into Double Hi-Res graphics.

## Reference Materials
- **GSSquared**: `c:\dev\gssquared\` (Primary reference: `RTC_PRAM.hpp`, `IWM2.hpp`, `display.cpp`, `DevelopLog.md`, `mmu_iie.cpp`, `computer.cpp`)
- **Apple IIgs Hardware Reference Manual**: Official hardware specifications



