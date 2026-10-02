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

    public processInstruction() {
        if (this.stopped || this.waiting) return;

        // Fetch opcode
        const opcode = this.fetch8();
        this.executeOpcode(opcode);
    }

    private executeOpcode(opcode: number) {
        switch (opcode) {
            case 0x69: // ADC Immediate
                this.opADC(this.addrImmediate(this.getFlag(Status816.M)));
                break;
            case 0xE9: // SBC Immediate
                this.opSBC(this.addrImmediate(this.getFlag(Status816.M)));
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
            // TODO: other 253 opcodes...
            default:
                // Unimplemented opcode
                break;
        }
    }

    private read8or16(address: number, eightBit: boolean): number {
        if (eightBit) return this.read8(address);
        const lo = this.read8(address);
        const hi = this.read8((address + 1) & 0xFFFFFF); // Wrap depends on addressing mode, simplified here
        return lo | (hi << 8);
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

    private addrImmediate(eightBit: boolean): number {
        if (eightBit) {
            return this.fetch8();
        } else {
            return this.fetch16();
        }
    }

    private addrAbsolute(): number {
        const addr = this.fetch16();
        return (this.DB << 16) | addr;
    }

    private addrDirect(): number {
        const offset = this.fetch8();
        const addr = (this.D + offset) & 0xFFFF;
        // In Bank 0
        return addr;
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

    private push16(value: number) {
        this.push8((value >> 8) & 0xFF);
        this.push8(value & 0xFF);
    }

    private pop16(): number {
        const lo = this.pop8();
        const hi = this.pop8();
        return lo | (hi << 8);
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
