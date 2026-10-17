import { iigsADB } from "./iigs_adb"

// A press must be visible to the guest in the very next report it reads - not
// deferred behind unread reports, and never lost.
//
// The report layout: bit 7 of both bytes is the button state (1 = released),
// bits 6-0 are a seven-bit two's complement displacement. The motion deltas and
// the button state travel in the SAME report: on real ADB hardware the
// micro-controller composes the snapshot from live state at poll time (KEGS's
// adb_read_c024), and gssquared patches the waiting register's button bits on
// every event (ADB_Mouse::update_button_down). Motion that is pending when a
// button changes is not dropped and a button transition does not wait behind
// motion left over from a long move. GS/OS's Event Manager classifies a click
// purely from the button bit transitions between reports, so this is what
// keeps a single click from collapsing into nothing (or into a double click).

const adb = iigsADB

// Read one full report the way the ROM's task does: the X byte from $C024,
// then the Y byte, with the button state as seen in the X byte.
function readReport() {
  const x = adb.readMouseData()
  const y = adb.readMouseData()
  const disp = (b: number) => {
    const v = b & 0x7f
    return v >= 0x40 ? v - 0x80 : v
  }
  return { x: disp(x), y: disp(y), buttonUp: (x & 0x80) !== 0, rawX: x, rawY: y }
}

beforeEach(() => {
  adb.reset()
})

test("a press while a motion report is unread is visible in that report", () => {
  adb.queueMouse(10, 5)
  expect(adb.hasMouseData()).toBe(true)

  // Press now: waiting report's button bits reflect the press, the motion is
  // still delivered in the same snapshot (drag-like, exactly what real
  // hardware reports when the button is pressed on a moving mouse).
  adb.setMouseButton(true)

  const r = readReport()
  expect(r.x).toBe(10)
  expect(r.y).toBe(5)
  expect(r.buttonUp).toBe(false)
})

test("a press with no pending motion produces a button-only report", () => {
  adb.setMouseButton(true)

  const r = readReport()
  expect(r.x).toBe(0)
  expect(r.y).toBe(0)
  expect(r.buttonUp).toBe(false)
  // fully consumed: no stale report or button change keeps the IRQ line up
  expect(adb.hasMouseData()).toBe(false)
})

test("a natural click (press, poll, release) yields exactly two clean reports", () => {
  adb.setMouseButton(true)
  const down = readReport()
  expect(down.buttonUp).toBe(false)

  // release comes after the guest consumed the press report
  adb.setMouseButton(false)
  const up = readReport()
  expect(up.x).toBe(0)
  expect(up.y).toBe(0)
  expect(up.buttonUp).toBe(true)
  expect(adb.hasMouseData()).toBe(false)
})

test("a release while dragging keeps the motion and shows the release", () => {
  adb.setMouseButton(true)
  readReport() // consume the press

  adb.queueMouse(-20, -10)
  adb.setMouseButton(false)

  const r = readReport()
  expect(r.x).toBe(-20)
  expect(r.y).toBe(-10)
  expect(r.buttonUp).toBe(true)
})

test("a click landing entirely between two guest polls does not wedge the line", () => {
  // down then up with no reads in between: on this snapshot model (like
  // KEGS/gssquared, both compute from live state) the guest can miss the
  // press, but no pending state may stay latched and hold the interrupt line.
  adb.setMouseButton(true)
  adb.setMouseButton(false)
  const r = readReport()
  expect(r.buttonUp).toBe(true)
  expect(adb.hasMouseData()).toBe(false)
})
