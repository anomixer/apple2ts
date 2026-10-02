/**
 * iigs_clock.ts - Simple Apple IIgs clock chip emulation
 * 
 * Based on web-a2e by Mike Daley
 * The clock chip has 256 bytes of battery RAM and keeps time since 1904.
 */

// Clock control register bits
const CONTROL_SELECT = 0x80;       // Chip select
const CONTROL_TRANSACTION = 0x20;  // Start transaction
const CONTROL_READ = 0x10;         // Read (vs write)

// Command types
const RAM_COMMAND_MASK = 0x78;
const RAM_COMMAND_MATCH = 0x38;
const CLOCK_MASK = 0x73;
const CLOCK_MATCH = 0x01;

enum Step {
    Command,
    Address,
    Data
}

enum Target {
    None,
    BatteryRam,
    Seconds
}

class IIgsClock {
    private batteryRam = new Uint8Array(256);
    private seconds = 0;
    private data = 0;
    private control = 0;
    private step = Step.Command;
    private target = Target.None;
    private address = 0;

    constructor() {
        // Initialize with current time (seconds since Jan 1, 1904)
        const SECONDS_1904_TO_1970 = 2082844800;
        this.seconds = Math.floor(Date.now() / 1000) + SECONDS_1904_TO_1970;
        
        // Initialize battery RAM with safe defaults
        this.batteryRam[0x36] = 0x80; // Default fast speed
    }

    readData(): number {
        return this.data;
    }

    writeData(value: number): void {
        this.data = value & 0xFF;
    }

    readControl(): number {
        // Control register always shows transaction complete (bit 5 clear)
        return this.control & ~CONTROL_TRANSACTION;
    }

    writeControl(value: number): void {
        this.control = value & 0xFF;

        // Dropping select line ends transaction
        if ((value & CONTROL_SELECT) === 0) {
            this.step = Step.Command;
            this.target = Target.None;
            return;
        }

        if ((value & CONTROL_TRANSACTION) === 0) return;

        const toChip = (value & CONTROL_READ) === 0;
        
        switch (this.step) {
            case Step.Command:
                if (toChip) this.takeCommand(this.data);
                break;
            case Step.Address:
                if (toChip) this.takeAddress(this.data);
                break;
            case Step.Data:
                this.transferData(toChip);
                break;
        }

        // Clear transaction bit (operation complete)
        this.control &= ~CONTROL_TRANSACTION;
    }

    private takeCommand(command: number): void {
        // Battery RAM access (3-step)
        if ((command & RAM_COMMAND_MASK) === RAM_COMMAND_MATCH) {
            this.address = (command & 0x07) << 5;
            this.target = Target.BatteryRam;
            this.step = Step.Address;
            return;
        }

        // Clock register access (seconds since 1904)
        if ((command & CLOCK_MASK) === CLOCK_MATCH) {
            this.address = (command >> 2) & 0x03;
            this.target = Target.Seconds;
            this.step = Step.Data;
            return;
        }

        // Unknown register - accept data but do nothing
        this.target = Target.None;
        this.step = Step.Data;
    }

    private takeAddress(command: number): void {
        this.address = this.address | ((command >> 2) & 0x1F);
        this.step = Step.Data;
    }

    private transferData(toChip: boolean): void {
        if (toChip) {
            // Write to chip
            switch (this.target) {
                case Target.BatteryRam:
                    this.batteryRam[this.address & 0xFF] = this.data;
                    break;
                case Target.Seconds:
                    const shift = (this.address & 0x03) * 8;
                    this.seconds &= ~(0xFF << shift);
                    this.seconds |= (this.data << shift);
                    break;
            }
        } else {
            // Read from chip
            switch (this.target) {
                case Target.BatteryRam:
                    this.data = this.batteryRam[this.address & 0xFF];
                    break;
                case Target.Seconds:
                    this.data = (this.seconds >> ((this.address & 0x03) * 8)) & 0xFF;
                    break;
                case Target.None:
                    this.data = 0x00;
                    break;
            }
        }
        
        this.step = Step.Command;
        this.target = Target.None;
    }
}

// Singleton instance
export const iigsClock = new IIgsClock();
