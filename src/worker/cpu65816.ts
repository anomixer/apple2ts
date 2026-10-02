/**
 * cpu65816.ts - 65C816 CPU emulation skeleton for Apple IIgs
 * 
 * Based on the upstream web-a2e implementation.
 */

export enum Status816 {
    C = 0x01, // Carry
    Z = 0x02, // Zero
    I = 0x04, // Interrupt disable
    D = 0x08, // Decimal
    X = 0x10, // Index registers are 8 bits (native); Break (emulation)
    M = 0x20, // Accumulator is 8 bits (native); unused, always 1 (emulation)
    V = 0x40, // Overflow
    N = 0x80  // Negative
}

// Vectors
export const VEC_E_NMI = 0xFFFA;
export const VEC_E_RESET = 0xFFFC;
export const VEC_E_IRQ = 0xFFFE;
export const VEC_E_ABORT = 0xFFF8;
export const VEC_E_COP = 0xFFF4;

export const VEC_N_NMI = 0xFFEA;
export const VEC_N_IRQ = 0xFFEE;
export const VEC_N_BRK = 0xFFE6;
export const VEC_N_ABORT = 0xFFE8;
export const VEC_N_COP = 0xFFE4;

export type ReadCallback = (address: number) => number;
export type WriteCallback = (address: number, value: number) => void;
export type VectorReadCallback = (address: number) => number;

import { ICPU } from "./icpu";

export class CPU65816 implements ICPU {
    // 16-bit Accumulator (A) and 8-bit Data Bank (B is hidden in high byte when 8-bit)
    public A: number = 0; 
    public X: number = 0;
    public Y: number = 0;
    public S: number = 0; // Stack pointer
    public D: number = 0; // Direct Page
    
    // Program Counter (16-bit) and Program Bank (8-bit)
    public PC: number = 0;
    public PB: number = 0;
    public DB: number = 0; // Data Bank (8-bit)

    public P: number = 0; // Processor Status
    
    public emulationMode: boolean = true;
    public stopped: boolean = false;
    public waiting: boolean = false;

    private readMemory: ReadCallback;
    private writeMemory: WriteCallback;
    private readVector: VectorReadCallback | null = null;

    constructor(readMemory: ReadCallback, writeMemory: WriteCallback) {
        this.readMemory = readMemory;
        this.writeMemory = writeMemory;
    }

    public setVectorReadCallback(cb: VectorReadCallback) {
        this.readVector = cb;
    }

    public reset() {
        this.emulationMode = true;
        this.D = 0x0000;
        this.DB = 0x00;
        this.PB = 0x00;
        this.S = 0x01FF; // Emulation mode stack
        this.X = 0x00;
        this.Y = 0x00;
        
        // Reset flags for emulation mode
        this.setFlag(Status816.M, true);
        this.setFlag(Status816.X, true);
        this.setFlag(Status816.I, true);

        // Fetch reset vector (from bank 0)
        let vector = VEC_E_RESET;
        let low = this.readVector ? this.readVector(vector) : this.readMemory(vector);
        let high = this.readVector ? this.readVector(vector + 1) : this.readMemory(vector + 1);
        this.PC = low | (high << 8);

        this.stopped = false;
        this.waiting = false;
    }

    private traceBuffer: string[] = [];
    private ffCount = 0;
    private dumped = false;

    public processInstruction(traceCallback?: ((str: string) => void) | null): number {
        if (this.stopped || this.waiting) return 1; // Burn 1 cycle

        const pc = this.PC;
        const pb = this.PB;
        const opcode = this.fetch8();
        
        if (!this.dumped) {
            const tr = `PC=${pb.toString(16).padStart(2, '0')}:${pc.toString(16).padStart(4, '0')} Opcode=${opcode.toString(16).padStart(2, '0')} A=${this.A.toString(16)} X=${this.X.toString(16)} Y=${this.Y.toString(16)} S=${this.S.toString(16)} P=${this.P.toString(16)}`;
            this.traceBuffer.push(tr);
            if (this.traceBuffer.length > 100) this.traceBuffer.shift();

            if (opcode === 0xFF) {
                this.ffCount++;
                if (this.ffCount > 20) {
                    console.log("CRASHED INTO SEA OF FF! Last 100 instructions:");
                    console.log(this.traceBuffer.join('\n'));
                    this.dumped = true;
                }
            } else {
                this.ffCount = 0;
            }
        }
        
        this.executeOpcode(opcode);
        
        // Return 1 cycle for now as placeholder
        return 1;
    }

    private executeOpcode(opcode: number) {
        switch (opcode) {
            // --- LDA ---
            case 0xA9: this.opLDA(this.addrImmediate(this.getFlag(Status816.M))); break;
            case 0xA5: this.opLDA(this.addrDirect()); break;
            case 0xB5: this.opLDA(this.addrDirectX()); break;
            case 0xB2: this.opLDA(this.addrDirectIndirect()); break;
            case 0xAF: this.opLDA(this.addrAbsoluteLong()); break;
            case 0xAD: this.opLDA(this.addrAbsolute()); break;
            // ... (skipping some for brevity) ...

            // --- STA ---
            case 0x85: this.opSTA(this.addrDirect()); break;
            case 0x95: this.opSTA(this.addrDirectX()); break;
            case 0x92: this.opSTA(this.addrDirectIndirect()); break;
            case 0x8F: this.opSTA(this.addrAbsoluteLong()); break;
            case 0x8D: this.opSTA(this.addrAbsolute()); break;
            // ...

            // --- ORA ---
            case 0x09: this.opORA(this.addrImmediate(this.getFlag(Status816.M))); break;
            case 0x05: this.opORA(this.addrDirect()); break;
            case 0x15: this.opORA(this.addrDirectX()); break;
            case 0x12: this.opORA(this.addrDirectIndirect()); break;
            case 0x01: this.opORA(this.addrDirectIndexedIndirect()); break;
            case 0x11: this.opORA(this.addrDirectIndirectIndexed()); break;
            case 0x07: this.opORA(this.addrDirectIndirectLong()); break;
            case 0x17: this.opORA(this.addrDirectIndirectLongIndexed()); break;
            case 0x0D: this.opORA(this.addrAbsolute()); break;
            case 0x1D: this.opORA(this.addrAbsoluteX()); break;
            case 0x19: this.opORA(this.addrAbsoluteY()); break;
            case 0x0F: this.opORA(this.addrAbsoluteLong()); break;
            case 0x1F: this.opORA(this.addrAbsoluteLongX()); break;
            case 0x03: this.opORA(this.addrStackRelative()); break;
            case 0x13: this.opORA(this.addrStackRelativeIndirectIndexed()); break;

            // --- AND ---
            case 0x29: this.opAND(this.addrImmediate(this.getFlag(Status816.M))); break;
            case 0x25: this.opAND(this.addrDirect()); break;
            case 0x35: this.opAND(this.addrDirectX()); break;
            case 0x32: this.opAND(this.addrDirectIndirect()); break;
            case 0x21: this.opAND(this.addrDirectIndexedIndirect()); break;
            case 0x31: this.opAND(this.addrDirectIndirectIndexed()); break;
            case 0x27: this.opAND(this.addrDirectIndirectLong()); break;
            case 0x37: this.opAND(this.addrDirectIndirectLongIndexed()); break;
            case 0x2D: this.opAND(this.addrAbsolute()); break;
            case 0x3D: this.opAND(this.addrAbsoluteX()); break;
            case 0x39: this.opAND(this.addrAbsoluteY()); break;
            case 0x2F: this.opAND(this.addrAbsoluteLong()); break;
            case 0x3F: this.opAND(this.addrAbsoluteLongX()); break;
            case 0x23: this.opAND(this.addrStackRelative()); break;
            case 0x33: this.opAND(this.addrStackRelativeIndirectIndexed()); break;

            // --- EOR ---
            case 0x49: this.opEOR(this.addrImmediate(this.getFlag(Status816.M))); break;
            case 0x45: this.opEOR(this.addrDirect()); break;
            case 0x55: this.opEOR(this.addrDirectX()); break;
            case 0x52: this.opEOR(this.addrDirectIndirect()); break;
            case 0x41: this.opEOR(this.addrDirectIndexedIndirect()); break;
            case 0x51: this.opEOR(this.addrDirectIndirectIndexed()); break;
            case 0x47: this.opEOR(this.addrDirectIndirectLong()); break;
            case 0x57: this.opEOR(this.addrDirectIndirectLongIndexed()); break;
            case 0x4D: this.opEOR(this.addrAbsolute()); break;
            case 0x5D: this.opEOR(this.addrAbsoluteX()); break;
            case 0x59: this.opEOR(this.addrAbsoluteY()); break;
            case 0x4F: this.opEOR(this.addrAbsoluteLong()); break;
            case 0x5F: this.opEOR(this.addrAbsoluteLongX()); break;
            case 0x43: this.opEOR(this.addrStackRelative()); break;
            case 0x53: this.opEOR(this.addrStackRelativeIndirectIndexed()); break;

            // --- CMP ---
            case 0xC9: this.opCMP(this.addrImmediate(this.getFlag(Status816.M))); break;
            case 0xC5: this.opCMP(this.addrDirect()); break;
            case 0xD5: this.opCMP(this.addrDirectX()); break;
            case 0xD2: this.opCMP(this.addrDirectIndirect()); break;
            case 0xC1: this.opCMP(this.addrDirectIndexedIndirect()); break;
            case 0xD1: this.opCMP(this.addrDirectIndirectIndexed()); break;
            case 0xC7: this.opCMP(this.addrDirectIndirectLong()); break;
            case 0xD7: this.opCMP(this.addrDirectIndirectLongIndexed()); break;
            case 0xCD: this.opCMP(this.addrAbsolute()); break;
            case 0xDD: this.opCMP(this.addrAbsoluteX()); break;
            case 0xD9: this.opCMP(this.addrAbsoluteY()); break;
            case 0xCF: this.opCMP(this.addrAbsoluteLong()); break;
            case 0xDF: this.opCMP(this.addrAbsoluteLongX()); break;
            case 0xC3: this.opCMP(this.addrStackRelative()); break;
            case 0xD3: this.opCMP(this.addrStackRelativeIndirectIndexed()); break;

            // --- ADC ---
            case 0x69: this.opADC(this.addrImmediate(this.getFlag(Status816.M))); break;
            case 0x65: this.opADC(this.addrDirect()); break;
            case 0x75: this.opADC(this.addrDirectX()); break;
            case 0x72: this.opADC(this.addrDirectIndirect()); break;
            case 0x61: this.opADC(this.addrDirectIndexedIndirect()); break;
            case 0x71: this.opADC(this.addrDirectIndirectIndexed()); break;
            case 0x67: this.opADC(this.addrDirectIndirectLong()); break;
            case 0x77: this.opADC(this.addrDirectIndirectLongIndexed()); break;
            case 0x6D: this.opADC(this.addrAbsolute()); break;
            case 0x7D: this.opADC(this.addrAbsoluteX()); break;
            case 0x79: this.opADC(this.addrAbsoluteY()); break;
            case 0x6F: this.opADC(this.addrAbsoluteLong()); break;
            case 0x7F: this.opADC(this.addrAbsoluteLongX()); break;
            case 0x63: this.opADC(this.addrStackRelative()); break;
            case 0x73: this.opADC(this.addrStackRelativeIndirectIndexed()); break;

            // --- SBC ---
            case 0xE9: this.opSBC(this.addrImmediate(this.getFlag(Status816.M))); break;
            case 0xE5: this.opSBC(this.addrDirect()); break;
            case 0xF5: this.opSBC(this.addrDirectX()); break;
            case 0xF2: this.opSBC(this.addrDirectIndirect()); break;
            case 0xE1: this.opSBC(this.addrDirectIndexedIndirect()); break;
            case 0xF1: this.opSBC(this.addrDirectIndirectIndexed()); break;
            case 0xE7: this.opSBC(this.addrDirectIndirectLong()); break;
            case 0xF7: this.opSBC(this.addrDirectIndirectLongIndexed()); break;
            case 0xED: this.opSBC(this.addrAbsolute()); break;
            case 0xFD: this.opSBC(this.addrAbsoluteX()); break;
            case 0xF9: this.opSBC(this.addrAbsoluteY()); break;
            case 0xEF: this.opSBC(this.addrAbsoluteLong()); break;
            case 0xFF: this.opSBC(this.addrAbsoluteLongX()); break;
            case 0xE3: this.opSBC(this.addrStackRelative()); break;
            case 0xF3: this.opSBC(this.addrStackRelativeIndirectIndexed()); break;
            // --- LDX ---
            case 0xA2: this.opLDX(this.addrImmediate(this.getFlag(Status816.X))); break;
            case 0xA6: this.opLDX(this.addrDirect()); break;
            case 0xB6: this.opLDX(this.addrDirectY()); break;
            case 0xAE: this.opLDX(this.addrAbsolute()); break;
            case 0xBE: this.opLDX(this.addrAbsoluteY()); break;

            // --- LDY ---
            case 0xA0: this.opLDY(this.addrImmediate(this.getFlag(Status816.X))); break;
            case 0xA4: this.opLDY(this.addrDirect()); break;
            case 0xB4: this.opLDY(this.addrDirectX()); break;
            case 0xAC: this.opLDY(this.addrAbsolute()); break;
            case 0xBC: this.opLDY(this.addrAbsoluteX()); break;

            // --- STX ---
            case 0x86: this.opSTX(this.addrDirect()); break;
            case 0x96: this.opSTX(this.addrDirectY()); break;
            case 0x8E: this.opSTX(this.addrAbsolute()); break;

            // --- STY ---
            case 0x84: this.opSTY(this.addrDirect()); break;
            case 0x94: this.opSTY(this.addrDirectX()); break;
            case 0x8C: this.opSTY(this.addrAbsolute()); break;

            // --- CPX ---
            case 0xE0: this.opCPX(this.addrImmediate(this.getFlag(Status816.X))); break;
            case 0xE4: this.opCPX(this.addrDirect()); break;
            case 0xEC: this.opCPX(this.addrAbsolute()); break;

            // --- CPY ---
            case 0xC0: this.opCPY(this.addrImmediate(this.getFlag(Status816.X))); break;
            case 0xC4: this.opCPY(this.addrDirect()); break;
            case 0xCC: this.opCPY(this.addrAbsolute()); break;

            // --- Branches ---
            case 0x90: this.doBranch(!this.getFlag(Status816.C)); break; // BCC
            case 0xB0: this.doBranch(this.getFlag(Status816.C)); break;  // BCS
            case 0xD0: this.doBranch(!this.getFlag(Status816.Z)); break; // BNE
            case 0xF0: this.doBranch(this.getFlag(Status816.Z)); break;  // BEQ
            case 0x10: this.doBranch(!this.getFlag(Status816.N)); break; // BPL
            case 0x30: this.doBranch(this.getFlag(Status816.N)); break;  // BMI
            case 0x50: this.doBranch(!this.getFlag(Status816.V)); break; // BVC
            case 0x70: this.doBranch(this.getFlag(Status816.V)); break;  // BVS
            case 0x80: this.doBranch(true); break; // BRA (Branch Always)
            case 0x82: this.doBranch(true, true); break; // BRL (Branch Always Long)

            // --- INC (Memory) ---
            case 0xE6: this.opINC(this.addrDirect()); break;
            case 0xF6: this.opINC(this.addrDirectX()); break;
            case 0xEE: this.opINC(this.addrAbsolute()); break;
            case 0xFE: this.opINC(this.addrAbsoluteX()); break;
            // INC A (Accumulator) is 0x1A
            case 0x1A:
                const eightBit = this.getFlag(Status816.M);
                this.A++;
                if (eightBit) {
                    this.A = (this.A & 0xFF00) | ((this.A & 0xFF));
                    this.setFlag(Status816.Z, (this.A & 0xFF) === 0);
                    this.setFlag(Status816.N, (this.A & 0x80) !== 0);
                } else {
                    this.A &= 0xFFFF;
                    this.setFlag(Status816.Z, this.A === 0);
                    this.setFlag(Status816.N, (this.A & 0x8000) !== 0);
                }
                break;

            // --- DEC (Memory) ---
            case 0xC6: this.opDEC(this.addrDirect()); break;
            case 0xD6: this.opDEC(this.addrDirectX()); break;
            case 0xCE: this.opDEC(this.addrAbsolute()); break;
            case 0xDE: this.opDEC(this.addrAbsoluteX()); break;
            // DEC A (Accumulator) is 0x3A
            case 0x3A:
                const eightBitDec = this.getFlag(Status816.M);
                this.A--;
                if (eightBitDec) {
                    this.A = (this.A & 0xFF00) | ((this.A & 0xFF));
                    this.setFlag(Status816.Z, (this.A & 0xFF) === 0);
                    this.setFlag(Status816.N, (this.A & 0x80) !== 0);
                } else {
                    this.A &= 0xFFFF;
                    this.setFlag(Status816.Z, this.A === 0);
                    this.setFlag(Status816.N, (this.A & 0x8000) !== 0);
                }
                break;

            // --- INX, DEX, INY, DEY ---
            case 0xE8: this.opINX(); break;
            case 0xCA: this.opDEX(); break;
            case 0xC8: this.opINY(); break;
            case 0x88: this.opDEY(); break;

            // --- Flags ---
            case 0x18: this.setFlag(Status816.C, false); break; // CLC
            case 0x38: this.setFlag(Status816.C, true); break;  // SEC
            case 0x58: this.setFlag(Status816.I, false); break; // CLI
            case 0x78: this.setFlag(Status816.I, true); break;  // SEI
            case 0xB8: this.setFlag(Status816.V, false); break; // CLV
            case 0xD8: this.setFlag(Status816.D, false); break; // CLD
            case 0xF8: this.setFlag(Status816.D, true); break;  // SED

            // --- Register Transfers ---
            case 0xAA: this.opTransfer('A', 'X'); break; // TAX
            case 0x8A: this.opTransfer('X', 'A'); break; // TXA
            case 0xA8: this.opTransfer('A', 'Y'); break; // TAY
            case 0x98: this.opTransfer('Y', 'A'); break; // TYA
            case 0xBA: this.opTransfer('S', 'X'); break; // TSX
            case 0x9A: this.opTransfer('X', 'S'); break; // TXS
            case 0x9B: this.opTransfer('X', 'Y'); break; // TXY
            case 0xBB: this.opTransfer('Y', 'X'); break; // TYX
            case 0x5B: this.opTransfer('A', 'D'); break; // TCD
            case 0x7B: this.opTransfer('D', 'A'); break; // TDC
            case 0x3B: this.opTransfer('S', 'A'); break; // TSC
            case 0x1B: this.opTransfer('A', 'S'); break; // TCS
            case 0xEB: this.opXBA(); break; // XBA

            // --- Stack Operations ---
            case 0x48: this.opPush('A'); break; // PHA
            case 0x68: this.opPop('A'); break;  // PLA
            case 0xDA: this.opPush('X'); break; // PHX
            case 0xFA: this.opPop('X'); break;  // PLX
            case 0x5A: this.opPush('Y'); break; // PHY
            case 0x7A: this.opPop('Y'); break;  // PLY
            case 0x08: this.opPush('P'); break; // PHP
            case 0x28: this.opPop('P'); break;  // PLP
            case 0x8B: this.opPush('B'); break; // PHB
            case 0xAB: this.opPop('B'); break;  // PLB
            case 0x0B: this.opPush('D'); break; // PHD
            case 0x2B: this.opPop('D'); break;  // PLD
            case 0x4B: this.opPush('K'); break; // PHK
            case 0xF4: this.opPush('PEA', this.fetch16()); break; // PEA
            case 0xD4: this.opPush('PEI', this.addrDirectIndirect()); break; // PEI
            case 0x62: this.opPush('PER', this.fetch16()); break; // PER

            // --- Shifts and Rotates ---
            case 0x0A: this.opShift('ASL', -1); break; // ASL A
            case 0x06: this.opShift('ASL', this.addrDirect()); break;
            case 0x16: this.opShift('ASL', this.addrDirectX()); break;
            case 0x0E: this.opShift('ASL', this.addrAbsolute()); break;
            case 0x1E: this.opShift('ASL', this.addrAbsoluteX()); break;

            case 0x4A: this.opShift('LSR', -1); break; // LSR A
            case 0x46: this.opShift('LSR', this.addrDirect()); break;
            case 0x56: this.opShift('LSR', this.addrDirectX()); break;
            case 0x4E: this.opShift('LSR', this.addrAbsolute()); break;
            case 0x5E: this.opShift('LSR', this.addrAbsoluteX()); break;

            case 0x2A: this.opShift('ROL', -1); break; // ROL A
            case 0x26: this.opShift('ROL', this.addrDirect()); break;
            case 0x36: this.opShift('ROL', this.addrDirectX()); break;
            case 0x2E: this.opShift('ROL', this.addrAbsolute()); break;
            case 0x3E: this.opShift('ROL', this.addrAbsoluteX()); break;

            case 0x6A: this.opShift('ROR', -1); break; // ROR A
            case 0x66: this.opShift('ROR', this.addrDirect()); break;
            case 0x76: this.opShift('ROR', this.addrDirectX()); break;
            case 0x6E: this.opShift('ROR', this.addrAbsolute()); break;
            case 0x7E: this.opShift('ROR', this.addrAbsoluteX()); break;

            // --- Bit Operations ---
            case 0x89: this.opBIT(this.addrImmediate(this.getFlag(Status816.M))); break;
            case 0x24: this.opBIT(this.addrDirect()); break;
            case 0x2C: this.opBIT(this.addrAbsolute()); break;
            case 0x34: this.opBIT(this.addrDirectX()); break;
            case 0x3C: this.opBIT(this.addrAbsoluteX()); break;
            case 0x14: this.opTRB(this.addrDirect()); break;
            case 0x1C: this.opTRB(this.addrAbsolute()); break;
            case 0x04: this.opTSB(this.addrDirect()); break;
            case 0x0C: this.opTSB(this.addrAbsolute()); break;

            // --- Jumps and Returns ---
            case 0x4C: this.PC = this.addrAbsolute() & 0xFFFF; break; // JMP abs
            case 0x6C: this.PC = this.addrAbsoluteIndirect() & 0xFFFF; break; // JMP (abs)
            case 0x7C: this.PC = this.addrAbsoluteIndexedIndirect() & 0xFFFF; break; // JMP (abs,X)
            case 0x5C: 
                const jmpLong = this.addrAbsoluteLong();
                this.PC = jmpLong & 0xFFFF;
                this.PB = (jmpLong >> 16) & 0xFF;
                break; // JML
            case 0xDC: 
                const jmpLongInd = this.addrAbsoluteIndirectLong();
                this.PC = jmpLongInd & 0xFFFF;
                this.PB = (jmpLongInd >> 16) & 0xFF;
                break; // JML [abs]
            
            case 0x20: // JSR abs
                this.push16((this.PC + 1) & 0xFFFF);
                this.PC = this.addrAbsolute() & 0xFFFF;
                break;
            case 0xFC: // JSR (abs,X)
                this.push16((this.PC + 1) & 0xFFFF);
                this.PC = this.addrAbsoluteIndexedIndirect() & 0xFFFF;
                break;
            case 0x22: // JSL
                const jslTarget = this.addrAbsoluteLong();
                console.log(`[JSL] at ${this.PB.toString(16)}:${((this.PC-4)&0xFFFF).toString(16).padStart(4,'0')} → ${(jslTarget>>16).toString(16)}:${(jslTarget&0xFFFF).toString(16).padStart(4,'0')}, push PB=$${this.PB.toString(16).padStart(2,'0')} PC=$${((this.PC-1)&0xFFFF).toString(16).padStart(4,'0')}, SP=$${this.S.toString(16).padStart(4,'0')}`);
                this.push8Wide(this.PB);
                this.push16Wide((this.PC - 1) & 0xFFFF); // PC is already incremented by 3 for abs long
                this.normaliseStack();
                this.PB = (jslTarget >> 16) & 0xFF;
                this.PC = jslTarget & 0xFFFF;
                console.log(`[JSL] after push: SP=$${this.S.toString(16).padStart(4,'0')}`);
                break;
            
            case 0x60: // RTS
                this.PC = (this.pop16() + 1) & 0xFFFF;
                break;
            case 0x6B: // RTL
                console.log(`[RTL] at ${this.PB.toString(16)}:${this.PC.toString(16).padStart(4,'0')}, SP=$${this.S.toString(16).padStart(4,'0')}`);
                this.PC = (this.pop16Wide() + 1) & 0xFFFF;
                this.PB = this.pop8Wide();
                this.normaliseStack();
                console.log(`[RTL] popped: PB=$${this.PB.toString(16).padStart(2,'0')} PC=$${this.PC.toString(16).padStart(4,'0')}, SP=$${this.S.toString(16).padStart(4,'0')}`);
                break;
            case 0x40: // RTI
                this.opPop('P');
                this.PC = this.pop16();
                if (!this.emulationMode) this.PB = this.pop8();
                break;

            // --- Misc ---
            case 0xEA: break; // NOP
            case 0x42: this.fetch8(); break; // WDM (consumes 1 byte)
            case 0xDB: this.stopped = true; break; // STP
            case 0xCB: this.waiting = true; break; // WAI
            case 0x00: // BRK
                this.PC = (this.PC + 1) & 0xFFFF; // BRK is a 2-byte instruction
                if (!this.emulationMode) this.push8(this.PB);
                this.push16(this.PC);
                this.opPush('P');
                this.setFlag(Status816.I, true);
                this.setFlag(Status816.D, false);
                // Hardware vector
                this.PC = this.read8or16(this.emulationMode ? 0xFFFE : 0xFFE6, false);
                this.PB = 0;
                break;
            case 0x02: // COP
                this.PC = (this.PC + 1) & 0xFFFF;
                if (!this.emulationMode) this.push8(this.PB);
                this.push16(this.PC);
                this.opPush('P');
                this.setFlag(Status816.I, true);
                this.setFlag(Status816.D, false);
                this.PC = this.read8or16(this.emulationMode ? 0xFFF4 : 0xFFE4, false);
                this.PB = 0;
                break;
            case 0x54: // MVN
            case 0x44: // MVP
                const destBank = this.fetch8();
                this.fetch8(); // srcBank
                this.DB = destBank;
                // Complex memory move skipped for brevity, placeholder only
                break;
            
            case 0xFB: // XCE (Exchange Carry and Emulation bit)
                this.opXCE();
                break;
            case 0xC2: // REP (Reset Processor Status Bits)
                this.opREP();
                break;
            case 0xE2: // SEP (Set Processor Status Bits)
                this.opSEP();
                break;
            // --- Missing Core Opcodes (LDA, STA, ADC, SBC, etc) ---
            // LDA
            case 0xA9: this.opLDA(this.addrImmediate(this.getFlag(Status816.M))); break;
            case 0xA5: this.opLDA(this.addrDirect()); break;
            case 0xB5: this.opLDA(this.addrDirectX()); break;
            case 0xAD: this.opLDA(this.addrAbsolute()); break;
            case 0xBD: this.opLDA(this.addrAbsoluteX()); break;
            case 0xB9: this.opLDA(this.addrAbsoluteY()); break;
            case 0xA1: this.opLDA(this.addrDirectIndexedIndirect()); break;
            case 0xB1: this.opLDA(this.addrDirectIndirectIndexed()); break;
            case 0x92: this.opLDA(this.addrDirectIndirect()); break;
            case 0x8F: this.opLDA(this.addrAbsoluteLong()); break;
            case 0xAF: this.opLDA(this.addrAbsoluteLongX()); break;
            case 0xA3: this.opLDA(this.addrStackRelative()); break;
            case 0xB3: this.opLDA(this.addrStackRelativeIndirectIndexed()); break;
            case 0xA7: this.opLDA(this.addrDirectIndirectLong()); break;
            case 0xB7: this.opLDA(this.addrDirectIndirectLongIndexed()); break;

            // STA
            case 0x85: this.opSTA(this.addrDirect()); break;
            case 0x95: this.opSTA(this.addrDirectX()); break;
            case 0x8D: this.opSTA(this.addrAbsolute()); break;
            case 0x9D: this.opSTA(this.addrAbsoluteX()); break;
            case 0x99: this.opSTA(this.addrAbsoluteY()); break;
            case 0x81: this.opSTA(this.addrDirectIndexedIndirect()); break;
            case 0x91: this.opSTA(this.addrDirectIndirectIndexed()); break;
            case 0x92: this.opSTA(this.addrDirectIndirect()); break;
            case 0x8F: this.opSTA(this.addrAbsoluteLong()); break;
            case 0x9F: this.opSTA(this.addrAbsoluteLongX()); break;
            case 0x83: this.opSTA(this.addrStackRelative()); break;
            case 0x93: this.opSTA(this.addrStackRelativeIndirectIndexed()); break;
            case 0x87: this.opSTA(this.addrDirectIndirectLong()); break;
            case 0x97: this.opSTA(this.addrDirectIndirectLongIndexed()); break;

            // ADC
            case 0x69: this.opADC(this.addrImmediate(this.getFlag(Status816.M))); break;
            case 0x65: this.opADC(this.addrDirect()); break;
            case 0x75: this.opADC(this.addrDirectX()); break;
            case 0x6D: this.opADC(this.addrAbsolute()); break;
            case 0x7D: this.opADC(this.addrAbsoluteX()); break;
            case 0x79: this.opADC(this.addrAbsoluteY()); break;
            case 0x61: this.opADC(this.addrDirectIndexedIndirect()); break;
            case 0x71: this.opADC(this.addrDirectIndirectIndexed()); break;
            case 0x72: this.opADC(this.addrDirectIndirect()); break;
            case 0x6F: this.opADC(this.addrAbsoluteLong()); break;
            case 0x7F: this.opADC(this.addrAbsoluteLongX()); break;
            case 0x63: this.opADC(this.addrStackRelative()); break;
            case 0x73: this.opADC(this.addrStackRelativeIndirectIndexed()); break;
            case 0x67: this.opADC(this.addrDirectIndirectLong()); break;
            case 0x77: this.opADC(this.addrDirectIndirectLongIndexed()); break;

            // SBC
            case 0xE9: this.opSBC(this.addrImmediate(this.getFlag(Status816.M))); break;
            case 0xE5: this.opSBC(this.addrDirect()); break;
            case 0xF5: this.opSBC(this.addrDirectX()); break;
            case 0xED: this.opSBC(this.addrAbsolute()); break;
            case 0xFD: this.opSBC(this.addrAbsoluteX()); break;
            case 0xF9: this.opSBC(this.addrAbsoluteY()); break;
            case 0xE1: this.opSBC(this.addrDirectIndexedIndirect()); break;
            case 0xF1: this.opSBC(this.addrDirectIndirectIndexed()); break;
            case 0xF2: this.opSBC(this.addrDirectIndirect()); break;
            case 0xEF: this.opSBC(this.addrAbsoluteLong()); break;
            case 0xFF: this.opSBC(this.addrAbsoluteLongX()); break;
            case 0xE3: this.opSBC(this.addrStackRelative()); break;
            case 0xF3: this.opSBC(this.addrStackRelativeIndirectIndexed()); break;
            case 0xE7: this.opSBC(this.addrDirectIndirectLong()); break;
            case 0xF7: this.opSBC(this.addrDirectIndirectLongIndexed()); break;

            // CMP
            case 0xC9: this.opCMP(this.addrImmediate(this.getFlag(Status816.M))); break;
            case 0xC5: this.opCMP(this.addrDirect()); break;
            case 0xD5: this.opCMP(this.addrDirectX()); break;
            case 0xCD: this.opCMP(this.addrAbsolute()); break;
            case 0xDD: this.opCMP(this.addrAbsoluteX()); break;
            case 0xD9: this.opCMP(this.addrAbsoluteY()); break;
            case 0xC1: this.opCMP(this.addrDirectIndexedIndirect()); break;
            case 0xD1: this.opCMP(this.addrDirectIndirectIndexed()); break;
            case 0xD2: this.opCMP(this.addrDirectIndirect()); break;
            case 0xCF: this.opCMP(this.addrAbsoluteLong()); break;
            case 0xDF: this.opCMP(this.addrAbsoluteLongX()); break;
            case 0xC3: this.opCMP(this.addrStackRelative()); break;
            case 0xD3: this.opCMP(this.addrStackRelativeIndirectIndexed()); break;
            case 0xC7: this.opCMP(this.addrDirectIndirectLong()); break;
            case 0xD7: this.opCMP(this.addrDirectIndirectLongIndexed()); break;

            // AND
            case 0x29: this.opAND(this.addrImmediate(this.getFlag(Status816.M))); break;
            case 0x25: this.opAND(this.addrDirect()); break;
            case 0x35: this.opAND(this.addrDirectX()); break;
            case 0x2D: this.opAND(this.addrAbsolute()); break;
            case 0x3D: this.opAND(this.addrAbsoluteX()); break;
            case 0x39: this.opAND(this.addrAbsoluteY()); break;
            case 0x21: this.opAND(this.addrDirectIndexedIndirect()); break;
            case 0x31: this.opAND(this.addrDirectIndirectIndexed()); break;
            case 0x32: this.opAND(this.addrDirectIndirect()); break;
            case 0x2F: this.opAND(this.addrAbsoluteLong()); break;
            case 0x3F: this.opAND(this.addrAbsoluteLongX()); break;
            case 0x23: this.opAND(this.addrStackRelative()); break;
            case 0x33: this.opAND(this.addrStackRelativeIndirectIndexed()); break;
            case 0x27: this.opAND(this.addrDirectIndirectLong()); break;
            case 0x37: this.opAND(this.addrDirectIndirectLongIndexed()); break;

            // ORA
            case 0x09: this.opORA(this.addrImmediate(this.getFlag(Status816.M))); break;
            case 0x05: this.opORA(this.addrDirect()); break;
            case 0x15: this.opORA(this.addrDirectX()); break;
            case 0x0D: this.opORA(this.addrAbsolute()); break;
            case 0x1D: this.opORA(this.addrAbsoluteX()); break;
            case 0x19: this.opORA(this.addrAbsoluteY()); break;
            case 0x01: this.opORA(this.addrDirectIndexedIndirect()); break;
            case 0x11: this.opORA(this.addrDirectIndirectIndexed()); break;
            case 0x12: this.opORA(this.addrDirectIndirect()); break;
            case 0x0F: this.opORA(this.addrAbsoluteLong()); break;
            case 0x1F: this.opORA(this.addrAbsoluteLongX()); break;
            case 0x03: this.opORA(this.addrStackRelative()); break;
            case 0x13: this.opORA(this.addrStackRelativeIndirectIndexed()); break;
            case 0x07: this.opORA(this.addrDirectIndirectLong()); break;
            case 0x17: this.opORA(this.addrDirectIndirectLongIndexed()); break;

            // EOR
            case 0x49: this.opEOR(this.addrImmediate(this.getFlag(Status816.M))); break;
            case 0x45: this.opEOR(this.addrDirect()); break;
            case 0x55: this.opEOR(this.addrDirectX()); break;
            case 0x4D: this.opEOR(this.addrAbsolute()); break;
            case 0x5D: this.opEOR(this.addrAbsoluteX()); break;
            case 0x59: this.opEOR(this.addrAbsoluteY()); break;
            case 0x41: this.opEOR(this.addrDirectIndexedIndirect()); break;
            case 0x51: this.opEOR(this.addrDirectIndirectIndexed()); break;
            case 0x52: this.opEOR(this.addrDirectIndirect()); break;
            case 0x4F: this.opEOR(this.addrAbsoluteLong()); break;
            case 0x5F: this.opEOR(this.addrAbsoluteLongX()); break;
            case 0x43: this.opEOR(this.addrStackRelative()); break;
            case 0x53: this.opEOR(this.addrStackRelativeIndirectIndexed()); break;
            case 0x47: this.opEOR(this.addrDirectIndirectLong()); break;
            case 0x57: this.opEOR(this.addrDirectIndirectLongIndexed()); break;

            // LDX
            case 0xA2: this.opLDX(this.addrImmediate(this.getFlag(Status816.X))); break;
            case 0xA6: this.opLDX(this.addrDirect()); break;
            case 0xB6: this.opLDX(this.addrDirectY()); break;
            case 0xAE: this.opLDX(this.addrAbsolute()); break;
            case 0xBE: this.opLDX(this.addrAbsoluteY()); break;

            // LDY
            case 0xA0: this.opLDY(this.addrImmediate(this.getFlag(Status816.X))); break;
            case 0xA4: this.opLDY(this.addrDirect()); break;
            case 0xB4: this.opLDY(this.addrDirectX()); break;
            case 0xAC: this.opLDY(this.addrAbsolute()); break;
            case 0xBC: this.opLDY(this.addrAbsoluteX()); break;

            // STX
            case 0x86: this.opSTX(this.addrDirect()); break;
            case 0x96: this.opSTX(this.addrDirectY()); break;
            case 0x8E: this.opSTX(this.addrAbsolute()); break;

            // STY
            case 0x84: this.opSTY(this.addrDirect()); break;
            case 0x94: this.opSTY(this.addrDirectX()); break;
            case 0x8C: this.opSTY(this.addrAbsolute()); break;

            // CPX
            case 0xE0: this.opCPX(this.addrImmediate(this.getFlag(Status816.X))); break;
            case 0xE4: this.opCPX(this.addrDirect()); break;
            case 0xEC: this.opCPX(this.addrAbsolute()); break;

            // CPY
            case 0xC0: this.opCPY(this.addrImmediate(this.getFlag(Status816.X))); break;
            case 0xC4: this.opCPY(this.addrDirect()); break;
            case 0xCC: this.opCPY(this.addrAbsolute()); break;

            // STZ
            case 0x64: this.opSTZ(this.addrDirect()); break;
            case 0x74: this.opSTZ(this.addrDirectX()); break;
            case 0x9C: this.opSTZ(this.addrAbsolute()); break;
            case 0x9E: this.opSTZ(this.addrAbsoluteX()); break;
            
            // Long addressing modes
            case 0x0F: this.opORA(this.addrAbsoluteLong()); break;
            case 0x1F: this.opORA(this.addrAbsoluteLongX()); break;
            case 0x2F: this.opAND(this.addrAbsoluteLong()); break;
            case 0x3F: this.opAND(this.addrAbsoluteLongX()); break;
            case 0x4F: this.opEOR(this.addrAbsoluteLong()); break;
            case 0x5F: this.opEOR(this.addrAbsoluteLongX()); break;
            case 0x6F: this.opADC(this.addrAbsoluteLong()); break;
            case 0x7F: this.opADC(this.addrAbsoluteLongX()); break;
            case 0x8F: this.opSTA(this.addrAbsoluteLong()); break;
            case 0x9F: this.opSTA(this.addrAbsoluteLongX()); break;
            case 0xAF: this.opLDA(this.addrAbsoluteLong()); break;
            case 0xBF: this.opLDA(this.addrAbsoluteLongX()); break;
            case 0xCF: this.opCMP(this.addrAbsoluteLong()); break;
            case 0xDF: this.opCMP(this.addrAbsoluteLongX()); break;
            case 0xEF: this.opSBC(this.addrAbsoluteLong()); break;
            case 0xFF: 
                if (opcode === 0xFF) {
                    this.opSBC(this.addrAbsoluteLongX()); 
                }
                break;
            
            // TODO: other opcodes...
            default:
                // Unimplemented opcode
                const self = this as any;
                if (!self.unimplementedReported) self.unimplementedReported = new Set();
                if (!self.unimplementedReported.has(opcode)) {
                    console.error("CPU65816 Unimplemented opcode: " + opcode.toString(16).padStart(2, '0') + " at PC=" + this.PC.toString(16));
                    self.unimplementedReported.add(opcode);
                }
                break;
        }
    }

    private read8or16(address: number, eightBit: boolean): number {
        if (eightBit) return this.read8(address);
        const lo = this.read8(address);
        const hi = this.read8((address + 1) & 0xFFFFFF); // Wrap depends on addressing mode, simplified here
        return lo | (hi << 8);
    }

    private write8or16(address: number, value: number, eightBit: boolean) {
        this.write8(address, value & 0xFF);
        if (!eightBit) {
            this.write8((address + 1) & 0xFFFFFF, (value >> 8) & 0xFF);
        }
    }

    private opLDA(address: number) {
        const eightBit = this.getFlag(Status816.M);
        const value = this.read8or16(address, eightBit);
        if (eightBit) {
            this.A = (this.A & 0xFF00) | (value & 0xFF);
            this.setFlag(Status816.Z, (value & 0xFF) === 0);
            this.setFlag(Status816.N, (value & 0x80) !== 0);
        } else {
            this.A = value & 0xFFFF;
            this.setFlag(Status816.Z, this.A === 0);
            this.setFlag(Status816.N, (this.A & 0x8000) !== 0);
        }
    }

    private opSTA(address: number) {
        const eightBit = this.getFlag(Status816.M);
        this.write8or16(address, this.A, eightBit);
    }

    private opORA(address: number) {
        const eightBit = this.getFlag(Status816.M);
        const value = this.read8or16(address, eightBit);
        if (eightBit) {
            this.A = (this.A & 0xFF00) | ((this.A | value) & 0xFF);
            this.setFlag(Status816.Z, (this.A & 0xFF) === 0);
            this.setFlag(Status816.N, (this.A & 0x80) !== 0);
        } else {
            this.A = (this.A | value) & 0xFFFF;
            this.setFlag(Status816.Z, this.A === 0);
            this.setFlag(Status816.N, (this.A & 0x8000) !== 0);
        }
    }

    private opAND(address: number) {
        const eightBit = this.getFlag(Status816.M);
        const value = this.read8or16(address, eightBit);
        if (eightBit) {
            this.A = (this.A & 0xFF00) | ((this.A & value) & 0xFF);
            this.setFlag(Status816.Z, (this.A & 0xFF) === 0);
            this.setFlag(Status816.N, (this.A & 0x80) !== 0);
        } else {
            this.A = (this.A & value) & 0xFFFF;
            this.setFlag(Status816.Z, this.A === 0);
            this.setFlag(Status816.N, (this.A & 0x8000) !== 0);
        }
    }

    private opEOR(address: number) {
        const eightBit = this.getFlag(Status816.M);
        const value = this.read8or16(address, eightBit);
        if (eightBit) {
            this.A = (this.A & 0xFF00) | ((this.A ^ value) & 0xFF);
            this.setFlag(Status816.Z, (this.A & 0xFF) === 0);
            this.setFlag(Status816.N, (this.A & 0x80) !== 0);
        } else {
            this.A = (this.A ^ value) & 0xFFFF;
            this.setFlag(Status816.Z, this.A === 0);
            this.setFlag(Status816.N, (this.A & 0x8000) !== 0);
        }
    }

    private opCMP(address: number) {
        const eightBit = this.getFlag(Status816.M);
        const value = this.read8or16(address, eightBit);
        if (eightBit) {
            const a8 = this.A & 0xFF;
            const res = a8 - value;
            this.setFlag(Status816.C, a8 >= value);
            this.setFlag(Status816.Z, (res & 0xFF) === 0);
            this.setFlag(Status816.N, (res & 0x80) !== 0);
        } else {
            const res = this.A - value;
            this.setFlag(Status816.C, this.A >= value);
            this.setFlag(Status816.Z, (res & 0xFFFF) === 0);
            this.setFlag(Status816.N, (res & 0x8000) !== 0);
        }
    }

    private opLDX(address: number) {
        const eightBit = this.getFlag(Status816.X);
        const value = this.read8or16(address, eightBit);
        if (eightBit) {
            this.X = value & 0xFF; // X/Y high byte is zeroed when 8-bit (unlike A)
            this.setFlag(Status816.Z, this.X === 0);
            this.setFlag(Status816.N, (this.X & 0x80) !== 0);
        } else {
            this.X = value & 0xFFFF;
            this.setFlag(Status816.Z, this.X === 0);
            this.setFlag(Status816.N, (this.X & 0x8000) !== 0);
        }
    }

    private opLDY(address: number) {
        const eightBit = this.getFlag(Status816.X);
        const value = this.read8or16(address, eightBit);
        if (eightBit) {
            this.Y = value & 0xFF;
            this.setFlag(Status816.Z, this.Y === 0);
            this.setFlag(Status816.N, (this.Y & 0x80) !== 0);
        } else {
            this.Y = value & 0xFFFF;
            this.setFlag(Status816.Z, this.Y === 0);
            this.setFlag(Status816.N, (this.Y & 0x8000) !== 0);
        }
    }

    private opSTX(address: number) {
        const eightBit = this.getFlag(Status816.X);
        this.write8or16(address, this.X, eightBit);
    }

    private opSTY(address: number) {
        const eightBit = this.getFlag(Status816.X);
        this.write8or16(address, this.Y, eightBit);
    }

    private opCPX(address: number) {
        const eightBit = this.getFlag(Status816.X);
        const value = this.read8or16(address, eightBit);
        if (eightBit) {
            const x8 = this.X & 0xFF;
            const res = x8 - value;
            this.setFlag(Status816.C, x8 >= value);
            this.setFlag(Status816.Z, (res & 0xFF) === 0);
            this.setFlag(Status816.N, (res & 0x80) !== 0);
        } else {
            const res = this.X - value;
            this.setFlag(Status816.C, this.X >= value);
            this.setFlag(Status816.Z, (res & 0xFFFF) === 0);
            this.setFlag(Status816.N, (res & 0x8000) !== 0);
        }
    }

    private opCPY(address: number) {
        const eightBit = this.getFlag(Status816.X);
        const value = this.read8or16(address, eightBit);
        if (eightBit) {
            const y8 = this.Y & 0xFF;
            const res = y8 - value;
            this.setFlag(Status816.C, y8 >= value);
            this.setFlag(Status816.Z, (res & 0xFF) === 0);
            this.setFlag(Status816.N, (res & 0x80) !== 0);
        } else {
            const res = this.Y - value;
            this.setFlag(Status816.C, this.Y >= value);
            this.setFlag(Status816.Z, (res & 0xFFFF) === 0);
            this.setFlag(Status816.N, (res & 0x8000) !== 0);
        }
    }

    private opSTZ(address: number) {
        const eightBit = this.getFlag(Status816.M);
        this.write8or16(address, 0, eightBit);
    }

    // --- Branch Instructions ---
    private doBranch(condition: boolean, offset16: boolean = false) {
        let offset = 0;
        if (offset16) {
            offset = this.fetch16();
            if (condition) {
                // 16-bit signed offset
                if (offset & 0x8000) offset -= 0x10000;
                this.PC = (this.PC + offset) & 0xFFFF;
            }
        } else {
            offset = this.fetch8();
            if (condition) {
                // 8-bit signed offset
                if (offset & 0x80) offset -= 0x100;
                this.PC = (this.PC + offset) & 0xFFFF;
            }
        }
    }

    private opINC(address: number) {
        const eightBit = this.getFlag(Status816.M);
        let value = this.read8or16(address, eightBit);
        value++;
        if (eightBit) {
            value &= 0xFF;
            this.setFlag(Status816.Z, value === 0);
            this.setFlag(Status816.N, (value & 0x80) !== 0);
        } else {
            value &= 0xFFFF;
            this.setFlag(Status816.Z, value === 0);
            this.setFlag(Status816.N, (value & 0x8000) !== 0);
        }
        this.write8or16(address, value, eightBit);
    }

    private opDEC(address: number) {
        const eightBit = this.getFlag(Status816.M);
        let value = this.read8or16(address, eightBit);
        value--;
        if (eightBit) {
            value &= 0xFF;
            this.setFlag(Status816.Z, value === 0);
            this.setFlag(Status816.N, (value & 0x80) !== 0);
        } else {
            value &= 0xFFFF;
            this.setFlag(Status816.Z, value === 0);
            this.setFlag(Status816.N, (value & 0x8000) !== 0);
        }
        this.write8or16(address, value, eightBit);
    }

    private opINX() {
        const eightBit = this.getFlag(Status816.X);
        this.X++;
        if (eightBit) {
            this.X &= 0xFF;
            this.setFlag(Status816.Z, this.X === 0);
            this.setFlag(Status816.N, (this.X & 0x80) !== 0);
        } else {
            this.X &= 0xFFFF;
            this.setFlag(Status816.Z, this.X === 0);
            this.setFlag(Status816.N, (this.X & 0x8000) !== 0);
        }
    }

    private opDEX() {
        const eightBit = this.getFlag(Status816.X);
        this.X--;
        if (eightBit) {
            this.X &= 0xFF;
            this.setFlag(Status816.Z, this.X === 0);
            this.setFlag(Status816.N, (this.X & 0x80) !== 0);
        } else {
            this.X &= 0xFFFF;
            this.setFlag(Status816.Z, this.X === 0);
            this.setFlag(Status816.N, (this.X & 0x8000) !== 0);
        }
    }

    private opINY() {
        const eightBit = this.getFlag(Status816.X);
        this.Y++;
        if (eightBit) {
            this.Y &= 0xFF;
            this.setFlag(Status816.Z, this.Y === 0);
            this.setFlag(Status816.N, (this.Y & 0x80) !== 0);
        } else {
            this.Y &= 0xFFFF;
            this.setFlag(Status816.Z, this.Y === 0);
            this.setFlag(Status816.N, (this.Y & 0x8000) !== 0);
        }
    }

    private opDEY() {
        const eightBit = this.getFlag(Status816.X);
        this.Y--;
        if (eightBit) {
            this.Y &= 0xFF;
            this.setFlag(Status816.Z, this.Y === 0);
            this.setFlag(Status816.N, (this.Y & 0x80) !== 0);
        } else {
            this.Y &= 0xFFFF;
            this.setFlag(Status816.Z, this.Y === 0);
            this.setFlag(Status816.N, (this.Y & 0x8000) !== 0);
        }
    }

    private opADC(address: number) {
        const eightBit = this.getFlag(Status816.M);
        const operand = this.read8or16(address, eightBit);
        
        if (this.getFlag(Status816.D)) {
            // TODO: Decimal mode implementation
            return;
        }

        const carryIn = this.getFlag(Status816.C) ? 1 : 0;
        const result = this.A + operand + carryIn;

        if (eightBit) {
            const result8 = result & 0xFF;
            this.setFlag(Status816.C, result > 0xFF);
            this.setFlag(Status816.Z, result8 === 0);
            this.setFlag(Status816.N, (result8 & 0x80) !== 0);
            this.setFlag(Status816.V, ((this.A ^ result8) & (operand ^ result8) & 0x80) !== 0);
            this.A = (this.A & 0xFF00) | result8; // Keep high byte intact
        } else {
            const result16 = result & 0xFFFF;
            this.setFlag(Status816.C, result > 0xFFFF);
            this.setFlag(Status816.Z, result16 === 0);
            this.setFlag(Status816.N, (result16 & 0x8000) !== 0);
            this.setFlag(Status816.V, ((this.A ^ result16) & (operand ^ result16) & 0x8000) !== 0);
            this.A = result16;
        }
    }

    private opSBC(address: number) {
        const eightBit = this.getFlag(Status816.M);
        const operand = this.read8or16(address, eightBit);
        
        if (this.getFlag(Status816.D)) {
            // TODO: Decimal mode implementation
            return;
        }

        const carryIn = this.getFlag(Status816.C) ? 1 : 0;
        // SBC is basically ADC with inverted operand
        const invertedOperand = eightBit ? (operand ^ 0xFF) : (operand ^ 0xFFFF);
        const result = this.A + invertedOperand + carryIn;

        if (eightBit) {
            const result8 = result & 0xFF;
            this.setFlag(Status816.C, result >= 0x100);
            this.setFlag(Status816.Z, result8 === 0);
            this.setFlag(Status816.N, (result8 & 0x80) !== 0);
            this.setFlag(Status816.V, ((this.A ^ result8) & (invertedOperand ^ result8) & 0x80) !== 0);
            this.A = (this.A & 0xFF00) | result8; // Keep high byte intact
        } else {
            const result16 = result & 0xFFFF;
            this.setFlag(Status816.C, result >= 0x10000);
            this.setFlag(Status816.Z, result16 === 0);
            this.setFlag(Status816.N, (result16 & 0x8000) !== 0);
            this.setFlag(Status816.V, ((this.A ^ result16) & (invertedOperand ^ result16) & 0x8000) !== 0);
            this.A = result16;
        }
    }

    // --- 65816 Specific Instructions ---

    private opXCE() {
        const carry = this.getFlag(Status816.C);
        this.setFlag(Status816.C, this.emulationMode);
        this.setEmulation(carry);
    }

    private opREP() {
        const val = this.fetch8();
        this.setP(this.P & ~val);
    }

    private opSEP() {
        const val = this.fetch8();
        this.setP(this.P | val);
    }

    // --- State Management ---

    private setP(value: number) {
        this.P = value;
        this.applyWidthConstraints();
    }

    private setEmulation(e: boolean) {
        this.emulationMode = e;
        this.applyWidthConstraints();
    }

    private applyWidthConstraints() {
        if (this.emulationMode) {
            this.P |= Status816.M | Status816.X;
            this.X &= 0x00FF;
            this.Y &= 0x00FF;
            this.S = 0x0100 | (this.S & 0x00FF);
        } else {
            if (this.P & Status816.X) {
                this.X &= 0x00FF;
                this.Y &= 0x00FF;
            }
        }
    }

    // --- Bus & Memory ---

    private read8(address: number): number {
        return this.readMemory(address & 0xFFFFFF);
    }

    private write8(address: number, value: number) {
        this.writeMemory(address & 0xFFFFFF, value & 0xFF);
    }

    private fetch8(): number {
        const address = (this.PB << 16) | this.PC;
        const value = this.read8(address);
        this.PC = (this.PC + 1) & 0xFFFF;
        return value;
    }

    private fetch16(): number {
        const lo = this.fetch8();
        const hi = this.fetch8();
        return lo | (hi << 8);
    }

    // --- Addressing Modes ---

    protected addrImmediate(eightBit: boolean): number {
        const addr = (this.PB << 16) | this.PC;
        this.PC = (this.PC + (eightBit ? 1 : 2)) & 0xFFFF;
        return addr;
    }

    protected addrAbsolute(): number {
        const addr = this.fetch16();
        return (this.DB << 16) | addr;
    }

    protected addrAbsoluteLong(): number {
        const lo = this.fetch16();
        const bank = this.fetch8();
        return (bank << 16) | lo;
    }

    protected addrDirect(): number {
        const offset = this.fetch8();
        const addr = (this.D + offset) & 0xFFFF;
        // Direct page is always in Bank 0
        return addr;
    }

    protected addrDirectX(): number {
        const offset = this.fetch8();
        // Emulation mode wraps around page zero if D=0, but native doesn't
        let addr = this.D + offset + this.X;
        if (this.emulationMode && this.D === 0) {
            addr = addr & 0x00FF;
        } else {
            addr = addr & 0xFFFF;
        }
        return addr;
    }

    protected addrDirectY(): number {
        const offset = this.fetch8();
        let addr = this.D + offset + this.Y;
        if (this.emulationMode && this.D === 0) {
            addr = addr & 0x00FF;
        } else {
            addr = addr & 0xFFFF;
        }
        return addr;
    }

    protected addrDirectIndirect(): number {
        const dpOffset = this.fetch8();
        const addrPtr = (this.D + dpOffset) & 0xFFFF;
        
        const lo = this.read8(addrPtr);
        const hi = this.read8((addrPtr + 1) & 0xFFFF);
        
        return (this.DB << 16) | (lo | (hi << 8));
    }

    protected addrDirectIndirectLong(): number {
        const dpOffset = this.fetch8();
        const addrPtr = (this.D + dpOffset) & 0xFFFF;
        
        const lo = this.read8(addrPtr);
        const hi = this.read8((addrPtr + 1) & 0xFFFF);
        const bank = this.read8((addrPtr + 2) & 0xFFFF);
        
        return (bank << 16) | (lo | (hi << 8));
    }

    protected addrAbsoluteX(): number {
        const lo = this.fetch16();
        // X index wraps around in PB bank
        const addr = (lo + this.X) & 0xFFFF;
        return (this.DB << 16) | addr;
    }

    protected addrAbsoluteY(): number {
        const lo = this.fetch16();
        // Y index wraps around in PB bank
        const addr = (lo + this.Y) & 0xFFFF;
        return (this.DB << 16) | addr;
    }

    protected addrAbsoluteLongX(): number {
        const lo = this.fetch16();
        const bank = this.fetch8();
        // Crosses bank boundaries
        return ((bank << 16) | lo) + this.X;
    }

    protected addrDirectIndexedIndirect(): number {
        // (dp,X)
        const dpOffset = this.fetch8();
        let ptr = this.D + dpOffset + this.X;
        if (this.emulationMode && this.D === 0) ptr &= 0x00FF;
        else ptr &= 0xFFFF;
        
        const lo = this.read8(ptr);
        const hi = this.read8((ptr + 1) & 0xFFFF);
        return (this.DB << 16) | (lo | (hi << 8));
    }

    protected addrDirectIndirectIndexed(): number {
        // (dp),Y
        const dpOffset = this.fetch8();
        const ptr = (this.D + dpOffset) & 0xFFFF;
        
        const lo = this.read8(ptr);
        const hi = this.read8((ptr + 1) & 0xFFFF);
        const baseAddr = lo | (hi << 8);
        
        return (this.DB << 16) | ((baseAddr + this.Y) & 0xFFFF);
    }

    protected addrDirectIndirectLongIndexed(): number {
        // [dp],Y
        const dpOffset = this.fetch8();
        const ptr = (this.D + dpOffset) & 0xFFFF;
        
        const lo = this.read8(ptr);
        const hi = this.read8((ptr + 1) & 0xFFFF);
        const bank = this.read8((ptr + 2) & 0xFFFF);
        
        const baseAddr = (bank << 16) | (lo | (hi << 8));
        return baseAddr + this.Y;
    }

    protected addrStackRelative(): number {
        // d,S
        const offset = this.fetch8();
        const addr = (this.S + offset) & 0xFFFF;
        return addr; // Always Bank 0
    }

    protected addrStackRelativeIndirectIndexed(): number {
        // (d,S),Y
        const offset = this.fetch8();
        const ptr = (this.S + offset) & 0xFFFF;
        
        const lo = this.read8(ptr);
        const hi = this.read8((ptr + 1) & 0xFFFF);
        const baseAddr = lo | (hi << 8);
        
        return (this.DB << 16) | ((baseAddr + this.Y) & 0xFFFF);
    }

    // --- Opcodes Implementations 100% ---

    private opTransfer(src: string, dest: string) {
        let val = 0;

        // Read source
        switch (src) {
            case 'A': val = this.A; break;
            case 'X': val = this.X; break;
            case 'Y': val = this.Y; break;
            case 'S': val = this.S; break;
            case 'D': val = this.D; break;
        }

        // Write dest
        switch (dest) {
            case 'A': 
                const destM = !this.getFlag(Status816.M);
                if (destM) this.A = val & 0xFFFF;
                else this.A = (this.A & 0xFF00) | (val & 0xFF);
                this.setFlag(Status816.Z, (destM ? this.A : this.A & 0xFF) === 0);
                this.setFlag(Status816.N, ((destM ? this.A : this.A & 0xFF) & (destM ? 0x8000 : 0x80)) !== 0);
                break;
            case 'X':
                const destX = !this.getFlag(Status816.X);
                this.X = destX ? val & 0xFFFF : val & 0xFF;
                this.setFlag(Status816.Z, this.X === 0);
                this.setFlag(Status816.N, (this.X & (destX ? 0x8000 : 0x80)) !== 0);
                break;
            case 'Y':
                const destY = !this.getFlag(Status816.X);
                this.Y = destY ? val & 0xFFFF : val & 0xFF;
                this.setFlag(Status816.Z, this.Y === 0);
                this.setFlag(Status816.N, (this.Y & (destY ? 0x8000 : 0x80)) !== 0);
                break;
            case 'S':
                this.S = this.emulationMode ? (0x0100 | (val & 0xFF)) : (val & 0xFFFF);
                break;
            case 'D':
                this.D = val & 0xFFFF;
                this.setFlag(Status816.Z, this.D === 0);
                this.setFlag(Status816.N, (this.D & 0x8000) !== 0);
                break;
        }
    }

    private opXBA() {
        const lo = this.A & 0xFF;
        const hi = (this.A >> 8) & 0xFF;
        this.A = (lo << 8) | hi;
        this.setFlag(Status816.Z, hi === 0);
        this.setFlag(Status816.N, (hi & 0x80) !== 0);
    }

    private opPush(reg: string, val: number = 0) {
        switch (reg) {
            case 'A': this.getFlag(Status816.M) ? this.push8(this.A & 0xFF) : this.push16(this.A); break;
            case 'X': this.getFlag(Status816.X) ? this.push8(this.X & 0xFF) : this.push16(this.X); break;
            case 'Y': this.getFlag(Status816.X) ? this.push8(this.Y & 0xFF) : this.push16(this.Y); break;
            case 'P': this.push8(this.P | (this.emulationMode ? 0x10 : 0x00)); break; // Break flag injected in E mode
            case 'B': this.push8Wide(this.DB); this.normaliseStack(); break;
            case 'D': this.push16Wide(this.D); this.normaliseStack(); break;
            case 'K': this.push8Wide(this.PB); this.normaliseStack(); break;
            case 'PEA': case 'PEI': case 'PER': this.push16Wide(val); this.normaliseStack(); break;
        }
    }

    private opPop(reg: string) {
        let val = 0;
        switch (reg) {
            case 'A':
                const m = this.getFlag(Status816.M);
                val = m ? this.pop8() : this.pop16();
                this.A = m ? (this.A & 0xFF00) | val : val;
                this.setFlag(Status816.Z, val === 0);
                this.setFlag(Status816.N, (val & (m ? 0x80 : 0x8000)) !== 0);
                break;
            case 'X':
                const x8 = this.getFlag(Status816.X);
                val = x8 ? this.pop8() : this.pop16();
                this.X = val;
                this.setFlag(Status816.Z, val === 0);
                this.setFlag(Status816.N, (val & (x8 ? 0x80 : 0x8000)) !== 0);
                break;
            case 'Y':
                const y8 = this.getFlag(Status816.X);
                val = y8 ? this.pop8() : this.pop16();
                this.Y = val;
                this.setFlag(Status816.Z, val === 0);
                this.setFlag(Status816.N, (val & (y8 ? 0x80 : 0x8000)) !== 0);
                break;
            case 'P':
                this.P = this.pop8();
                if (this.emulationMode) {
                    this.setFlag(Status816.M, true);
                    this.setFlag(Status816.X, true);
                }
                break;
            case 'B':
                this.DB = this.pop8Wide();
                this.normaliseStack();
                this.setFlag(Status816.Z, this.DB === 0);
                this.setFlag(Status816.N, (this.DB & 0x80) !== 0);
                break;
            case 'D':
                this.D = this.pop16Wide();
                this.normaliseStack();
                this.setFlag(Status816.Z, this.D === 0);
                this.setFlag(Status816.N, (this.D & 0x8000) !== 0);
                break;
        }
    }

    private opShift(type: string, address: number) {
        const isAcc = (address === -1);
        const eightBit = this.getFlag(Status816.M);
        let val = isAcc ? (eightBit ? this.A & 0xFF : this.A) : this.read8or16(address, eightBit);
        
        let carryOut = false;
        if (type === 'ASL') {
            carryOut = (val & (eightBit ? 0x80 : 0x8000)) !== 0;
            val = (val << 1) & (eightBit ? 0xFF : 0xFFFF);
        } else if (type === 'LSR') {
            carryOut = (val & 1) !== 0;
            val = (val >> 1) & (eightBit ? 0x7F : 0x7FFF);
        } else if (type === 'ROL') {
            const oldCarry = this.getFlag(Status816.C) ? 1 : 0;
            carryOut = (val & (eightBit ? 0x80 : 0x8000)) !== 0;
            val = ((val << 1) | oldCarry) & (eightBit ? 0xFF : 0xFFFF);
        } else if (type === 'ROR') {
            const oldCarry = this.getFlag(Status816.C) ? (eightBit ? 0x80 : 0x8000) : 0;
            carryOut = (val & 1) !== 0;
            val = ((val >> 1) | oldCarry) & (eightBit ? 0xFF : 0xFFFF);
        }

        this.setFlag(Status816.C, carryOut);
        this.setFlag(Status816.Z, val === 0);
        this.setFlag(Status816.N, (val & (eightBit ? 0x80 : 0x8000)) !== 0);

        if (isAcc) {
            if (eightBit) this.A = (this.A & 0xFF00) | val;
            else this.A = val;
        } else {
            this.write8or16(address, val, eightBit);
        }
    }

    private opBIT(address: number) {
        const eightBit = this.getFlag(Status816.M);
        const val = this.read8or16(address, eightBit);
        const mask = eightBit ? 0xFF : 0xFFFF;
        const res = (this.A & mask) & val;
        this.setFlag(Status816.Z, res === 0);
        this.setFlag(Status816.N, (val & (eightBit ? 0x80 : 0x8000)) !== 0);
        this.setFlag(Status816.V, (val & (eightBit ? 0x40 : 0x4000)) !== 0);
    }

    private opTRB(address: number) {
        const eightBit = this.getFlag(Status816.M);
        const val = this.read8or16(address, eightBit);
        const mask = eightBit ? 0xFF : 0xFFFF;
        this.setFlag(Status816.Z, ((this.A & mask) & val) === 0);
        const newVal = val & ~(this.A & mask);
        this.write8or16(address, newVal, eightBit);
    }

    private opTSB(address: number) {
        const eightBit = this.getFlag(Status816.M);
        const val = this.read8or16(address, eightBit);
        const mask = eightBit ? 0xFF : 0xFFFF;
        this.setFlag(Status816.Z, ((this.A & mask) & val) === 0);
        const newVal = val | (this.A & mask);
        this.write8or16(address, newVal, eightBit);
    }

    protected addrAbsoluteIndirect(): number {
        const ptr = this.fetch16();
        const lo = this.read8((this.PB << 16) | ptr);
        const hi = this.read8((this.PB << 16) | ((ptr + 1) & 0xFFFF));
        return lo | (hi << 8);
    }

    protected addrAbsoluteIndexedIndirect(): number {
        const ptr = (this.fetch16() + this.X) & 0xFFFF;
        const lo = this.read8((this.PB << 16) | ptr);
        const hi = this.read8((this.PB << 16) | ((ptr + 1) & 0xFFFF));
        return lo | (hi << 8);
    }

    protected addrAbsoluteIndirectLong(): number {
        const ptr = this.fetch16();
        const lo = this.read8(ptr);
        const hi = this.read8((ptr + 1) & 0xFFFF);
        const bank = this.read8((ptr + 2) & 0xFFFF);
        return (bank << 16) | lo | (hi << 8);
    }

    // --- Stack ---

    private push8(value: number) {
        this.write8(this.S, value);
        if (this.emulationMode) {
            this.S = 0x0100 | ((this.S - 1) & 0x00FF);
        } else {
            this.S = (this.S - 1) & 0xFFFF;
        }
    }

    private pop8(): number {
        if (this.emulationMode) {
            this.S = 0x0100 | ((this.S + 1) & 0x00FF);
        } else {
            this.S = (this.S + 1) & 0xFFFF;
        }
        return this.read8(this.S);
    }

    protected push16(value: number) {
        this.push8((value >> 8) & 0xFF);
        this.push8(value & 0xFF);
    }

    protected pop16(): number {
        const lo = this.pop8();
        const hi = this.pop8();
        return lo | (hi << 8);
    }

    // Wide versions for 65816-specific instructions (JSL, RTL, PHD, PLD, etc.)
    // These don't enforce page-one wrapping during the operation
    private push8Wide(value: number) {
        this.write8(this.S, value);
        this.S = (this.S - 1) & 0xFFFF;
    }

    private pop8Wide(): number {
        this.S = (this.S + 1) & 0xFFFF;
        return this.read8(this.S);
    }

    private push16Wide(value: number) {
        this.push8Wide((value >> 8) & 0xFF);
        this.push8Wide(value & 0xFF);
    }

    private pop16Wide(): number {
        const lo = this.pop8Wide();
        const hi = this.pop8Wide();
        return lo | (hi << 8);
    }

    private normaliseStack() {
        if (this.emulationMode) {
            this.S = 0x0100 | (this.S & 0x00FF);
        }
    }

    // --- Helpers ---

    private setFlag(flag: Status816, value: boolean) {
        if (value) {
            this.P |= flag;
        } else {
            this.P &= ~flag;
        }
    }

    private getFlag(flag: Status816): boolean {
        return (this.P & flag) !== 0;
    }
}
