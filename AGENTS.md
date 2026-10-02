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

**Analysis**:
1. The Wide stack implementation (push8Wide/pop8Wide/push16Wide/pop16Wide) appears correct based on web-a2e reference
2. First JSL at `ff:841c → e1:004c` works perfectly (pushes `$FF:841F`, RTL correctly returns to `ff:8420`)
3. The crash occurs when RTL at `ff:859e` pops from stack location `$01E1-$01E3` which was NOT written by any JSL
4. ROM code appears to manually construct fake return addresses on stack (via TXS/TCS operations seen at `ff:84d9-ff:84ec`)
5. The manually constructed return address at `$01E1-$01E3` contains wrong data, causing jump to `ff:0005`
6. `ff:0005` or nearby code leads to `ff:b5e0` which may legitimately contain RTL (0x6B) opcode
7. Because there's no valid return address on stack, RTL keeps popping garbage in an infinite loop

**Possible Root Causes**:
- The ROM's manual stack manipulation code expects different stack layout than what we're providing
- Our JSL might be pushing bytes in wrong order (though it matches web-a2e)
- Bank E0/E1 memory mapping might still be incorrect, causing the manual stack writes to go to wrong location
- Some other instruction (TXS, TSC, TCS, PLD, PHD) might have incorrect implementation
- The manual return address construction at `ff:84d9-ff:84ec` might be reading corrupted data from Direct Page

**Current State**: Need to investigate why the manually-constructed return address at `$01E1-$01E3` contains `$FF:0004` instead of expected value (likely `$FF:859C` based on earlier traces showing `A=$859C`).

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
- **Reference Implementation**: Consulted `c:\dev\web-a2e` (Mike Daley's web-a2e project) for correct IIgs memory mapping, clock, and hardware implementation.
