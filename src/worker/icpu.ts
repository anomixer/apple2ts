export interface ICPU {
    reset(): void;
    processInstruction(traceCallback?: ((str: string) => void) | null): number;
    // Add other generic methods needed by the motherboard
    // e.g. getting registers for debug, setting interrupts
}
