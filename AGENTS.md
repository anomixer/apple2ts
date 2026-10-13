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

### 22. Mount Disk & Reboot Crash (Bank E1 $E115FE & RTC State Machine on Reboot) — RESOLVED
**Issue**: Mounting `A2DeskTop-1.5.po` in Slot 7 Drive 1 while the emulator was running at "Check startup device!" and then rebooting crashed into the "Sea of FF" at `E1:1688`.
**Root causes**:
1. **`megaIIAux` Power-on / Reset Fill Value**:
   - In `src/worker/memory.ts`, `memoryReset()` filled `megaIIAux` (Bank E1) with `0xFF`.
   - The Apple IIgs ROM routine at `FF:01F1` executes `LDA $E115FE; BPL $0205; JSL $E11688`.
   - When `$E115FE` held `0xFFFF` (negative bit 15 set), the ROM bypassed normal initialization at `$0205` and jumped directly to `$E11688`. Since `$E11688` was uninitialized `0xFF`, the CPU crashed into an infinite loop of opcodes `0xFF`!
   - On real hardware (and in `gssquared`), Bank E1 Aux RAM powers up with `0x00` / pattern `0xCC 0xCC 0x00 0x00`, where `$15FE` has bit 15 = 0.
2. **Missing RTC / BRAM State Machine Reset (`IIgsClock.reset`)**:
   - `iigsClock` sits on the serial bus ($C033/$C034). If the system was rebooted mid-transaction, subsequent BRAM reads failed framing, causing the ROM's Battery RAM checksum check at `FF:B583` (`CPX $03BC; CMP $03BE`) to fail with `SEC; RTL`, branching to the fatal error handler (`JML $00FA56`).
**Fix**:
1. Changed `megaIIAux.fill(0xFF)` to `megaIIAux.fill(0x00)` in `memoryReset()` and `iigsInitInterrupts()`.
2. Implemented `reset(coldBoot = false)` on `IIgsClock` in `src/worker/iigs_clock.ts` to reset transaction state, control register, and restore cold boot signature.
3. Added `src/worker/gs_desktop15_boot.test.ts` verifying mounting `c:\dev\emu\ap2\A2DeskTop-1.5.po` in Slot 7 Drive 1 after initial boot and rebooting into A2DeskTop Double Hi-Res graphics.

### 23. Apple IIgs GS/OS 6.0.1 Boot to Finder Desktop (Language Card Shadowing & Fatal Error 0308) — RESOLVED
**Issue**: Booting Apple IIgs GS/OS 6.0.1 (`GSOS601.po`) crashed during driver loading with `Fatal system error -> 0308` (`hbQueueBadErr`).
**Root causes**:
1. **False Language Card Shadowing from Fast RAM Bank 01 to Mega II Bank E1**:
   - In `src/worker/memory.ts`, `memSet24` for Bank 01 (`bank === 0x01 && offset >= 0xD000`) had a rogue write: `megaIIAux[targetOffset] = data`.
   - In Apple IIgs architecture (`c:\dev\gssquared\src\mmus\mmu_iigs.hpp` `shadow_is_enabled`), Language Card ($D000-$FFFF) is **never shadowed** into Mega II memory. Fast RAM Banks 00/01 and Mega II Banks E0/E1 maintain independent Language Card RAM spaces.
   - During boot, `START.GS.OS` stored the startup volume prefix (Prefix #32, e.g. `MDVOL2`) at `$E1:D6F7`.
   - Subsequent `MVN $01, $7E` relocations unpacking drivers into Fast RAM Bank 01 clobbered `megaIIAux[0xC6F7]` (Bank 1 of Language Card) with code opcode `0x5C 0xA0` (`JML`).
   - When `GS.OS` loaded Prefix #32 at `00:F569` (`LDA [$FC]` pointing to `$E1:D6F7`), it read length `0xA05C` (41,052 bytes!) instead of the actual length byte `0x0007`.
   - The subsequent memory copy loop (`TAX; LDA [$FC],Y; STA [$E8],Y; INY; DEX; BNE`) overwrote 41,052 bytes of system memory, clobbering the VBL task queue signature `$A55A` at `$007441`. The ROM VBL handler detected the corrupted signature and invoked `SysFailMgr` with Error 0308.
2. **Bank E0 / Bank 00 Separation**:
   - Bank E0 previously aliased to Bank 00. Dedicated `megaIIMain` (64KB) implemented for Bank E0, cleanly isolating Mega II Main RAM from Fast RAM Bank 00 while mirroring Text/Hi-Res shadowing per `$C035`.
**Fix**:
- Removed the rogue `megaIIAux` write from Bank 01's Language Card handler in `src/worker/memory.ts`.
- Bank 01 writes only to `memory[RamWorksMemoryStart + targetOffset]`. Direct writes to Bank E1 (`bank === 0xE1`) remain the sole writer to `megaIIAux` Language Card RAM.
**Result**:
- Prefix #32 at `$E1:D6F7` retains the valid 7-byte string `MDVOL2`.
- The string copy loop transfers exactly 7 bytes without corrupting `$007441`.
- Fatal Error 0308 is completely eliminated.
- GS/OS 6.0.1 successfully loads `PRO.FST`, `DRIVERS`, `SYSTEM.SETUP`, `TOOLS` (`TOOL034`), control panels, and launches `/SYSTEM/START` (the official Apple IIgs Finder).
- Finder renders the full Super Hi-Res desktop with menu bar, clock, volume icon, trash can, and dialog window. Verified in `test_gsos601.test.ts`.

### 24. SmartPort Device Reporting (Spurious "can't read this disk" for empty drives) — RESOLVED
**Issue**: After booting GS/OS 6.0.1, the Finder immediately showed a modal
`GS/OS can't read this disk (in device .DEV2). Do you want to initialize it?`
dialog. Slot 7 drive 2 was empty, but GS/OS still enumerated and probed it.
**Root cause**: `handleSmartPortDeviceStatus` / `handleSmartPortDeviceInformationBlock`
in `src/worker/devices/harddrivedata.ts` lied about the hardware:
- Unit 0 (driver status) always advertised `2` SmartPort devices.
- Units 1 and 2 always reported status byte `0xF0` ("device on line / disk in
  drive", bit 4 set) even when no media was mounted, so the OS dutifully tried
  to read blocks from an empty drive and reported the failure to the user.
- The DIB advertised device subtype `$20`, and the block count was written into
  bytes that the SmartPort spec defines as the block size.
**Fix** (values cross-checked against `gssquared/src/devices/pdblock3/pdblock3.cpp`):
- Added `SP_STATUS_ONLINE = 0b1111_0000`, `SP_STATUS_WRITEPROT = 0b1011_0100`,
  `SP_STATUS_OFFLINE = 0b1110_0000` and return `SP_STATUS_OFFLINE` whenever the
  unit has no media, so GS/OS skips it.
- Unit 0 keeps reporting the card's maximum unit count (`SP_MAX_UNIT`), matching
  gssquared's `PDB3_MAX_UNITS`; emptiness is expressed through the status byte,
  not by shrinking the count.
- Write-protect is now honoured via `getHardDriveState(unit).isWriteProtected`.
- Device subtype for a hard disk is `0x20` (3.5" drive is `0x40`); the extended
  SmartPort bits (`0xC0`) used by gssquared's BAZFAST3 DIB are deliberately NOT
  set — see below.
- Added `fixBlockCount32MB()`: 0x10000 blocks (32MB) is unrepresentable in 16
  bits and must report 0xFFFF, as gssquared does.
- Implemented the missing SmartPort commands: WriteBlock (case 2), Format
  rejection (case 3) and Control/Eject (case 4, returns success for fixed disks
  per SmartPort TN #2). Error codes now use the ProDOS-16 set from gssquared's
  `pdb_structures.hpp`: 0x27 I/O, 0x28 no device, 0x2B write-protected, 0x2F
  device offline.
**Note — extended SmartPort**: advertising subtype `$C0` makes GS/OS switch to
the *extended* command set, whose parameter lists carry a 3-byte pointer. We only
decode the standard 2-byte form in `processSmartPortAccess()`, so enabling it
stalls the boot on the "Welcome to the IIgs" screen. Do not set those bits
until the extended parameter-list parsing exists.

### 25. GS/OS Boot Stall in the Browser (Stale `cpu.irqPending`) — RESOLVED
**Issue**: `GSOS601.po` mounted to Slot 7 drive 1 booted all the way to the GS/OS
welcome screen but never progressed to the Finder, then dropped back into the
ROM boot loop ("Check startup device!"). This only happened in the real browser
worker; the jest harness booted to the Finder every time.
**Root cause**: In the run loop in `src/worker/motherboard.ts`, the IIgs IRQ line
was only re-evaluated **inside the vertical-blanking window**:
```
if (cycleInFrame < vblCycles) { if (SWITCHES.VBLINV.isSet) { iigsSignalVbl(); ...
  if (iigsInterruptPending()) cpu.irq() else cpu.clearIrq() } }
```
On real hardware the IRQ line is **level driven** by `$C046` bit 7 ("a source is
pending AND enabled"), so it drops the instant the handler acknowledges via
`$C047` — regardless of whether we are inside the VBL window. Sampling only
during VBL let `cpu.irqPending` stay asserted across the long non-VBL portion of
each frame. The next time GS/OS cleared its I flag (at `00:6890`, cycle ~940K),
the CPU took a spurious hardware IRQ into `$C074` (the ROM's IRQ firmware, which
`JML`s to the Bank $E1 interrupt manager), and the machine never returned to the
boot path.
**Fix**: Move the `iigsInterruptPending() ? cpu.irq() : cpu.clearIrq()` update out
of the VBL branch so the IRQ line is re-evaluated every instruction, matching the
level-triggered `$C046` behaviour.
**Verification**:
- `src/worker/gsos_boot.test.ts` boots `GSOS601.po` cold and asserts the
  Super Hi-Res page 1 is a fully drawn Finder desktop (top menu-bar row and
  bottom trash-can row both non-empty), which the welcome screen does not satisfy.
- Verified in headless Chrome against the Vite dev server: the Finder desktop
  renders with menu bar, clock, `MDVOL2`, `APPLEDISK5 25A/25B`, `GSHK` and Trash.

### 26. Apple IIgs Floppy Support: IWM Data Path & Slot 5 (3.5") — PARTIAL
**Context**: The Apple IIgs has no Disk II card. Both floppy drives are
motherboard hardware reached through the Integrated Woz Machine (IWM) at
`$C0E0-$C0EF`. Slot 6 is the 5.25" pair and **slot 5 is the 3.5" pair**
(gssquared `IWM2.hpp`: `drives[0]` = `Floppy525_woz` in slot 6,
`drives[1]` = `Floppy35_woz` in slot 5; `dr_enable35` reroutes `/ENBL`).
Before this work `$C0E0-$C0EF` was a register stub that returned ROM bytes, so
no floppy of any size could boot on the IIgs.

**What is implemented and verified**:
- `src/worker/devices/drivestate.ts`: drive indices 0/1 = slot 7 hard drives,
  2/3 = slot 6 5.25", **4/5 = slot 5 3.5"**. `MAX_DRIVES` is now 6.
  Added `getDriveStateByIndex` / `getDriveDataByIndex` because the IWM routes
  to a *specific* drive, which the Disk II path (current-drive-only) cannot do.
- `src/worker/devices/diskdata.ts`:
  - `iwmReadDataRegister(index, enabled)` advances the Logic State Sequencer to
    "now" and returns the latched data register, reusing `getNextByte`.
  - `iwmStepHead(index, reg, enabled)` maps `$C0E0-$C0E7` (CA0-CA2 + LSTRB) onto
    the same Shugart stepper bookkeeping the Disk II uses.
  - `iwmResetTiming()` restarts the sequencer after a reset or an EN35 change.
- `src/worker/memory.ts`: `$C0E8` (Q6=0/Q7=0) returns real nibbles; `$C031`
  (Disk Control Port) is read/written, with bit 6 = EN35 selecting the drive
  family and bit 7 = HDSEL passed through.
- Slot 5 is a first-class `disk35` card in `getSlotOptions` for `APPLE2GS`, with
  UI labels, drive-panel entries (IIgs only) and `$C02D` participation.
- `src/worker/devices/decodedisk.ts`: a WOZ whose INFO disk type is 2/3 (3.5")
  gets its bit cell halved, matching gssquared (`Floppy35_woz` uses 16 where
  `Floppy525_woz` uses 32).
- `.3mg` images up to 1.44MB route to slot 5 on the IIgs.

**Verified**: `src/worker/gs_floppy_probe.test.ts` shows the ROM reaching
"Check startup device!", selecting drive 1 of the 5.25" family (EN35 = 0),
enabling the motor, and pulling a real 6-and-2 nibble stream out of the data
register (`trackLocation` advances from 0 to ~13,700 bits). The IWM data path
works.

**Still outstanding**:
1. The IIgs does **not yet boot a 5.25" floppy** — it stays on "Check startup
   device!". The nibbles are arriving but the boot scan never finds the boot
   volume, so the remaining work is in head-seek/alignment and possibly the
   EN35/SELECT handshake timing.
2. **No 3.5" nibblizer exists.** The 5.25" path uses `convertdsk2woz`
   (6-and-2 + 4-and-4 address field). 3.5" media needs self-synchronising GCR
   (5 data bits + 2 clock bits per group), 80 tracks x 2 sides x 16/32 sectors,
   plus a DO->3.5" repacker. This is the missing half of "slot 5 is a 3.5"
   drive" and is not started.
3. There is no 3.5" test image in the repo or under `c:\dev\emu\ap2`, so the
   GCR encoder could not be validated end to end. A viable check is to repack a
   known-good 5.25" ProDOS image into 800K 3.5" geometry and let the ROM's own
   GCR decoder read it back — the ROM is independent ground truth.
4. The 3.5" **write** path differs from the 5.25" sequencer and is unimplemented.

**Important caveat learned the hard way**: feeding the IWM data register a live
bit stream unconditionally breaks the IIgs power-on disk self-test, which reads
that register before any drive is enabled, and `A2DeskTop-VERA.hdv` then fails
to boot (`gs_trace_boot.test.ts`). Hence `iigsFloppyHasMedia()` gates the real
path: an empty bay keeps returning the ROM byte the register used to mirror.

### 27. Apple IIgs Mouse (ADB) & Speaker ($C030) — DATA PATH FIXED, CURSOR STILL PARTIAL

**Reported symptoms**: after mounting `GSOS601.po` on S7,D1 and booting to the
Finder, the mouse pointer never moved and the machine was silent.

Four independent bugs were found. A and B are the quick ones; C and D are the
deep ones.

#### A. Speaker ($C030) was never driven

The IIgs's `$C020-$C04F` block is handled by its own branch in `memSet24`
(`src/worker/memory.ts`), which *short-circuits* the normal softswitch path.
`$C030` fell into the `default:` case that just stashes the byte in
`iigsRegisters`, so `checkSoftSwitches` — and therefore `passClickSpeaker` —
was never called. The Apple IIgs was completely silent.

**Fix**: an explicit `case 0xC030` in the IIgs write branch that calls
`checkSoftSwitches(0xC030, true, s6502.cycleCount)`. A test-only counter
(`getSpeakerClickCount` / `resetSpeakerClickCount` in `worker2main.ts`) lets the
suite assert it.

#### B. Mouse events were fed to the Apple IIe 6522 mouse card

`MSG_MAIN.MOUSEEVENT` in `worker2main.ts` called `MouseCardEvent(...)`, which
only ever updated the Apple IIe mouse-card state. `iigsADB.queueMouse()` and
`iigsADB.setMouseButton()` had **zero callers** in the whole codebase, so the
IIgs ADB never saw a single event.

**Fix**: `MouseCardEvent` now branches on `getCurrentMachineName()` and routes
to a new `iigsADBEvent()` on the IIgs. The ADB reports *relative* motion, so
the UI's normalized 0..1 position is converted back into deltas against the
last position delivered; the first report only establishes a baseline (a delta
from an unknown origin would throw the cursor into a corner). A full-width
sweep maps to 640x200 counts (`ADB_COUNTS_X/Y`), because the OS adds the counts
straight onto the cursor position in Super Hi-Res space. Both axes must go into
a single `queueMouse()` call — queueing X and Y separately latches two reports
and the first one is lost. `resetMouse()` clears the tracking baseline too.

#### C. The ADB implemented the wrong protocol

This was the deep bug. `iigs_adb.ts` implemented **classic ADB bus talk**
(register = bits 7-6, command = bits 5-4, address = bits 3-0 of the `$C026`
command byte) and answered every "talk" with a hardcoded
`[SRQ|addr, handlerId]` pair.

The IIgs does not work that way. The command byte written to `$C026` is the
**ADB micro-controller** command set, classified by bits 7-6:

| class | command | action |
|---|---|---|
| `00xxxxxx` | `0x01` abort / `0x02` reset / `0x03` flush | clear state |
| | `0x04`/`0x05` set/clear modes | 1 arg |
| | `0x06` set config / `0x07` synch | 3 / 4 args |
| | `0x08`/`0x09` read/write micro memory | 2 args |
| | `0x0A`..`0x0D` read modes/config/error/version | replies |
| | `0x0E`/`0x0F` read charsets/layouts | replies |
| `01xxxxxx` | `0x40` reset FDB, `0x48` receive bytes, `0x50s/0x60s/0x70s` SRQ | |
| `10xxxxxx` | **TRANSMIT 2 BYTES** | FDB *listen*, 2 args |
| `11xxxxxx` | **POLL FDB DEVICE** | FDB *talk*, 2-byte reply |

The implementation follows `gssquared/src/devices/adb/ADB_Micro.hpp`
(`write_cmd_register` / `execute_command`).

Two framing rules that are easy to get wrong and will hang GS/OS's ADB
handshake:

1. **Controller replies carry no header byte** — the payload starts with the
   count and is followed by that many data bytes. Prepending the
   `0x80 | (n-1)` header makes GS/OS read a 138-byte "count" and stall forever.
2. **FDB poll replies DO carry that header** — bit 7 = response present,
   bit 6 = micro reset, bits 2-0 = (byte count - 1).

A third, subtler bug in the framing itself: the argument counter was seeded
with `1` after the command byte, so a two-argument command such as `$09`
(read micro memory) executed after a *single* argument and the second argument
byte was then parsed as a brand new command. `cmd.length - 1 ===
argumentsExpected` is the correct test.

Also ported `gssquared`'s device model: both devices have 4 two-byte registers,
register 3 is the status word (`[event byte, address | handler | SRQ enable]`,
initialised to `[0, addr | 0x20]`), the mouse's register 0 holds the motion
report, and the keyboard's register 0 holds the key latch (`$FF,$FF` = empty —
it must start empty, zeros read as a key press).

#### D. The interrupt line stayed latched (machine looked frozen)

Once motion was actually delivered, `hasMouseData()` still returned false after
a report was consumed (it only looked at `reportInProgress ||
pendingX || pendingY || buttonChanged`), so the ADB never raised an interrupt.
Worse, a delta larger than the ±63 a single report can carry left a *remainder*
behind, which kept `pendingX` non-zero and therefore kept the IRQ asserted
forever — the CPU did nothing but service IRQs and the Finder froze. That was
measured as ~14,000 `interruptPending()` assertions inside a single frame.

**Fix**: `hasMouseData()` also reports an unread `mouseHasData`, and a
`consumeReport()` step runs whenever the OS finishes a report (both `$C024`
bytes, or a poll of device register 0). It latches any leftover motion as a
fresh report, so the IRQ naturally deasserts and re-asserts for each remaining
chunk. The Y byte is captured *before* `consumeReport()` overwrites the
register.

### Verified working
- 970/971 tests pass; the only failure is the pre-existing `vera.test.ts`
  CMDR-DOS failure that also fails on a clean tree.
- Browser (headless Chrome, CDP): UI mouse moves reach `iigsADB`; GS/OS has
  enabled the ADB mouse IRQ (`$C027` write `$40`); the ADB interrupt is asserted
  once per event with no re-assertion storm; GS/OS reads `$C024` twice per
  event and reads back the correct report (`$8B` = +11 X, button up).
- `$C030` clicks reach the audio output.
- GS/OS 6.0.1 still boots cold to the Finder (`gsos_boot.test.ts`), and the
  Ctrl-Reset-to-Applesoft behaviour is unchanged (`gs_ctrl_reset.test.ts`).

### Still outstanding
**The Finder cursor still does not move.** The report reaches the guest and is
consumed, but on the real IIgs GS/OS drives the cursor from the ADB *device*
register rather than from `$C024`. Tracing shows GS/OS issues `$C026` commands
`$B3`/`$A5` (transmit 2 bytes) and `$73` (receive), and reads the mouse with a
**POLL FDB DEVICE** of device 3 register 0. No such poll is ever observed
during boot or during mouse motion, so the guest's EventManager never sees a
mouse event.

The `$C024` reads that *do* happen appear to come from the ROM's VBL task, not
from GS/OS. The next step is to find why the guest stops polling the ADB device
register — most likely it only does so in response to the ADB interrupt, and
the IIgs IRQ dispatcher may need the ADB to be reported as a distinct
`$C041`/`$C046` interrupt source rather than being folded into the master
`$C046` bit 7 as `iigsInterruptPending()` does now.

**Regression tests**: `src/worker/gs_mouse_sound.test.ts` (mouse event routing,
report direction/magnitude/button encoding, speaker output) and the existing
`gsos_boot.test.ts` / `gs_ctrl_reset.test.ts`.

### 28. Apple IIgs Super Hi-Res Output Resolution (640x400) — RESOLVED

**Issue**: on the Apple IIgs the GS/OS 6.0.1 desktop background looked badly
stretched. Finder windows, the clock and the icons were all squashed.

**Root cause**: `processSuperHiRes()` rendered the 640x200 Super Hi-Res
framebuffer into the legacy Apple II image size of 560x384, and the screen
area was given the legacy aspect of 1.4583. The final aspect seen on screen is
the product of the hidden-canvas size and the canvas aspect, so a 640x200
image ended up displayed at 1.4583 instead of 3.2 — vertically squashed by
about 2.2x. The intermediate 560x384 sampling only affected sharpness, never
aspect.

**Fix**: mirror the way the Apple II itself is rendered. The 40-column Apple II
draws a 560x192 image and emits every scanline twice to land on 560x384. The
Apple IIgs Super Hi-Res screen is 640x200, so it now follows exactly the same
pattern and emits each of its 200 scanlines twice, landing on **640x400**.

Because the sampling is destination-driven, both SHR modes fall out of the
same loop:

| source | width step | height step |
|---|---|---|
| 640x200 (GS/OS desktop) | `srcX = x` (1:1) | `srcY = ty >> 1` (doubled) |
| 320x200 (games) | `srcX = x >> 1` (doubled) | `srcY = ty >> 1` (doubled) |

So games and the desktop both fill exactly the same 640x400 space and the
window never changes size when a program switches modes — the behaviour of
KEGS/GSport/Virtual ][GS.

Implementation:

- `src/ui/graphics.ts`: added `SHR_SOURCE_WIDTH/HEIGHT` (640x200) and
  `SHR_WIDTH/HEIGHT` (640x400), plus `LEGACY_ASPECT` (1.4583334) and
  `SHR_ASPECT` (1.6). A module-level `hiddenWidth`/`hiddenHeight` tracks the
  size of the image actually drawn into the hidden canvas each frame, exported
  through `getScreenSize()`.
- `isSuperHiResScreen()` gates it on `handleGetMachineName() === "APPLE2GS"`
  so the VidHD peripheral card (which also drives `processSuperHiRes`) keeps
  the legacy geometry.
- `getCanvasSize()` picks `SHR_ASPECT` when the IIgs is showing SHR and
  `LEGACY_ASPECT` otherwise. Since the margins are symmetric fractions of the
  canvas, the screen-area aspect equals the canvas aspect.
- `drawImage()` blits `hiddenWidth x hiddenHeight` instead of a hardcoded
  560x384, and the `effectBackground` pass reads the same live size.
- `ProcessDisplay` resets to the legacy size at the top of every frame and
  clears the whole hidden canvas, so a previous SHR frame cannot leave rows
  200..399 to leak into the background/ghosting passes.
- `src/ui/canvas.tsx`: the hidden canvas is now 640x400, large enough for
  either geometry. The legacy Apple II path only ever writes and reads
  560x384, so its pixels are bit-identical to before.
- `shrRgbaBuffer` grew to `SHR_WIDTH * SHR_HEIGHT * 4`.

**Verification** (headless Chrome, CDP):
- GS/OS 6.0.1 Finder: hidden canvas 640x400, screen area 699x438,
  aspect 1.5961. Menu bar text is blocky rather than blurred and the desktop
  background is a clean regular lattice — i.e. genuinely 1:1.
- IIgs **text mode** (the ROM boot screen, which is not SHR) is untouched:
  screen area 699x479, aspect 1.4574, i.e. still 560x384.
- Apple IIe is untouched: still 560x384 / 1.458.
- `src/ui` suite: 266/266 pass. Full suite 969/970 — the only failure is the
  pre-existing `vera.test.ts` CMDR-DOS failure that also fails on a clean tree.
- `tsc --noEmit` is clean.

**Side effect**: because the screen is now 1.6 instead of 1.458, the emulator
canvas is wider and the control panel to its right sits further away. This
matches how KEGS/GSport/Virtual ][GS present the IIgs and was confirmed as the
wanted behaviour.

### 29. Apple IIgs 65816 Cycle Accounting (1 MHz was ~5x too fast) — RESOLVED

**Issue**: selecting "Normal / 1.02 MHz" on the Apple IIgs still ran old IIe
games far faster than the Apple IIe at the same setting.

**Root cause**: `CPU65816.processInstruction()` ended with
`// Return 1 cycle for now as placeholder` / `return 1;`. Every 65816
instruction was charged exactly one cycle, so the IIgs burned its identical
17030-cycle frame budget roughly 5.26x faster than the 6502, whose average
instruction costs 5.26 cycles. Measured directly:

| machine | instructions | cycles | instr/cycle |
|---|---|---|---|
| Apple IIe | 1,294,885 | 6,812,296 | **0.190** |
| Apple IIgs (before) | 3,423,030 | 3,423,030 | **1.000** |

**Fix**: real 65816 cycle accounting in `src/worker/cpu65816.ts`, modelled the
way `gssquared/src/cpus/base_6502.cpp` models it — a cycle per bus access plus
explicit internal cycles:

- `read8()` / `write8()` each charge one cycle, so the opcode fetch, operand
  fetches, data reads/writes, pointer fetches, stack pushes/pulls and interrupt
  vector reads are all counted automatically. A 16-bit access costs two, exactly
  as on real hardware.
- `phantomRead()` charges a bus cycle with no data movement, for the 6502/65816's
  dummy reads. The bus is deliberately *not* read, because apple2ts's own 6502
  core does not model phantom-read side effects either (matters for `$C0xx`
  softswitches).
- `ADDR_CYCLES_816` holds the internal cycles per addressing mode for
  read / write / read-modify-write, i.e. the published WDC cycle count minus the
  number of bus accesses this implementation actually performs. The values hold
  for both 8-bit and 16-bit operands.
- `INDEXED_ADDR_MODES_816` marks the modes whose index register is added to an
  address that is not just the direct page; those earn the page-crossing cycle on
  reads and an unconditional extra cycle on writes and read-modify-writes.
  `dp,X` / `dp,Y` are deliberately absent — in emulation mode the direct page is
  page zero and the access wraps, so it costs exactly what the 6502's `zp,X`
  costs.
- Instruction-level internals: implied ops +1, accumulator shifts +1, pushes +1,
  pulls +2 (dummy PC read plus the stack-pointer increment), taken branches +1
  (+1 more on a page cross), `JSR` +1, `JSL` +1, `RTS` +3, `RTI` +2, `RTL` +2,
  `BRK`/`COP` +1 (the padding byte fetch), `PER` +1, and `MVN`/`MVP` +2 on the
  first pass of a block move and +1 on each subsequent pass.
- `processInstruction()` resets the accumulator at the top and returns it, so the
  run loop's `s6502.cycleCount += cycles` now advances at the real rate.

**Verification**:
- `src/worker/gs_cycles.test.ts` — 128 tests. 110 of them pin the published
  6502 cycle counts against the emulation-mode core (implied, immediate, zp,
  zp,X, abs, abs,X, abs,Y, (zp,X), (zp),Y, branches, stack, jumps), 14 pin
  native-mode 65816 counts including the 16-bit operand widths, and the last
  four cover `JSL`/`RTS`/`RTL` and the `MVN` block-move per-pass cycle count.
- The same file measures the whole boot: both machines' ROM boot code is 8-bit
  and runs in 6502 emulation mode, so the instructions-per-cycle ratio has to
  agree. Measured over the first 60,000 instructions of each boot:
  **IIe 0.3797 vs IIgs 0.3608 instr/cycle** — parity within 5%, where the IIgs
  used to be 5.26x higher.
- Full suite 1097/1098 — the only failure is the pre-existing `vera.test.ts`
  CMDR-DOS failure that also fails on a clean tree. `tsc --noEmit` is clean.
- Headless Chrome: the IIgs still cold-boots to the ROM 01 banner and the
  "Check startup device!" scan bar at 1.02 MHz.

**Note**: the IIgs is *not* uniformly as slow as the IIe. GS/OS runs in native
mode with 16-bit registers, where the 65816 genuinely executes more instructions
per cycle than a 6502 — that is real hardware behaviour, not a bug. The
emulation-mode path, which is what old IIe games use, now matches the 6502.


## Debugging Techniques Used
- **Instruction Tracing**: Added a circular buffer in `motherboard.ts` to trace instructions when debugging specific loops.
- **ROM Inspection**: Disassembled portions of `gsROM` via Node.js helper scripts to identify hardware polling loops (such as `SELIWM` and diagnostic entry points).
- **GSSquared Cross-Referencing**: Verified exact register logic and development log notes directly against `c:\dev\gssquared`.
- **CDP In-Browser Screenshots**: Automated Chrome screenshot capture via DevTools Protocol to visually verify boot screens.

## Key Files Modified
- `src/worker/cpu65816.ts`: 65816 CPU emulation, stack normalization, IRQ sampling, peripheral `specialJumpTable` execution, 65816 ADC/SBC decimal mode, and full WDC cycle accounting (bus-access counting plus per-addressing-mode internal cycles) so 8-bit code runs at 6502 speed.
- `src/worker/memory.ts`: Memory mapping for Bank E0/E1, dedicated `megaIIMain` and `megaIIAux` (64KB each), Bank FE/FF ROM, IWM registers ($C0E0-$C0EF), State Register ($C068), Slot Register ($C02D), interrupt flags ($C046), slot C800 strobe management, and Fast RAM vs Mega II Language Card isolation.
- `src/worker/devices/harddrivedata.ts`: SmartPort and ProDOS hard drive block hooks ($C7C0/$C7C3), block read/write operations for GS/OS.
- `src/worker/iigs_adb.ts`: ADB controller emulation.
- `src/worker/iigs_clock.ts`: Full RTC and 256-byte Battery RAM state machine from `gssquared`.
- `src/worker/motherboard.ts`: CPU cycle accounting, VBL→IRQ gated triggering for IIgs, separation of cold boot memory init from warm reset.
- `src/ui/graphics.ts`: MouseText decoding and inverse-attribute handling for `APPLE2GS`; renders Super Hi-Res at 640x400 (200 SHR scanlines doubled) so the IIgs desktop is not stretched.
- `src/ui/canvas.tsx`: hidden canvas sized 640x400 to hold either the legacy 560x384 image or the Apple IIgs 640x400 Super Hi-Res screen.
- `src/ui/copycanvas.ts`: Enabled MouseText support for `APPLE2GS` during screen copying.
- `src/ui/inputparams.ts`: URL query parameter support for `?machine=apple2gs`, `?boot=true`, and syncing slot changes to the worker.
- `src/ui/controls/speeddropdown.tsx`: Speed dropdown display mappings for IIgs (1.02 MHz, 2.8 MHz, 7.1 MHz, 14.3 MHz).
- `src/ui/localstorage.ts`: Persistence for machine profiles and slot sanitization.
- `src/worker/gs_speed.test.ts`: Apple IIgs speed modes test.
- `src/worker/gs_trace_boot.test.ts`: Regression test verifying ProDOS 8 and A2DeskTop boot into Double Hi-Res graphics.
- `src/worker/gs_desktop15_boot.test.ts`: Regression test verifying mounting `A2DeskTop-1.5.po` and rebooting.
- `src/worker/test_gsos601.test.ts`: Regression test verifying cold boot of GS/OS 6.0.1 (`GSOS601.po`) directly into the Finder desktop in Super Hi-Res mode.

## Current Status & Milestones Achieved
1. **Apple IIgs Cold Boot POST & Diagnostics**:
   - Complete cold boot POST, memory clearing, startup banner, and barber pole scan bar.
   - Clean Ctrl-Reset to Applesoft BASIC prompt `]`.
2. **Peripheral & Slot Subsystem**:
   - Slot 7 SmartPort Hard Drive / HDV emulation with ProDOS block hook ($C7C0) and 16-bit SmartPort dispatcher hook ($C7C3).
   - Mockingboard VIA timers and IRQs ticking smoothly on 65816.
   - Pure slot sanitization strictly enforcing IIgs hardware architecture.
3. **ProDOS 8 & 8-bit Software Compatibility**:
   - Boots standard ProDOS disks, ProDOS 2.4.2, and A2DeskTop 1.5 into 80-column Double Hi-Res mode with MouseText.
4. **GS/OS 6.0.1 16-bit Operating System**:
   - Unpacks via `START.GS.OS` OMF relocator to Bank 7E and relocates 14 blocks into Banks 00, 01, E0, and E1.
   - Transitions cleanly from ProDOS 8 block access to 16-bit SmartPort calls.
   - Successfully loads `PRO.FST`, `DRIVERS`, `SYSTEM.SETUP`, `TOOLS` (QuickDraw, Window Manager, `TOOL034`), control panels, and desk accessories (`TIME`, `CHRONOS II`).
   - Launches `/SYSTEM/START` (official Apple IIgs Finder) and renders the full 640x200 Super Hi-Res desktop with menu bar, clock, disk icons, trash can, mouse pointer, and system modal dialogs.

## Reference Materials
- **GSSquared**: `c:\dev\gssquared\` (Primary reference: `RTC_PRAM.hpp`, `IWM2.hpp`, `display.cpp`, `DevelopLog.md`, `mmu_iie.cpp`, `computer.cpp`)
- **Apple IIgs Hardware Reference Manual**: Official hardware specifications



