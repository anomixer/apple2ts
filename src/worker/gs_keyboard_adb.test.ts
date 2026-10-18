// Apple IIgs hardware keyboard delivery through the ADB.
//
// On the IIgs the keyboard is ADB device address 2; programs that do not poll
// the legacy $C000 softswitch (GS/OS apps, IIgs games past their title screens)
// only ever see keys through ADB keyboard register 0. Event bytes carry the
// ADB convention: keycode for a key down, keycode | 0x80 for a key up
// (gssquared ADB_Keyboard.hpp:477). Table lookup from DOM KeyboardEvent.code
// is transcribed from the same file.

import { doSetMachineName } from "./motherboard"
import { setKeyboardState } from "./devices/keyboard"
import { iigsADB } from "./iigs_adb"

beforeEach(() => {
  doSetMachineName("APPLE2GS")
  iigsADB.reset()
})

test("a hardware key reaches ADB keyboard register 0 as a down/up event", () => {
  setKeyboardState({ key: 97, isDown: true, repeat: false, domCode: "KeyA" })
  expect(iigsADB.getKeyboardEvent().slice(0, 1)[0]).toBe(0x00)
  expect(iigsADB.hasKeyData()).toBe(true)
  setKeyboardState({ key: 97, isDown: false, repeat: false, domCode: "KeyA" })
  expect(iigsADB.getKeyboardEvent()[0]).toBe(0x80)
})

test("navigation keys use the IIgs ADB codes", () => {
  setKeyboardState({ key: 13, isDown: true, repeat: false, domCode: "Enter" })
  expect(iigsADB.getKeyboardEvent()[0]).toBe(0x24)
  setKeyboardState({ key: 13, isDown: false, repeat: false, domCode: "Enter" })
  expect(iigsADB.getKeyboardEvent()[0]).toBe(0x80 | 0x24)
  setKeyboardState({ key: -1, isDown: true, repeat: false, domCode: "ArrowUp" })
  expect(iigsADB.getKeyboardEvent()[0]).toBe(0x3e)
})

test("host auto-repeat does not re-queue the same report", () => {
  setKeyboardState({ key: 97, isDown: true, repeat: true, domCode: "KeyA" })
  expect(iigsADB.hasKeyData()).toBe(false)
})

test("the Apple IIe path still uses the $C000 softswitch", () => {
  doSetMachineName("APPLE2EE")
  setKeyboardState({ key: 97, isDown: true, repeat: false, domCode: "KeyA" })
  expect(iigsADB.hasKeyData()).toBe(false)
  // The IIe branch is exercised by devices/keyboard.test.ts; here we only
  // assert that a IIe key did not leak into the ADB.
})

test("an unknown DOM code is not delivered and does not throw", () => {
  setKeyboardState({ key: 32, isDown: true, repeat: false, domCode: "F13" })
  expect(iigsADB.hasKeyData()).toBe(false)
})
