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

**Update — the 5.25" data path already boots; what was actually broken was the
UI.** `gs_floppy_probe.test.ts` now boots `A2DeskTop-VERA.po` from slot 6 to the
ProDOS 8 welcome screen ("ProDOS 8 v2.43", `driveSel=0`, `enable35=false`,
`qtrTrack=20`, `trackLoc=47111`), so the IWM read path works end to end. The
outstanding "stays at Check startup device!" above was a *slot manager* problem,
not an IWM problem:

- The drive panel disabled any drive whose slot was configured `"none"`:
  `const slot = dprops.index < 2 ? 7 : 6` / `slotConfig[slot] === "none"`. On
  the IIgs `DEFAULT_SLOT_CONFIG_GS` has slot 6 = `"none"` (correct — nothing
  needs inserting, the 5.25" drive is motherboard hardware), so **S6,D1 and
  S6,D2 were greyed out and could not accept a disk at all**; the drive's
  context menu did not even open.
- The index-to-slot mapping was also wrong for the IIgs 3.5" drives: indices 4
  and 5 (S5,D1/D2) mapped to slot 6 instead of slot 5.

Fixes in `src/ui/devices/disk/diskdrive.tsx`: map 4/5 to slot 5, and on the IIgs
treat every slot except 7 as built-in so those drives are never gated on the
slot config. Verified in headless Chrome: all six drives now render enabled and
S6,D1's menu opens with every entry live.

Also added `?drive=N` to the URL fragment handler (`src/ui/inputparams.ts`) so a
disk can be deep-linked into a specific drive (0/1 = S7, 2/3 = S6 5.25",
4/5 = S5 3.5"). Without it a URL-mounted 5.25" disk always lands in S7, where the
IIgs ROM never looks for it. Six new cases cover it in
`src/ui/inputparams.test.ts`.

**Still outstanding**: in the browser, mounting a 5.25" disk and pressing
Ctrl-Reset still does not boot it. See section 26b for the instrumentation that
was built to chase this and what it actually found.

Also note that `?boot=true` boots while the fragment disk is still downloading,
so a deep link needs a Ctrl-Reset to pick the disk up.

### 26a. Apple IIgs Floppy Boot After Ctrl-Reset - TWO REAL BUGS FIXED

Two separate bugs stopped a 5.25" disk booting after a reset. Both are fixed and
covered by `src/worker/gs_floppy_late.test.ts` (disk at boot, disk at boot +
Ctrl-Reset, and mount-after-boot + Ctrl-Reset must all reach ProDOS).

**1. The head was parked at the outer stop on every reset.**
`doResetDiskDrive()` set `quarterTrack = maxQuarterTrack`, i.e. track 70. Only a
cold boot re-calibrates the head, so a warm reset left the ROM reading the wrong
track. Real drives spring the head back to track 0, so it is now 0.

| scenario | qtrTrack before | qtrTrack after |
|---|---|---|
| disk present at boot | 20 | 20 |
| disk present at boot + Ctrl-Reset | **137** (outer stop) | 0 |
| mounted after boot + Ctrl-Reset | **137** (outer stop) | 0 |

**2. Ctrl-Reset took the ROM's warm path, which never looks at the IWM.**
The IIgs ROM decides cold boot vs warm reset with

```assembly
LDA $03F3 / EOR #$A5 / CMP $03F4 / BNE cold
```

and the boot sequence writes that signature into `$03F2-$03F4` as it goes
(measured after a successful boot: `59 FF 5A`, and `$FF ^ $A5 = $5A`, so the
check *passes*). Once it is there a reset means "warm, devices unchanged": the
ROM walks the slots and never touches `$C0E0-$C0EF`.

| phase | `$C0E0-$C0EF` reads | slot 6 reads | slot 7 reads |
|---|---|---|---|
| cold boot (finds the disk) | **399,707** | 34,289 | 275 |
| after Ctrl-Reset | **0** | 12 | 9 |

So inserting a floppy and pressing Ctrl-Reset could never boot it. `doReset()`
now clears `$03F2-$03F4` when `iigsHasFloppyMedia()` is true, forcing the full
device scan. With no floppy the warm path is kept, which is what makes
Ctrl-Reset land on the Applesoft prompt (`gs_ctrl_reset.test.ts` still passes).
`iigsHasFloppyMedia()` deliberately reuses `iigsFloppyHasMedia()`, the same test
the IWM data path uses, so the two can never disagree about whether a drive is
loaded.

Side note found while measuring: the harness only boots the floppy at speed mode
0 (1.02 MHz); modes 1 and 3 (2.8 and 14.3 MHz) stall the same way. So the read
is timing sensitive in general, which is consistent with the browser failing at
1.02 MHz too.

### 26b. IWM Read-Cadence Instrumentation — and it OVERTURNS the overshoot theory

**Why**: the browser would not boot the floppy while the jest harness did, and
the working hypothesis was "the browser's run loop leaves long gaps, one data
register read then swallows many tracks and the ROM loses sync". Before trying
to fix that, measure it.

**What was added** (debug-only, costs nothing in normal use):

- `src/worker/devices/diskdata.ts`: `IwmReadStats` + `getIwmReadStats()` /
  `resetIwmReadStats()`, fed from `iwmReadDataRegister()`. It records the number
  of reads, the CPU-cycle gap between consecutive reads (sum and max), the
  largest number of bits a single read advanced the LSS by, and how many reads
  advanced far enough to cross a whole track. `iwmResetTiming()` resets the
  sampler, so every boot attempt gets its own profile.
- `?iwmgaps=1` in the URL (`src/ui/inputparams.ts`) turns on a 2 Hz poll
  (`src/ui/main2worker.ts`) that asks the worker for the current stats over
  `MSG_MAIN.IWM_STATS_REQUEST` / `MSG_WORKER.IWM_READ_STATS`. The result is on
  `window.__iwmStats`, so a headless run can read it with one CDP
  `Runtime.evaluate`.
- `src/worker/gs_floppy_late.test.ts` asserts the sampler works and prints the
  harness baseline.

**Plumbing gotcha worth remembering**: this started as a sticky "enabled" flag
posted once at startup, and the worker never answered afterwards. A worker
module can be re-evaluated underneath a live page (Vite dev HMR, machine
switch), which silently resets module-level state, so a request/response poll is
strictly more robust than a flag plus a per-frame push. Do not use sticky worker
flags for diagnostics.

**What it found** — the overshoot theory is **wrong**, and the real difference is
much starker than timing:

| after Ctrl-Reset | IWM data-register reads |
|---|---|
| jest harness (boots ProDOS) | **387,809** |
| browser (stays at the ROM banner) | **1** |

Browser detail: `{reads: 1, totalGapCycles: 2557, maxGapCycles: 2557,
maxBitsPerRead: 639, readsCrossingTrack: 0}`. That single read, 2,557 cycles
after the reset, is the IIgs **power-on disk self-test** — the same read that
made `iigsFloppyHasMedia()` necessary in the first place. It advances 639 bits,
which is exactly the `trackLocation = 639` that was previously mistaken for a
partial sync. It is not a partial sync; it is the only read that ever happens.

So the browser ROM never enters the IWM read loop at all. Together with the
earlier counts (slot 6 read 12 times and slot 7 read 9 times, against 34,289 and
275 in the harness), **the cold device scan in the browser starts and then dies
almost immediately**. Nothing about the disk, the WOZ data, the head position or
the read cadence is wrong.

**Also worth recording**: the overshoot the theory worried about is real in the
harness, it is just not the bug. The harness makes 22 track-crossing reads, the
worst advancing **187,429 bits** (~29 disk revolutions) in a single read, after a
749,735-cycle gap. So any future fix that assumes reads are short will be
fixing a latent robustness problem, not this failure.

**Where to look next**: trace the ROM's PC through the first few hundred
instructions after the reset in both environments and find the divergence point.
The scan dies before it touches the floppy, so the question is what the browser's
ROM takes that the harness's does not — most likely a softswitch, an interrupt,
or the state that `iigsInitInterrupts()` installs, all of which are set up
differently by `doBoot()` versus a bare `doReset()`.

### 26c. 65816 PC Trace — the Runs Agree, Then the Browser Ends Up Executing RAM

Built to answer 26b's "where to look next". Same debug-only pattern: a PC
histogram plus the first 300,000 and last 600 program counters executed after a
reset.

**Added**

- `src/worker/romtrace.ts`: `recordRomPc()` called once per instruction from
  `CPU65816.processInstruction()`, a single boolean check when disabled.
  `getRomTrace()` returns `{instructions, first, last, hist}`.
- `?romtrace=1` in the URL turns on a 1 Hz poll; the result is on
  `window.__romTrace` and `window.__romTraceReset()` marks a fresh boot attempt.
  Enable and clear travel *with* the request, for the worker-reload reason noted
  in 26b.
- `GS_TRACE_OUT=<path> jest src/worker/gs_floppy_late.test.ts -t "boots after
  Ctrl-Reset"` writes the harness trace out for diffing.

**Testing note that cost real time**: synthesised `Ctrl+R` key events do *not*
reliably reach the worker in a headless run — one capture started mid-execution
instead of at the reset vector, which is what made an early run look like the
reset had vanished. Clicking the UI's reset button (`#tour-reset-button`) is
deterministic and is what any further browser measurement should use.

**Result 1 — the two runs are the same program for a long time.** The first
**183,565** instructions after the reset are bit-identical between the harness
and the browser, starting `00:FA62, 00:FA64, 00:FA67, 00:FA69, 00:FA6A,
00:FA6B, 00:FA6C, 00:FE36, ...` — the same cold-boot path. So `doReset()`, the
cleared `$03F2-$03F4` signature, `iigsInitInterrupts()` and the disk mount are
all correct in the browser.

**Result 2 — the first difference is a timing loop, not a logic difference.** At
instruction 183,565 the ROM is polling in `FF:F9F7..FF:FA15`:

```
harness  ... FF:FA0A  FF:F9F7  FF:F9F8  FF:F9F9  ...
browser  ... FF:FA0A  FF:FA0C  FF:FA0D  FF:FA0E  FF:FA10 ... FF:FA15  FF:F9F7  ...
```

The browser runs the loop one extra iteration before falling through to
`FF:F9F7`, then rejoins. The sequences stay offset by a few instructions from
there on, so **index-by-index diffing is useless past this point** — a whole-run
PC histogram comparison is the only usable tool.

**Result 3 — and the histogram is where it gets interesting.** Over a whole
post-reset run, each side executes 277 program counters the other never touches:

| | PCs only this side runs | what they are |
|---|---|---|
| harness | 277, e.g. `05:4151` ×2,327,109, `05:4149` ×136,889 | the booted ProDOS RWTS read loop — i.e. the *consequence* of the disk booting |
| browser | 277, e.g. `75:7387` ×1,840, `64:6339` ×465, `64:63xx`, `74:5600` | **language-card RAM** |

On an Apple IIgs banks `$00-$DF` are RAM and only `$D0-$FF` is ROM, so the
browser is **executing code out of language-card RAM banks `$64`, `$74` and
`$75`** — addresses the harness never goes near. Those are not the IIgs ROM, so
the browser's machine is jumping somewhere it should not and running whatever is
in RAM there.

**Status**: this is the first concrete lead for the browser-only failure and it
moves the question well away from the floppy. The next step is to catch the
jump: record a short PC context window the first time execution enters a bank
outside `$00/$D0-$FF` after a reset, which names the instruction that branched
there.

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
**The Finder cursor still does not move — but the hypothesis above is WRONG.**
An instrumented GS/OS 6.0.1 boot (tracing every `$C024`–`$C027` access together
with the caller's `PB:PC`) disproves the "GS/OS polls the ADB device register"
claim. What actually happens:

- **GS/OS never touches the ADB after boot.** During the boot phase GS/OS issues
  79 `$C026` commands (`$07`, `$00`, `$32`, `$24`, `$73`, `$09`, `$51`, `$08`,
  `$a5`, `$01`, `$0e`, `$0f`, `$b3`, `$03`, `$04`, `$05`, `$06`, `$ff`, `$10`)
  and 23 `$C026` reads, then issues **zero** further `$C026` commands. After a
  mouse move only `$C027` and `$C024` are read.
- **The IIgs ROM's own ADB task drives the mouse**, not GS/OS. Every `$C024`
  read comes from `FF:C4DC` and `FF:C4E9`. Disassembling the ROM (128K image,
  bank `FF` = offset `0x10000`) gives:

  ```assembly
  FF:C4D2  LDA $C027      ; bit 7 = mouse report waiting
  FF:C4D5  BPL $C48F
  FF:C4D7  LSR A          ; carry ends up holding bit 5 of the status
  FF:C4D8  LSR A
  FF:C4D9  LDA $C024      ; X byte
  FF:C4DC  TAX
  FF:C4DD  BCS $C48F      ; bit 5 set -> leave after the X byte
  FF:C4DF  LDA $C027
  FF:C4E2  AND #$02       ; bit 1 = "the next $C024 read is the Y byte"
  FF:C4E4  BEQ $C48F
  FF:C4E6  LDA $C024      ; Y byte
  FF:C4E9  TAY
  FF:C4EA  CLC
  FF:C4EB  RTS
  ```

  So `$C024` *is* the right path, and the `$C027` bit layout already implemented
  (`bit 7` data waiting, `bit 5` skip, `bit 1` Y-next) is exactly what this ROM
  code expects. (The bit-5 and bit-6 semantics were verified by hand against the
  shift sequence — a `LSR` takes carry from bit 0, so `LSR`/`LSR` leaves the
  original bit 5 in carry, and `$C0` has bit 5 clear.)
- **The reports are byte-for-byte correct.** A UI move of (+0.12, +0.05) becomes
  `ADB_COUNTS_X/Y` of (76, 10), which is split into reports of X=$3F/Y=$0A then
  X=$0D/Y=0. The ROM's own unpack at `FF:9D01`/`FF:9D05` sees A=$0A and A=$3F,
  matching, and it then runs the full accumulator at `FF:9D32`–`FF:9D84` and
  `FF:9E8B`–`FF:9EA8` to build the 16-bit cursor position.
- **The ADB interrupt works.** `iigsADB.interruptPending()` asserts (mouse
  interrupt enabled in `$C027` bit 6, report latched) and then releases —
  `hasMouseData()` reads 0 for 30 consecutive frames after the motion, so the
  line is not latched and there is no IRQ storm.

Headless Chrome confirms the end state: GS/OS reaches the Finder and the menu-bar
clock keeps ticking (12:09:17 → 12:09:28), the arrow cursor *is* drawn at the
top left, and it does not move; hovering the "File" title does not highlight the
menu, and a click does not select a volume icon.

**Where the break actually is**: somewhere between the ROM's accumulator and the
GS/OS event manager. The IIgs ROM owns the whole mouse path and GS/OS only ever
sees the result, so this is a ROM/GS/OS interaction rather than emulator
plumbing. The ground-truth instruction map (recorded by capturing the raw opcode
bytes the CPU actually executed, not by guessing an alignment) is:

```
ff:9ce4  JSR $C4D2          ; the ROM's ADB read entry point
ff:9ce7  BCS $9CF9          ; no report -> skip
ff:9cf9  LDA #$20 / INC $077C
ff:9cff  AND #$3F / PHA     ; Y motion magnitude
ff:9d02  TXA / AND #$3F     ; X motion magnitude
ff:9d05  ORA $0001 / BEQ    ; ?
ff:9d0f  LDA $077C          ; 8-bit event/state byte
ff:9d15  STA $077C
ff:9d32  ROL A / TXA        ; decode X/Y direction bits
ff:9d4c  TAX / ASL / BPL    ; sign handling
ff:9d6d  PHY / PHA
ff:9d6f  LDA $05FC / STA $06FC
ff:9d76  CLC / ADC $04FC / STA $04FC   ; 16-bit accumulator
ff:9d7e  ADC $05FC / STA $05FC
ff:9d84  JSR $9E8B          ; report-to-event conversion
ff:9e8b  LDY #$80 / LDX #$02 / XBA / LDA $047C,Y / XBA / TAY / BPL ...
```

Note `$077C`, `$04FC`, `$05FC` are **data-bank-relative** (`DB`), not bank-0
globals — `DB` is whatever the caller had when the ROM task ran, so the ROM
hands its results back in the caller's memory space. A naive dump of "bank 0
$04FC" reads an unrelated bank and looks like noise.

Two things that were checked and are *not* the cause:
- **The button path is dead too, not just motion.** Dispatching a real
  `mousePressed`/`mouseReleased` over a volume icon in headless Chrome does not
  select it, so this is not a "movement threshold" or "only fires while moving"
  problem — the event never reaches GS/OS at all.
- **The reports are delivered.** `hasMouseData()` reads 0 for 30 consecutive
  frames after motion, so the IRQ line is not latched and there is no interrupt
  starvation.

Closing this needs the GS/OS 6.0.1 `EventManager` / `.Mouse` driver side. What
the ROM's `$9E8B` conversion hands to, and how GS/OS turns it into an event.

### 29a. Comparing the ADB against gssquared — the ADB layer is NOT the problem

Read `c:\dev\gssquared\src\devices\adb\{ADB_Mouse,ADB_Micro,keygloo,keygloo_mouse_sync}.*`
against apple2ts's `iigs_adb.ts`. **Every part of the data path is equivalent**,
so there is nothing to fix there:

- **Report layout** (`ADB_Mouse.hpp`): register 0 byte 0 is
  `bit7 = button up | bit6 = moved right | bits5-0 = X`, byte 1 is
  `bit7 = button up | bit6 = moved up | bits5-0 = Y`. Identical to
  `latchMouseReport()`.
- **`$C024` delivery** (`keygloo_mouse_sync.hpp:560 read_mouse_data()`): first
  read returns `mouse_data[0]` (X) and sets a "Y next" latch, second read returns
  `mouse_data[1]` (Y) and clears `mouse_data_full` (the `$C027` bit 7 "data
  available"). Identical to `readMouseData()` / `consumeReport()`, including
  clearing the data-available flag only on the second read.
- **gssquared's own note**: "Flag off keeps the original KEGS-style MMU-write
  (dead-reckoning) path" — i.e. writing the guest's coordinate globals directly is
  the *fallback*, and `KEYGLOO_MOUSE_SYNC_INJECTION_ONLY=1` means they inject ADB
  relative motion like we do. They do not patch the cursor position.

**Cursor storage, and a hypothesis that turned out to be wrong.** gssquared
documents (`keygloo_mouse_sync.hpp`) that the Event Manager keeps the cursor in
two different places depending on the ROM:

```
// ROM 03 / GS/OS 6.0.1: Event Manager keeps the live cursor in the
// $E1/0190-0193 bank globals; the $E0 text-page screen holes ($047C/...)
// stay 0. ... ROM 01: the holes are the working copy.
EM_MOUSE_X_LO = 0x047C;  EM_MOUSE_X_HI = 0x057C;
EM_MOUSE_Y_LO = 0x04FC;  EM_MOUSE_Y_HI = 0x05FC;
EM_MOUSE_X_LO_BANK = 0x10190;  EM_MOUSE_X_HI_BANK = 0x10192;
EM_MOUSE_Y_LO_BANK = 0x10191;  EM_MOUSE_Y_HI_BANK = 0x10193;
```

apple2ts runs ROM 01 *with* GS/OS 6.0.1 — exactly the mismatched pair — so a
bridge from the ROM 01 holes to the `$E1` bank globals looked like the fix. It is
not: instrumenting every 24-bit access shows **GS/OS reads the holes and never
reads `$E1/0190-0193`** (0 reads). Measured over 20 frames of mouse motion:

| address | reads | value seen |
|---|---|---|
| `$0000/$047C` HOLE_X_LO | 57 | `$1A` → `$1D` → `$20` → `$23` |
| `$0000/$057C` HOLE_X_HI | 76 | `$00` |
| `$0000/$04FC` HOLE_Y_LO | 57 | `$11` |
| `$0000/$05FC` HOLE_Y_HI | 76 | `$00` |
| `$0000/$077C` ROM_STATE | 152 | `$00` / `$0E` / `$2E` / `$20` |
| `$E10190-0193` EM globals | **0** | — |

So GS/OS **is** reading the ROM's accumulator and **is** seeing it advance, three
units per moved frame. The cursor position crosses the boundary correctly. What
does not happen is GS/OS turning that read into a "mouse moved" event and a
cursor redraw — which is why neither motion nor the button does anything.

Also confirmed while measuring: the Tool Locator at `$E103C8` resolves to
GS/OS's own table (`$7EF22A`) and the Event Manager "active" word at tool+`$18`
reads `0/1B`, i.e. EM is running — so the check gssquared uses to decide whether
to touch the mouse globals is satisfied here, it is simply not the mechanism.

**Conclusion**: the ADB emulation, the `$C024`/`$C027` handshake, the interrupt
line and the cursor storage are all correct and equivalent to gssquared. The
missing piece is entirely inside GS/OS's own event delivery.

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




### 30. Apple IIgs 5.25" Floppy Boot - Open, Nondeterministic Browser Failure - PARTIAL

**Severity**: High. The IIgs 5.25" cold boot from a SmartPort-mounted floppy still never reaches a boot volume in a real browser worker, even though the byte-for-byte identical sequence runs all the way to ProDOS in jest.

**What was tried this round** (all in test/gs, commits up to bf7f4599 + 32f3d65b):

1. **Head re-calibration on reset** (`doResetDiskDrive()` now sets `quarterTrack = 0`; previously parked at the outer stop, track 70). Covered by `gs_floppy_late.test.ts`.
2. **Forcing a cold scan on Ctrl-Reset when floppy media is present** (`doReset()` clears `$03F2-$03F4` only when `iigsHasFloppyMedia()` is true, so cold-boot proceeds; without media the warm path to the Applesoft `]` prompt is preserved). Covered by `gs_ctrl_reset.test.ts`.
3. **Resetting the shared Disk II read-phase accumulator on reset / drive mount** (`cycleRemainder`, `fullRevolutionCount`, `headWindow`, `randPos` zeroed in `doResetDiskDrive`).
4. **IWM read-cadence instrumentation** (`IwmReadStats` + `?iwmgaps=1` poll) in `devices/diskdata.ts`. Showed the browser **reads `$C0E8` exactly once** (the power-on disk self-test, 639 bits) and never enters the read loop, while the jest harness reads ~387,809 times. Slot 6 / Slot 7 IWM access counts were 12/9 vs 34,289/275.
5. **Timing-offset theory overturned**: the browser executes the **first 183,565 instructions identically** to the harness (`00:FA62` reset vector -> identical cold boot). The difference is an extra iteration of the `FF:F9F7..FF:FA15` timing loop, not a logic divergence.
6. **Whole-run histogram diff**: harness-only PCs (`05:4151` etc.) are all in the *booted ProDOS RWTS read loop*; browser-only PCs (`64:6339`, `74:5600`, `75:7387`) are all **language-card RAM**. The browser is executing code out of LC-RAM banks that the harness never touches.
7. **Motor-time proven not the cause**: the motor-off delay was `setTimeout(1000)` wall-clock based, changed to **CPU-cycle based** (`MOTOR_OFF_CYCLES = 1_020_000`) in `32f3d65b`. Reads stayed at 1. The change is kept as an engineering improvement (deterministic, irrespective of host FPS).
8. **ADB read was gated behind `iigsFloppyHasMedia()`** (see section 26) so a real floppy does not make the power-on disk self-test read turn into a partial 639-bit read.

**What is still NOT resolved**:
- The exact instruction that branches execution into a language-card RAM bank after the reset. The foreign-bank jump is timing-nondeterministic and rarely occurs in a single capture; one run produced the banks above, most others (running the bank $D0..FF set only) never triggered the detection even though the browser boot still failed.
- Whether the jump is triggered by an in-emulator softswitch read, an interrupt, or host-timing variance in the boot profile.

**Next step (recommended)**: capture loop of roughly 20 browser runs with `?romtrace=1` and aggregate the `foreign[]` entries; the first consistently appearing one will name the branching instruction and disassemble back to a fixable cause.

**Live infrastructure** (kept in the tree, gated on query params, costs nothing by default):
- `src/worker/romtrace.ts` -> `recordRomPc()` (once per instruction), now with `timeline` and `foreign`, behind `?romtrace=1` and `window.__romTrace` polling.
- `devices/diskdata.ts` -> `IwmReadStats` behind `?iwmgaps=1` and `window.__iwmStats`.
- Headless measurement is via `#tour-reset-button` click (synthetic Ctrl+R does not reliably reach the worker).
- `GW_TRACE_OUT=path` jest env var writes the harness trace out for diffing (note: actual var name is `GS_TRACE_OUT`).

**Reference for debugging**: `AGENTS.md section 26a/26b/26c`; ground truth `c:\dev\gssquared` (IWM2, RTC_PRAM).

---

### 31. Apple IIgs Ensoniq ES5503 ("DOC") Emulation - MOSTLY DONE, ONE GAP KNOWN

**Status**: the chip emulates and is audible; GS/OS 6.0.1 still boots to the Finder; worker suite 757 pass. What does NOT work is events reaching applications, which is a separate and now well-characterised fault (section 32).

#### What was built

- `src/worker/devices/iigs_ensoniq.ts` - the ES5503: 32 oscillators, 64KB wave RAM
  (`ensoniqDocRam`), and the Sound GLU register interface.
- `memory.ts` wires `$C03C`-$C03F` (Sound Control / Data / Address Low / Address High)
  for both reads and writes. Before this, reads were hard-coded stubs.
- `motherboard.ts` generates one PCM block per emulated frame and posts it via
  `passEnsoniqSound` (`MSG_WORKER.ENSONIQ_SOUND`); `src/ui/devices/audio/iigs_ensoniq_audio.ts`
  queues the blocks on an AudioContext, registered through `registerAudioContext` so it
  obeys the same mute button and gesture rules as the speaker.
- `iigsEnsoniq.reset()` is called from `doBoot()` so a cold boot starts from the chip's
  power-on state.

#### Four real bugs found, each by testing rather than guessing

1. **Wave table pointer (`$80`) was broken.** The read returned a copy of the `$C0`
   register (bank/size/resolution) instead of the pointer, and the write rebuilt the
   pointer with an expression that always evaluated to 0. Every wave table therefore
   landed at address 0 and the chip played garbage or nothing. This was the "no sound"
   cause.
2. **Register mode left a stale high address byte.** A write to `$C03C` with bit 6
   clear has to clear `soundadrh`, otherwise a leftover wave RAM pointer offsets
   register accesses. gssquared does this in `ensoniq_write_C0xx`.
3. **`$C03D` is a pipeline, not a direct read.** Real DOC hardware (and MAME, and
   gssquared's `ensoniq_doc_data_read_pipeline`) returns the *previously latched* value
   and simultaneously fetches the byte at the *current* address. IIgs software relies on
   the "priming read, set `$C03E`/`$C03F`, data read" idiom, so returning the current
   address directly gave every such sequence stale data. `$E0` is also only fetched once
   per transaction, because the ROM's IRQ dispatcher reads `$C03D` twice and would
   otherwise acknowledge two oscillators while servicing one.
4. **The low nibble of `$C03C` is the analog system volume** and was ignored, so software
   that muted still produced output. It is now applied, slewed with a ~20ms time constant
   because firmware flips the nibble around DOC accesses and a step change chops the
   waveform.

Tests: `src/worker/gs_ensoniq.test.ts`, 8 cases - register round trips, wave RAM mode with
auto-increment, the oscillator-enable register, audible PCM from a keyed-on oscillator,
silence when halted, the `$C03D` pipeline, the volume nibble and busy, and `$E0`
acknowledging a pending oscillator interrupt.

#### Also fixed while in here: the Super Hi-Res aux window

Enabling Super Hi-Res linearizes the Mega II aux window `$2000-$9FFF`; the physical aux
array is interleaved (`$2000`/`$6000` halves), so a linear CPU address has to be folded:

```
x    = linear - $2000
phys = $2000 + ((x & 1) << 14) | (x >> 1)
```

Applied to bank `$E1` reads and writes, to the bank `$01` shadow that feeds it, and
inverted in `getShr()` before handing the buffer to `vidhd.extractShrBuffer`. This is
gssquared's `iigs_aux_linear_to_phys`, and `is_aux_linear()` there returns
`g_aux_linear || g_shr_enabled` - enabling SHR linearizes aux just as the explicit
`$C029` bit 6 does.

### 32. IIgs Events Never Reach Applications - OPEN (blocks Finder mouse and MCS)

**Symptom set**, all from the same root cause:

- GS/OS 6.0.1 Finder: the arrow cursor is drawn but never moves; hovering "File" does
  not highlight the menu; clicking a volume icon does not select it. The ADB itself is
  byte-for-byte equivalent to gssquared and the interrupt line asserts and releases
  cleanly (sections 27 and 29a). GS/OS reads the ROM's cursor accumulator and sees it
  advance, but never turns that into an event.
- Music Construction Set (`mcs.2mg`, slot 7): the title screen renders correctly in
  Super Hi-Res, and after the click that dismisses it the machine freezes. The screen
  shows correct 80-column text with a repeating pattern over it - the program stopped
  part-way through drawing its own screen. Confirmed the UI is NOT in SHR mode at that
  moment (`vidhdActive === false`), so the pattern is in the text page itself.
- The CPU parks in a polling loop: `00:861D`, whose bytes are `96 96 96 95 95 95`
  = `BIT $96,X` / `BIT $95,X` / `STA $95,X`, with X = `$0E`, so it is polling zero page
  `$A3`/`$A4`. Both bytes stay 0 forever. It is waiting for a flag nobody sets.

**What was ruled out**, each by measurement in headless Chrome against `mcs.2mg`:

| hypothesis | result |
|---|---|
| Ensoniq IRQ storm (added in section 31) | disabling the sound IRQ entirely reproduced the identical freeze |
| SmartPort / disk I/O | `$C7C0` called 394 times, `$C7C3` once; disk reads work |
| Super Hi-Res rendering / aux linearization | the linearization fix changed nothing here, and the UI is not in SHR mode |
| `$C019` VBL flag | handled correctly via `SWITCHES.VBLINV` |
| 80-column firmware `WAIT` at `$C340` | seen in one run with no disk mounted; a red herring |

**What the ROM says.** Dumping `src/worker/roms/rom_gs_system.ts` (128KB, bank `$FE` at
offset 0, bank `$FF` at offset 0x10000) and scanning it:

- `$FFB5DE` is genuinely `38 6B` = `SEC; RTL` and `$FFB5E2` is `18 6B` = `CLC; RTL`, so
  the addresses `iigsInitInterrupts()` points its "unclaimed" stubs at are correct.
- There is **no interrupt-vector table in the ROM that can simply be copied**: zero hits
  for `LDA`/`STA $E10070` or `$E10014` as long absolute (`AF`/`8F .. 01 E1`), and zero
  runs of 3-byte `$E1` pointers. The ROM installs vectors with computed loops, e.g. at
  `$FFB5E4`: `LDA $E103E5` / `LDY #$01` / `LDA $01,Y` / `JSR $B664` / `INX` / `CPX #$04`.
- `$FFB7CC` is the ROM's full interrupt manager. It opens with `XCE` (leaving emulation
  mode), `REP #$30`, then `PHP`/`PHB`/`PHD`; it manipulates `$C035` (STAT), reads
  `$C039`/`$C03A`/`$C03B` (SCC), and dispatches through E1 vectors such as
  `JSL $E10020`.

**Likely mechanism.** `iigsInitInterrupts()` synthesises the whole E1 vector table and
leaves every entry in `$E10014-$E1007C` as `JML $FFB5DE` (`SEC; RTL`, unclaimed). If
GS/OS drivers hang their event handlers off those vectors expecting the ROM's init to
have populated them, every dispatch returns immediately and no event is ever delivered -
which is exactly "events never arrive", and explains both the dead Finder cursor and the
MCS freeze from one cause.

**Caveat**: the ad-hoc 65816 disassembler used above has an incomplete opcode table and
desynchronises after about `$FFB7DC`, so the dispatch path inside `$FFB7CC` is not yet
verified. Do not treat that part as settled.

**Next step**: finish the disassembler (add `XCE`/`REP`/`SEP`/`XBA`/`PHD`/`PLD`/`STZ`/
`TCD`/`TSB`/`TRB`/`COP` and the 65816 long forms), then confirm which E1 vectors
`$FFB7CC` dispatches to and who is supposed to fill them. The alternative is to let the
ROM's own interrupt-init run instead of synthesising the table - note the existing
comment in `iigsInitInterrupts()` that installing `$FFB7CC` "spins and never reaches the
OS event loop"; that judgement was made without knowing the stub table is all unclaimed,
and is worth re-testing.

---
