import { handleKeyMapping } from "../games/game_mappings"
import { getCurrentMachineName, memGetC000, memSetC000 } from "../memory"
import { requestSnapshot } from "../motherboard"
import { iigsADB } from "../iigs_adb"

const setKeyStrobe = (key: number) => {
  // Sather, Understanding the Apple IIe p2-16, all addresses from $C000-$C01F
  // contain the ASCII key code in the low 7 bits, and the high bit is set
  // to 1 to indicate a keypress.
  // $C000-$C00F will maintain that high bit.
  // $C010-$C01F will override that high bit with their own status flag
  // whenever they are read but there's no harm in setting it now.
  memSetC000(0xC000, key | 0b10000000, 16)
  memSetC000(0xC010, (key & 0b11111111) | 128, 16)
}

let keyboardRepeatKey = 0
let keyboardIsDown = false
let nextKeyboardRepeatTime = 0
const Apple2eRepeatDelayMs = 600
const Apple2eRepeatRateMs = 75

type PendingKeySequence = {
  keys: number[],
  currentIndex: number,
  strobeCleared: boolean,
  timeout: ReturnType<typeof setTimeout>,
  onFinish?: (result: KeySequenceResult) => void,
  onConsumed?: () => void,
  resolve: (result: KeySequenceResult) => void,
}

let pendingKeySequence: PendingKeySequence | null = null

export const isKeyboardInputBusy = () => Boolean(
  pendingKeySequence
  || keyBuffer !== ""
  || keyboardIsDown
  || memGetC000(0xC000) >= 0x80,
)

const finishKeySequence = (
  outcome: KeySequenceResult["outcome"],
  keyMayHaveBeenObserved: boolean,
) => {
  const sequence = pendingKeySequence
  if (!sequence) return
  pendingKeySequence = null
  clearTimeout(sequence.timeout)
  keyboardRepeatKey = 0
  clearKeyStrobe()
  apple2KeyRelease()
  const result = {
    outcome,
    keysDelivered: sequence.currentIndex,
    keyMayHaveBeenObserved,
  }
  sequence.onFinish?.(result)
  sequence.resolve(result)
}

export const interruptKeySequence = () => {
  finishKeySequence("interrupted", true)
}

export const sendKeySequence = async (
  {keys, timeoutMs}: KeySequenceRequest,
  onFinish?: (result: KeySequenceResult) => void,
  onConsumed?: () => void,
) => {
  if (
    keys.length < 1
    || keys.length > 32
    || Array.from(keys).some((key) => {
      const code = key.charCodeAt(0)
      return key.length !== 1 || code < 1 || code > 0xFF
    })
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > 120000
  ) {
    throw new Error("Invalid key sequence")
  }
  if (isKeyboardInputBusy()) {
    const result = {
      outcome: "input_busy",
      keysDelivered: 0,
      keyMayHaveBeenObserved: false,
    } satisfies KeySequenceResult
    onFinish?.(result)
    return result
  }

  const mappedKeys = Array.from(keys, (key) =>
    handleKeyMapping(key).charCodeAt(0))
  keyboardRepeatKey = 0
  return new Promise<KeySequenceResult>((resolve) => {
    pendingKeySequence = {
      keys: mappedKeys,
      currentIndex: 0,
      strobeCleared: false,
      timeout: setTimeout(() => finishKeySequence("timeout", true), timeoutMs),
      onFinish,
      onConsumed,
      resolve,
    }
    setKeyStrobe(mappedKeys[0])
  })
}

export const advanceKeySequence = () => {
  const sequence = pendingKeySequence
  if (!sequence?.strobeCleared) return

  apple2KeyRelease()
  sequence.currentIndex += 1
  sequence.onConsumed?.()
  if (sequence.currentIndex === sequence.keys.length) {
    finishKeySequence("completed", false)
    return
  }
  sequence.strobeCleared = false
  setKeyStrobe(sequence.keys[sequence.currentIndex])
}

// Map DOM KeyboardEvent.code onto Apple IIgs ADB keycodes. Table transcribed
// from gssquared's ADB_Keyboard.hpp (the gold standard), standard subsets
// first: letters, digits, punctuation, navigation and modifiers. Modifier
// codes sit in the $36-$3A block; ADB marks modifier events in the event byte.
const DOM_TO_ADB: Record<string, number> = {
  KeyA: 0x00, KeyS: 0x01, KeyD: 0x02, KeyF: 0x03, KeyH: 0x04, KeyG: 0x05,
  KeyZ: 0x06, KeyX: 0x07, KeyC: 0x08, KeyV: 0x09, KeyB: 0x0B,
  KeyQ: 0x0C, KeyW: 0x0D, KeyE: 0x0E, KeyR: 0x0F, KeyY: 0x10, KeyT: 0x11,
  Digit1: 0x12, Digit2: 0x13, Digit3: 0x14, Digit4: 0x15, Digit6: 0x16,
  Digit5: 0x17, Equal: 0x18, Digit9: 0x19, Digit7: 0x1A, Minus: 0x1B,
  Digit8: 0x1C, Digit0: 0x1D, BracketRight: 0x1E, KeyO: 0x1F, KeyU: 0x20,
  BracketLeft: 0x21, KeyI: 0x22, KeyP: 0x23, Enter: 0x24, NumpadEnter: 0x24,
  KeyL: 0x25, KeyJ: 0x26, Quote: 0x27, KeyK: 0x28, Semicolon: 0x29,
  Backslash: 0x2A, Comma: 0x2B, Slash: 0x2C, KeyN: 0x2D, KeyM: 0x2E,
  Period: 0x2F, Tab: 0x30, Space: 0x31, Backquote: 0x32, Backspace: 0x33,
  Escape: 0x35, ControlLeft: 0x36, ControlRight: 0x36, MetaLeft: 0x37,
  MetaRight: 0x37, ShiftLeft: 0x38, ShiftRight: 0x38, CapsLock: 0x39,
  AltLeft: 0x3A, AltRight: 0x3A, ArrowLeft: 0x3B, ArrowRight: 0x3C,
  ArrowDown: 0x3D, ArrowUp: 0x3E,
}

let adbKeyDownCode = -1

export const setKeyboardState = (state: KeyboardState) => {
  interruptKeySequence()
  if (getCurrentMachineName() === "APPLE2GS" && state.domCode) {
    // The IIgs's physical keyboard is ADB device address 2. Programs that do
    // not poll the legacy $C000 softswitch (GS/OS applications, IIgs games -
    // e.g. Tass Times once it is in the game proper) only ever see keys
    // through ADB keyboard register 0, so hardware keys must be delivered
    // there as well. Event bytes follow the ADB convention: the keycode for a
    // key down, keycode | 0x80 for a key up (see iigs_adb.ts). Keyboard
    // auto-repeat is the guest OS's job, so host repeats are not re-queued.
    const code = DOM_TO_ADB[state.domCode]
    if (code !== undefined) {
      if (state.isDown) {
        if (!state.repeat) {
          iigsADB.queueKeyboard(code)
          adbKeyDownCode = code
        }
      } else if (adbKeyDownCode >= 0) {
        iigsADB.queueKeyboard(adbKeyDownCode | 0x80)
        adbKeyDownCode = -1
      } else {
        // Up for a key whose down was missed (focus loss): still deliver it,
        // so a stuck key does not survive a window switch.
        iigsADB.queueKeyboard(code | 0x80)
      }
    }
    if (state.saveSnapShot) {
      requestSnapshot()
    }
    return
  }
  if (!state.isDown || state.key < 0) {
    keyboardIsDown = false
    keyboardRepeatKey = 0
    apple2KeyRelease()
    return
  }
  keyboardIsDown = true
  keyboardRepeatKey = handleKeyMapping(String.fromCharCode(state.key)).charCodeAt(0)
  setKeyStrobe(keyboardRepeatKey)
  if (state.saveSnapShot) {
    requestSnapshot()
  }
  if (!state.repeat) {
    keyboardRepeatKey = 0
    return
  }
  nextKeyboardRepeatTime = performance.now() + Apple2eRepeatDelayMs
}

export const pollKeyboardRepeat = () => {
  if (!keyboardRepeatKey) return
  const now = performance.now()
  if (now < nextKeyboardRepeatTime) return
  setKeyStrobe(keyboardRepeatKey)
  nextKeyboardRepeatTime = now + Apple2eRepeatRateMs
}

export const clearKeyStrobe = () => {
  // Here, we only clear the high bit for $C00x, not $C01x (AKD, any-key-down).
  // We will clear AKD when the key is released (below).
  const previousValue = memGetC000(0xC000)
  const keyvalue = previousValue & 0b01111111
  memSetC000(0xC000, keyvalue, 16)
  if (pendingKeySequence && previousValue >= 0x80) {
    pendingKeySequence.strobeCleared = true
  }
}

export const apple2KeyRelease = () => {
  // Here, the key has been released and we clear the AKD flag.
  const keyvalue = memGetC000(0xC010) & 0b01111111
  memSetC000(0xC010, keyvalue, 16)
}

// Make sure that key presses get processed in a timely manner,
// even if $C010 (the keyboard strobe) isn't being called properly.
// This was a problem for certain games such as Firebug or Wolfenstein,
// which only clear the $C010 strobe if it is a valid game key.
// 3800 ms was heuristically chosen, as that's about how long it takes
// Applesoft BASIC to process a huge line of code.
// TODO: We could use two buffers - one for keypress (with a short delay)
// and another for pasted text, with a longer delay to give Applesoft BASIC
// time to process
let keyBuffer = ""
let tPrevPop = 1000000000

// CT 6/27/2026: Added a tiny delay of a couple calls to avoid dropping keys when
// Applesoft BASIC is processing them. This only seemed to be a problem when
// pasting programs in Chrome. Safari worked fine.
let nCalled = 0

export const popKey = () => {
  // See note above about this time cutoff before dropping buffer text.
  const t = performance.now()
  nCalled++
  if (keyBuffer !== "" && nCalled > 2 && (memGetC000(0xC000) < 128 || (t - tPrevPop) > 3800)) {
    nCalled = 0
    tPrevPop = t
    const key = keyBuffer.charCodeAt(0)
    setKeyStrobe(key)
    keyBuffer = keyBuffer.slice(1)
  }
}

let prevKey = ""

export const addToBuffer = (text: string) => {
  // Avoid repeating keys in the buffer if the Apple isn't processing them.
  if (text === prevKey && keyBuffer.length > 0) {
    return
  }
  prevKey = text
  keyBuffer += text
}

let tPrev = 0

export const addToBufferDebounce = (text: string, timeout = 300) => {
  // Avoid repeating keys in the buffer if the Apple isn't processing them.
  const t = performance.now()
  if ((t - tPrev) < timeout) {
    return
  }
  tPrev = t
  addToBuffer(text)
}

export const sendTextToEmulator = (key: number) => {
  interruptKeySequence()
  let text = String.fromCharCode(key)
  text = handleKeyMapping(text)
  addToBuffer(text)
  popKey()
}

// TODO: Does this need its own buffer, so we can guarantee that chars
// won't get dropped from the text if it takes too long to process?
export const sendPastedText = (text: string) => {
  interruptKeySequence()
  if (text.length === 1) {
    text = handleKeyMapping(text)
  }
  addToBuffer(text) // Bypass duplicate check for pasted text
}
