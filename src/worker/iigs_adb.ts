/**
 * iigs_adb.ts - Apple IIgs ADB (Apple Desktop Bus) controller emulation.
 *
 * Mirrors web-a2e's iigs_adb.cpp (Mike Daley). The ADB is a serial bus the
 * IIgs uses for its keyboard and mouse. Registers:
 *   $C024 ADB Mouse Data
 *   $C025 ADB Modifiers
 *   $C026 ADB Data (command/response queue)
 *   $C027 ADB Status (bits 5=response available, 2=keyboard data, 3/6=interrupt
 *       enables, 7=mouse data, 1=mouse Y next, 4=command full)
 */

// Status bit constants (web-a2e iigs_adb.hpp)
const STATUS_MOUSE_DATA = 0x80;       // bit7
const STATUS_MOUSE_INTERRUPT = 0x40;  // bit6 (interrupt enable for mouse)
const STATUS_DATA_AVAILABLE = 0x20;   // bit5 (response queue non-empty)
const STATUS_COMMAND_FULL = 0x10;     // bit4 (waiting for more args)
const STATUS_KEYBOARD_INTERRUPT = 0x08; // bit3 (interrupt enable for keyboard)
const STATUS_KEYBOARD_DATA = 0x04;    // bit2 (keyboard queue non-empty)
const STATUS_MOUSE_Y_NEXT = 0x02;     // bit1 (mouse Y byte next)
const STATUS_INTERRUPT_ENABLES = 0x48;  // mask of bits 6 and 3
const RESPONSE_HEADER = 0x80;

// Command constants
const CMD_ABORT = 0x01;
const CMD_RESET_KEYBOARD = 0x02;
const CMD_FLUSH_KEYBOARD = 0x03;
const CMD_SET_MODES = 0x04;
const CMD_CLEAR_MODES = 0x05;
const CMD_SET_CONFIG = 0x06;
const CMD_SYNC = 0x07;
const CMD_WRITE_MEMORY = 0x08;
const CMD_READ_MEMORY = 0x09;
const CMD_READ_MODES = 0x0a;
const CMD_READ_CONFIG = 0x0b;
const CMD_READ_ERROR = 0x0c;
const CMD_VERSION = 0x0d;
const CMD_READ_CHARSETS = 0x0e;
const CMD_READ_LAYOUTS = 0x0f;
const CMD_RESET = 0x10;
const CMD_MYSTERY_12 = 0x12;
const CMD_MYSTERY_13 = 0x13;
const CMD_DISABLE_SRQ_FIRST = 0x70;
const CMD_DISABLE_SRQ_LAST = 0x73;
const BUS_TALK_FIRST = 0xc0;
const BUS_TALK_LAST = 0xff;

const ADDRESS_KEYBOARD = 0x02;
const ADDRESS_MOUSE = 0x03;
const SRQ_ENABLE = 0x20;
const HANDLER_ID = 0x01;
const CONTROLLER_VERSION = 0x06;

// Argument counts for each command (web-a2e beginCommand)
const ARG_COUNTS: Record<number, number> = {
  [CMD_ABORT]: 0, [CMD_RESET_KEYBOARD]: 0, [CMD_FLUSH_KEYBOARD]: 0,
  [CMD_SET_MODES]: 1, [CMD_CLEAR_MODES]: 1,
  [CMD_SET_CONFIG]: 3, [CMD_SYNC]: 4,
  [CMD_WRITE_MEMORY]: 2, [CMD_READ_MEMORY]: 2,
  [CMD_READ_MODES]: 0, [CMD_READ_CONFIG]: 0, [CMD_READ_ERROR]: 0,
  [CMD_VERSION]: 0, [CMD_READ_CHARSETS]: 0, [CMD_READ_LAYOUTS]: 0,
  [CMD_RESET]: 0, [CMD_MYSTERY_12]: 2, [CMD_MYSTERY_13]: 2,
};

export class IIGSADB {
  private response: number[] = [];
  private keyboard: number[] = [];
  private pendingX = 0;
  private pendingY = 0;
  private buttonChanged = false;
  private reportInProgress = false;
  private reportY = 0;
  private controllerMemory = new Uint8Array(256);
  private arguments = new Uint8Array(8);
  private lastCommand = 0;
  private argumentsExpected = 0;
  private argumentsSeen = 0;
  private modifiers = 0;
  private latch = 0;
  private mouseButton = false;
  private modes = 0;
  private interruptEnables = 0;
  private configuration = new Uint8Array(3);

  // --- Status ---
  readStatus(): number {
    let status = 0;
    if (this.response.length > 0) status |= STATUS_DATA_AVAILABLE;
    if (this.keyboard.length > 0) status |= STATUS_KEYBOARD_DATA;
    if (this.hasMouseData()) status |= STATUS_MOUSE_DATA;
    if (this.reportInProgress) status |= STATUS_MOUSE_Y_NEXT;
    if (this.argumentsSeen < this.argumentsExpected) status |= STATUS_COMMAND_FULL;
    return status | this.interruptEnables;
  }

  writeStatus(v: number) {
    this.interruptEnables = v & STATUS_INTERRUPT_ENABLES;
  }

  readData(): number {
    if (this.response.length === 0) return 0x00;
    return this.response.shift() as number;
  }

  writeCommand(v: number) {
    if (this.argumentsSeen < this.argumentsExpected) {
      this.arguments[this.argumentsSeen++] = v;
      if (this.argumentsSeen === this.argumentsExpected) this.completeCommand();
    } else {
      this.beginCommand(v);
    }
  }

  private beginCommand(code: number) {
    // Bus talk (0xC0-0xFF) completes immediately
    if (code >= BUS_TALK_FIRST && code <= BUS_TALK_LAST) {
      this.answerTalk(code);
      return;
    }
    const expected = ARG_COUNTS[code] ?? 0;
    this.argumentsExpected = expected;
    this.argumentsSeen = 0;
    this.lastCommand = code;
    if (expected === 0) this.completeCommand();
  }

  private completeCommand() {
    switch (this.lastCommand) {
      case CMD_SYNC: this.modes = this.arguments[0]; for (let i = 0; i < 3; i++) this.configuration[i] = this.arguments[1 + i]; break;
      case CMD_SET_MODES: this.modes |= this.arguments[0]; break;
      case CMD_CLEAR_MODES: this.modes &= ~this.arguments[0]; break;
      case CMD_SET_CONFIG: for (let i = 0; i < 3; i++) this.configuration[i] = this.arguments[i]; break;
      case CMD_WRITE_MEMORY: this.controllerMemory[this.arguments[0]] = this.arguments[1]; break;
      case CMD_READ_MEMORY: this.response.push(this.controllerMemory[(this.arguments[0] | (this.arguments[1] << 8)) & 0xff]); break;
      case CMD_READ_MODES: this.response.push(this.modes); break;
      case CMD_READ_CONFIG: for (let i = 0; i < 3; i++) this.response.push(this.configuration[i]); break;
      case CMD_READ_ERROR: this.response.push(0x00); break;
      case CMD_VERSION: this.response.push(CONTROLLER_VERSION); break;
      case CMD_READ_CHARSETS: case CMD_READ_LAYOUTS: this.response.push(0x01, 0x00); break;
      case CMD_ABORT: case CMD_RESET: case CMD_RESET_KEYBOARD: case CMD_FLUSH_KEYBOARD:
        this.keyboard = [];
        this.response = [];
        this.pendingX = this.pendingY = 0;
        this.buttonChanged = false;
        this.reportInProgress = false;
        break;
      case CMD_MYSTERY_12: case CMD_MYSTERY_13: break; // consume args, no reply
      default:
        if (this.lastCommand >= CMD_DISABLE_SRQ_FIRST && this.lastCommand <= CMD_DISABLE_SRQ_LAST) break; // acknowledged, no-op
        break;
    }
    this.argumentsExpected = 0;
    this.argumentsSeen = 0;
  }

  private answerTalk(address: number, reg?: number) {
    if (reg === undefined) {
      // address = code & 0x0f, reg = (code >> 4) & 3
      const addr = address & 0x0f;
      const r = (address >> 4) & 3;
      const present = (addr === ADDRESS_KEYBOARD || addr === ADDRESS_MOUSE);
      if (!present || r !== 3) {
        this.response.push(RESPONSE_HEADER); // count 0
        return;
      }
      this.postBusResponse([SRQ_ENABLE | addr, HANDLER_ID]);
    }
  }

  private postBusResponse(bytes: number[]) {
    this.response.push(RESPONSE_HEADER | (bytes.length ? bytes.length - 1 : 0));
    for (const b of bytes) this.response.push(b);
  }

  // --- Mouse ---
  hasMouseData(): boolean {
    return this.reportInProgress || this.pendingX !== 0 || this.pendingY !== 0 || this.buttonChanged;
  }

  readMouseData(): number {
    if (this.reportInProgress) {
      this.reportInProgress = false;
      return this.reportY;
    }
    const clamp = (v: number) => Math.max(-63, Math.min(63, v));
    const x = clamp(this.pendingX) & 0x7f;
    // bit7 of X is always 1 (button 1 never pressed)
    this.pendingX -= clamp(this.pendingX);
    const y = this.reportY;
    this.reportY = y | (this.mouseButton ? 0 : 0x80);
    this.buttonChanged = false;
    this.reportInProgress = true;
    return x | 0x80;
  }

  queueMouse(dx: number, dy: number) {
    this.pendingX += dx;
    this.pendingY += dy;
  }

  setMouseButton(pressed: boolean) {
    if (pressed !== this.mouseButton) this.buttonChanged = true;
    this.mouseButton = pressed;
  }

  // --- Keyboard ---
  queueKeyboard(keycode: number) {
    this.keyboard.push(keycode);
    this.latch = keycode | 0x80; // $C000 Mega II latch
  }

  clearKeyboardStrobe() {
    this.latch &= 0x7f;
    if (this.keyboard.length > 0) this.keyboard.shift();
  }

  readModifiers() {
    const m = this.modifiers;
    this.modifiers &= ~0x20; // clear MOD_LATCH
    return m;
  }

  peekModifiers() {
    return this.modifiers;
  }

  interruptPending(): boolean {
    return ((this.interruptEnables & STATUS_MOUSE_INTERRUPT) !== 0 && this.hasMouseData())
      || ((this.interruptEnables & STATUS_KEYBOARD_INTERRUPT) !== 0 && this.keyboard.length > 0);
  }

  reset() {
    this.response = [];
    this.keyboard = [];
    this.pendingX = this.pendingY = 0;
    this.buttonChanged = false;
    this.reportInProgress = false;
    this.reportY = 0;
    this.controllerMemory = new Uint8Array(256);
    this.arguments = new Uint8Array(8);
    this.lastCommand = 0;
    this.argumentsExpected = 0;
    this.argumentsSeen = 0;
    this.modifiers = 0;
    this.latch = 0;
    this.mouseButton = false;
    this.modes = 0;
    this.interruptEnables = 0;
    this.configuration = new Uint8Array(3);
  }
}

export const iigsADB = new IIGSADB();
