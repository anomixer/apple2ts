import { testWithFixtures } from "../test/fixture_test"
import { doSetMachineName, doSetRunMode, doSetSpeedMode, resetCpuSpeedForTesting, getCPU } from "./motherboard"
import { getShr, memGet24 } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { setKeyboardState } from "./devices/keyboard"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

// Rastan (Taito, 1988) ships on two 3.5" disks that the IIgs's built-in slot-5
// drive reads through the game's own GCR driver. The driver's media check reads
// four bytes right after it finds the sector prologue and compares them with the
// four it latched on the first pass; when every pass "matches" the counters hit
// 14 and the game takes a far call into $0404 and spins forever in $5D03 - the
// hang the user reported when a new game is started.
//
// The passes only agree because the 3.5" LSS used to be handed the raw .woz
// cells: the inter-sector gaps in these images are ~1000 zero cells, so the
// shift register never published and the four compared bytes came back as the
// same $FF/$00 run every revolution. A real drive (and gssquared's
// Floppy_woz::read_pulse) turns any four consecutive zero cells into a random
// fake bit, which is what makes the passes disagree. This test boots the real
// images, starts a 1-player game with J then 1 as the user does, and checks the
// machine plays instead of falling into that loop.
const D1 = process.env.GS_RASTAN_D1 || "C:\\dev\\emu\\ap2\\DISKS\\rastan1.woz"
const D2 = process.env.GS_RASTAN_D2 || "C:\\dev\\emu\\ap2\\DISKS\\rastan2.woz"
const FRAME_CAP = Number(process.env.GS_RASTAN_FRAMES || 13000)
// Key presses start once the loader has had the drive to itself for a while and
// repeat through the attract sequence, so the test does not depend on the exact
// frame the menu appears on.
const FIRST_KEYS = 6000
const KEY_PERIOD = 60
const LAST_KEYS = 9600
const GATE = 0x599B // far-call gate: fires when the four counters sum to >= 14
const CRASH_ENTRY = 0x0404
const CRASH_LOOP = 0x5d03
const SEARCH_OK = 0x5b85

const driveProps = (index: number, path: string, drive: number) => ({
  index, hardDrive: false, drive, filename: path.split("\\").pop() || "disk", status: "",
  motorRunning: false, diskHasChanges: false, isWriteProtected: false,
  diskData: new Uint8Array(fs.readFileSync(path)), lastAppleWriteTime: 0,
  cloudData: null, writableFileHandle: null, lastLocalFileWriteTime: 0,
} as DriveProps)

const tap = (ascii: number, domCode: string) => {
  setKeyboardState({ key: ascii, isDown: true, repeat: false, domCode })
  setKeyboardState({ key: ascii, isDown: false, repeat: false, domCode })
}

testWithFixtures(D1, D2)("Rastan starts a game instead of hanging in the 3.5\" verify path", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    expect(doSetEmuDriveNewData(driveProps(4, D1, 1))).toBe(true)
    expect(doSetEmuDriveNewData(driveProps(5, D2, 2))).toBe(true)
    // The driver's IWM polling loop only keeps up with 500 kbit/s media at the
    // IIgs's 2.8 MHz fast clock.
    doSetSpeedMode(1)
    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)

    // The instruction hook samples the driver's own PC values; getCPU() hands
    // back the live CPU, so describe just the fields this test touches.
    const cpu = getCPU() as unknown as { PB: number; PC: number; processInstruction: () => number }
    const origExec = cpu.processInstruction
    let searched = 0
    const gateSums: number[] = []
    let crashAt = ""
    const screenSums: number[] = []
    let maxShrBytes = 0

    cpu.processInstruction = function () {
      const pb = cpu.PB & 0xff
      const pc = cpu.PC & 0xffff
      if (pb === 0) {
        if (pc === SEARCH_OK) searched++
        else if (pc === GATE) {
          let sum = 0
          for (let a = 1; a <= 4; a++) sum += memGet24(0x5800 + a)
          gateSums.push(sum)
        } else if (pc === CRASH_ENTRY) crashAt = "$0404"
        else if (pc === CRASH_LOOP) crashAt = "$5D03"
      }
      return origExec.call(cpu)
    }

    for (let frame = 0; frame < FRAME_CAP; frame++) {
      jest.advanceTimersByTime(17)
      if (frame >= FIRST_KEYS && frame <= LAST_KEYS && (frame - FIRST_KEYS) % KEY_PERIOD === 0) {
        tap(106, "KeyJ")
        tap(49, "Digit1")
      }
      if (frame % 5 === 0) {
        const shr = getShr()
        let hash = 0
        let nonZero = 0
        for (let i = 0; i < shr.length; i++) {
          const b = shr[i]
          hash = ((hash * 31) + b) | 0
          if (b) nonZero++
        }
        screenSums.push(hash)
        if (nonZero > maxShrBytes) maxShrBytes = nonZero
      }
    }

    // The 3.5" driver really ran: it found its prologue on the media.
    expect(searched).toBeGreaterThan(0)
    // Every time the verify gate was reached it saw fewer than 14 matching
    // passes, so it took the normal CLC/RTS exit instead of the far call.
    expect(gateSums.length).toBeGreaterThan(0)
    for (const sum of gateSums) expect(sum).toBeLessThan(14)
    // And the machine never reached the hang this bug produced.
    expect(crashAt).toBe("")
    // The game is running: its SHR screens keep changing instead of freezing on
    // the single frame the $5D03 poll left behind.
    const allDistinct = new Set(screenSums).size
    const tailDistinct = new Set(screenSums.slice(-300)).size
    console.log(`[RASTAN] searched=${searched} gates=${JSON.stringify(gateSums)} crash=${crashAt} ` +
      `samples=${screenSums.length} distinct=${allDistinct} tail=${tailDistinct} maxShr=${maxShrBytes}`)
    expect(allDistinct).toBeGreaterThan(200)
    expect(tailDistinct).toBeGreaterThan(2)
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 1800000)
