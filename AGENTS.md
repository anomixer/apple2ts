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

### 7. Infinite RTL Loop at ff:b5e0 (Current Issue - UNSOLVED)
**Issue**: After the first few JSL/RTL pairs work correctly, the system enters an infinite loop executing RTL instructions at address `ff:b5e0`. The RTL repeatedly pops garbage data from the stack, with SP cycling from `$01xx` down through `$00xx`, wrapping around to `$FFxx`, and eventually being normalized back to `$01xx`, creating an endless cycle.

**Symptoms**:
- First 4 JSL operations execute correctly and return properly
- At `ff:84ee`, RTL pops from `$01DE` and returns to `ff:859d` (seems correct based on manual stack setup by ROM)
- At `ff:859e`, RTL pops from `$01E1` and returns to **`ff:0005`** (WRONG - no JSL pushed this)
- System then enters infinite loop at `ff:b5e0` executing hundreds of RTL instructions
- Each RTL pops 3 bytes of garbage, returning to random addresses like `08:8806`, `88:0886`, `c0:0585`, etc.
- SP cycles: `$01DF` → `$0000` → `$FFFF` → normalized back to `$01xx` → repeats

**Key Trace Evidence**:
```
[JSL] at ff:841c → e1:004c, push PB=$ff PC=$841f, SP=$01b7
[JSL] after push: SP=$01b4
[RTL] at ff:b5e0, SP=$01b4
[RTL] popped: PB=$ff PC=$8420, SP=$01b7  ✓ CORRECT!

[RTL] at ff:84ee, SP=$01de
[RTL] popped: PB=$ff PC=$859d, SP=$01e1  ✓ (manual stack setup)

[RTL] at ff:859e, SP=$01e1  ← NO JSL PUSHED THIS!
[RTL] popped: PB=$ff PC=$0005, SP=$01e4  ✗ WRONG!

[RTL] at ff:b5e0, SP=$01e0  ← INFINITE LOOP STARTS
[RTL] popped: PB=$00 PC=$0907, SP=$01e3
[RTL] at ff:b5e0, SP=$01df
[RTL] popped: PB=$c0 PC=$0585, SP=$01e2
... (hundreds more)
```

**Analysis**:
1. **Wide stack implementation is correct**: Verified against web-a2e, first JSL/RTL pair works perfectly
2. **Manual stack construction**: ROM code at `ff:84d9-ff:84ec` manually builds return address:
   ```
   PC=ff:84d9 Opcode=3b  // TSC - Transfer SP to A
   PC=ff:84da Opcode=18  // CLC
   PC=ff:84db Opcode=69  // ADC #$16 - A = SP + $16
   PC=ff:84de Opcode=1b  // TCS - Transfer A to SP (SP now = $01BA + $16 = $01D0)
   PC=ff:84df Opcode=65  // ADC $xx - Add something from Direct Page
   PC=ff:84e1 Opcode=69  // ADC #$04 - A = $01DA
   PC=ff:84e4 Opcode=aa  // TAX - X = $01DE
   PC=ff:84e5 Opcode=ab  // PLB - Pop data bank (uses Wide pop)
   PC=ff:84e6 Opcode=28  // PLP - Pop processor status
   PC=ff:84e7 Opcode=2b  // PLD - Pop direct page (uses Wide pop)
   PC=ff:84e8 Opcode=98  // TYA - A = Y = 0
   PC=ff:84e9 Opcode=c9  // CMP #$xx
   PC=ff:84ec Opcode=9a  // TXS - SP = X = $01DE
   PC=ff:84ed Opcode=6b  // RTL - Pop from $01DE
   ```
3. **The problem**: Code at `ff:84d5` writes `A=$859C` to Direct Page via `STA $xx,X`, expecting this to become the return address. But when RTL pops from `$01E1-$01E3`, it reads `$FF:0004` instead of `$FF:859C`.

**Possible Root Causes**:
1. **Direct Page addressing bug**: The `STA $xx,X` at `ff:84d5` might be writing to wrong location due to incorrect Direct Page (D register) calculation
2. **Bank E0/E1 memory mapping still wrong**: Even though we fixed it to use Mega II, there might be additional issues with language card bank switching
3. **TSC/TCS/TXS implementation bug**: These instructions (0x3B, 0x1B, 0x9A) might not be correctly implemented
4. **PLD (0x2B) corruption**: If PLD pops wrong value and sets D register incorrectly, subsequent Direct Page accesses will be wrong
5. **Data in Direct Page is corrupted**: Earlier code might have written wrong values to Direct Page that ROM is now reading

**Next Steps to Debug**:
1. **Add logging to TSC/TCS/TXS**: Verify these instructions correctly transfer values
2. **Add logging to Direct Page operations**: Log D register value and effective addresses for `addrDirect()`, `addrDirectX()`, `STA $xx,X`
3. **Dump Direct Page memory**: Before the manual stack construction at `ff:84d9`, dump memory at Direct Page base (D register value) to see what's there
4. **Check PLD implementation**: At `ff:84e7`, verify PLD pops correct value and sets D register properly
5. **Disassemble ff:84cb-ff:84d7**: Understand what code is supposed to write to Direct Page before the manual stack setup
6. **Compare with web-a2e execution**: If possible, trace web-a2e execution at same point to see correct values

### 8. Missing IRQ Entry / Interrupt Manager (The "Boot Gate Loop" Bug — RESOLVED)
**Issue**: The IIgs boot was stuck in the ROM's boot gate (`ff:84fc`, the `bmi $8549` at `ff:8555`). The gate polls `$C046` bit 7, which is only set when an interrupt source is pending AND enabled. The ROM's interrupt-init routine (`ff:78` region, which installs the interrupt manager into `E1:$0010-$0013` and writes `INTEN=$08` via `sta $c041`) was never reached, so `INTEN` stayed 0, `$C046` bit 7 never fired, and the gate looped forever. Worse, the ROM's own BRKs (`ff:a0ef`, `ff:b61d`, `ff:b522`) jumped to `E1:$0010=0` (the uninitialized interrupt manager), causing an infinite BRK storm.

**Root cause**: The `CPU65816` had **no IRQ entry point**. web-a2e's `CPU65816::executeInstruction()` samples the IRQ line once per instruction and, if the I flag is clear, services it before the next fetch. apple2ts never latched an IRQ or serviced it, so VBL never reached the CPU, and the interrupt manager (which the ROM installs in E1 during its interrupt-init) never ran.

**Fix** (mirrors web-a2e `cpu65816.cpp`/`cpu65816_dispatch.cpp`):
1. Added `irqPending` field, `irq()` method (latches the line), and per-instruction sampling in `processInstruction()`: `if (!I && irqPending) { irqPending=false; interrupt(VEC_N_IRQ, VEC_E_IRQ, false); return 7; }`.
2. Added `interrupt()` method (verbatim from web-a2e): native → push PB + PC16 + P; emulation → push PC16 + P with bit 4 = the 6502 B flag (SET for software BRK, CLEARED for hardware IRQ); then set I, clear D, PB=0, PC = vector ($FFEE native / $FFFE emulation). Refactored BRK/COP to use it.
3. Added `iigsInitInterrupts()` in `memory.ts` that installs the interrupt manager entry `E1:$0010-$0013 = JML $FF79C8` (the ROM's full interrupt manager at `ff:79c8`) and sets `INTEN=$08` — mirroring what the ROM's `ff:78` region would do. Called from `doReset()` (APPLE2GS path).
4. Wired VBL → IRQ: `motherboard.ts` now calls `iigsSignalVbl()` + `cpu.irq()` when VBL fires (APPLE2GS path).

**Result**: The boot now completes — POST, gate exits via `$C046` bit 7 (VBL with INTEN=$08), runs the installer (`ff:a1b8`), JMLs to `ff:7140` (OS entry), and reaches the installer's ADB event loop. `gs_boot.test.ts` asserts `sawInstaller=true` and passes. The `$C046` bit 7 = `(vblPending && INTEN&0x08) || (quarterSecondPending && INTEN&0x10)` path is now exercised.

**Key detail — the interrupt manager entry**: `E1:$0010-$0013 = [5c, c8, 79, ff]` (JML $FF79C8). The ROM's interrupt manager at `ff:79c8` reads `$C023` (VGC status) and RTIs; it does NOT clear `vblPending`, so `$C046` bit 7 stays set once INTEN=$08 and VBL fires — this is what lets the gate exit.

### 9. ADB Register Wiring ($C024-$C027) — RESOLVED
**Issue**: The ADB controller was only partially wired. `$C026`/`$C027` reads/writes still used the fake `iigsRegisters[0x26]/[0x27]` array (the "pretend ADB responds" stub from issue #4), instead of the real `IIGSADB` controller from `iigs_adb.ts`. The mouse (`$C024`) and modifiers (`$C025`) were already real, but the command/response queue was not.

**Fix** (mirrors web-a2e `iigs_memory.cpp` `readIO`/`writeIO`):
- `$C026` read → `iigsADB.readData()` (shifts a byte off the response queue); write → `iigsADB.writeCommand(value)`.
- `$C027` read → `iigsADB.readStatus()` (reports what is really pending: bit5 data-available, bit2 keyboard, bit4 command-full, plus the interrupt enables); write → `iigsADB.writeStatus(value)` (stores only `STATUS_INTERRUPT_ENABLES`).
- Removed the fake `| 0x20` "always controller-ready" and the `|= 0x80` "data-ready" stub.

**Result**: The OS now talks to the real ADB controller during init — `gs_boot_out.txt` shows `$C026` writes `7 0 32 0 24` (the ADB init command sequence: SYNC, read-modules, etc.) at steps ~43k, each answered by `completeCommand()` pushing a response that `readStatus()` reports via bit5. `gs_boot.test.ts` still passes (`sawInstaller=true`, `seaOfFF=false`).

## Reference Implementation (web-a2e)
When stuck, always reference `c:\dev\web-a2e` - a working C++ implementation of Apple IIgs emulation. Key learnings:

### $C071-$C07F: BRK/IRQ Handler Firmware
- **Not I/O registers!** This region contains actual 8-bit firmware code
- The IIgs BRK/IRQ vectors ($00:FFE6, $00:FFFE) point here (e.g., $C071 for BRK, $C074 for IRQ)
- This firmware code does: set status flags, then JML (Jump Long) to the 16-bit interrupt manager in Bank $E1
- **Must read from Bank $FF ROM**, not from memory or Bus
- Without this, every BRK/IRQ jumps to zeros and crashes

### Clock ($C033/$C034) Implementation
- $C033: Clock Data register (serial interface)
- $C034: Clock Control register (top 4 bits) + Border Color (bottom 4 bits)
- Clock chip has 256 bytes of battery RAM (settings, Control Panel data)
- Clock transaction is multi-step: Command → Address → Data
- See `iigs_clock.cpp` for complete state machine implementation

### ADB ($C024-$C027) Registers
- $C024: ADB Mouse Data
- $C025: ADB Modifiers (keyboard modifiers)
- $C026: ADB Data (command/response queue)
- $C027: ADB Status - **Bit 5 must be 1** during boot (controller ready)
- Without Bit 5 set, the OS times out waiting for ADB and triggers Fatal System Error 0911

## Debugging Techniques Used
- **Instruction Tracing**: Added a circular buffer in `motherboard.ts` to trace the last 100 instructions (PC, Opcode, Registers) when the CPU executed more than 3 million cycles without progressing.
- **ROM Inspection**: Dumped specific sections of the base64-encoded `gsROM` via Node.js scripts to disassemble the infinite loops (e.g., at `$B670` and `$8440`) and identify which hardware registers the OS was polling.
- **Reference Implementation Analysis**: Systematically compared our implementation against web-a2e's working C++ code to identify behavioral differences in stack operations, memory mapping, and I/O handling.
- **JSL/RTL Detailed Logging**: Added console logging to JSL and RTL instructions showing exact addresses, values pushed/popped, and SP before/after each operation to trace stack corruption.

## Key Files Modified
- `src/worker/cpu65816.ts`: 65816 CPU emulation, JSL/RTL/PHD/PLD/PHB/PLB/PHK/PEA/PEI/PER stack operations; **IRQ entry** (`irqPending`, `irq()`, `interrupt()` per-instruction sampling)
- `src/worker/memory.ts`: Memory mapping for Bank E0/E1 (Mega II), Bank FE/FF (ROM), IIgs I/O registers; **`iigsInitInterrupts()`** (installs interrupt manager + INTEN); **ADB $C024-$C027 wiring** to `iigsADB`
- `src/worker/iigs_adb.ts`: ADB controller emulation (command/response queue, status, mouse, modifiers, keyboard) mirroring web-a2e `iigs_adb.cpp`
- `src/worker/iigs_clock.ts`: IIgs clock chip emulation with RTC and battery RAM
- `src/worker/motherboard.ts`: Main emulation loop, cycle counting, instruction tracing; **VBL→IRQ wiring** for the IIgs
- `check_gs_rom.cjs`, `disasm_reset.cjs`, `check_vectors.cjs`, `disasm_gs.cjs`, `scan_c041.cjs`, `scan_e1.cjs`: ROM inspection utilities

## Reference Materials
- **web-a2e**: Working C++ Apple IIgs emulator at `c:\dev\web-a2e\src\core\`
  - `iigs\iigs_memory.cpp`: Memory mapping implementation
  - `cpu\65816\cpu65816.cpp`: CPU core with stack operations
  - `iigs\iigs_clock.cpp`: Clock chip implementation
- **Apple IIgs Hardware Reference Manual**: Official hardware specifications (search online for "Apple IIgs Hardware Reference Guide PDF")
- **Reference Implementation**: Consulted `c:\dev\web-a2e` (Mike Daley's web-a2e project) for correct IIgs memory mapping, clock, and hardware implementation.
