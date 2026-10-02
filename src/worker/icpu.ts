export interface ICPU {
    reset(): void;
    processInstruction(): void;
    // Add other generic methods needed by the motherboard
    // e.g. getting registers for debug, setting interrupts
}
