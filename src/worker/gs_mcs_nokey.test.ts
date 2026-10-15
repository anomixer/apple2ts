import { doSetMachineName, doSetRunMode, resetCpuSpeedForTesting, getCPU } from "./motherboard"
import { memGet24 } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

// The MCS no-keypress crash (AGENTS.md section 34).
//
// Left at the ProDOS 8 v1.2 startup banner with no key pressed, the machine
// eventually leaves the 16-bit delay loop at 01:33CC, falls into the 8-bit block
// copier at 00:F12E, and ends up executing a byte stream. The crash address
// differs every run, so the useful thing to capture is the *path*: the last
// instructions before control first leaves bank $01, and then everything up to
// the point where it stops making sense.
const MCS_PATH = process.env.GS_MCS_PATH || "C:\\dev\\emu\\ap2\\mcs.2mg"

const dis = (bank: number, pc: number, n: number) => {
  const out: string[] = []
  for (let k = 0; k < n; k++) out.push(memGet24(((bank << 16) | pc + k)).toString(16).padStart(2, "0"))
  return out.join(" ")
}

test("MCS: with no keypress the machine falls out of the banner into the $F12E loader and runs away", () => {
  jest.useFakeTimers()
  setIsTesting()
  try {
    doSetMachineName("APPLE2GS")
    const data = fs.readFileSync(MCS_PATH)
    expect(doSetEmuDriveNewData({
      index: 0, hardDrive: true, drive: 1, filename: "mcs.2mg", status: "",
      motorRunning: false, diskHasChanges: false, isWriteProtected: false,
      diskData: new Uint8Array(data), lastAppleWriteTime: 0, cloudData: null,
      writableFileHandle: null, lastLocalFileWriteTime: 0,
    } as DriveProps)).toBe(true)

    const cpu = getCPU() as any
    const origPI = cpu.processInstruction.bind(cpu)
    const ring: string[] = []
    let phase = 0            // 0 = settling in the delay loop, 1 = recording the escape
    let escaped = false
    let dataHit = false
    let instr = 0
    let escapeFrom = ""
    const seen = new Set<string>()

    cpu.processInstruction = (cb?: any) => {
      const pb = cpu.PB, pc = cpu.PC
      instr++
      if (phase === 0 && instr > 1000) {
        // Nothing to do while settling; the detector is armed later, once the
        // machine is parked in the 16-bit delay loop at 01:33CC.
      }
      if (phase === 1) {
        if (!escaped && pb === 0x00) {
          escaped = true
          escapeFrom = `${pb.toString(16)}:${pc.toString(16).padStart(4, "0")}`
          console.log(`[ESCAPE] bank $01 -> bank $00 at instr#${instr} via ${escapeFrom}`)
          console.log("[BEFORE ESCAPE] last 120 PCs:")
          console.log("  " + ring.slice(-120).join("\n  "))
        }
        if (escaped && !seen.has(pb.toString(16))) {
          seen.add(pb.toString(16))
          console.log(`[FIRST VISIT bank ${pb.toString(16)}] instr#${instr} at ${pc.toString(16).padStart(4, "0")}`)
          console.log(`  code: ${dis(pb, pc, 24)}`)
        }
        // The data ramp lives around $8500-$8700. The last thing that was still
        // code is the instruction just before control first lands there.
        if (!dataHit && pb === 0x00 && pc >= 0x8500 && pc <= 0x8700) {
          dataHit = true
          console.log(`[DATA] control entered the ramp at instr#${instr}, $00:${pc.toString(16).padStart(4, "0")}`)
          console.log("  [PATH] the 300 PCs before that:")
          console.log("  " + ring.slice(-300).join("\n  "))
          console.log("  [DISASM] last 40 of those:")
          for (const p of ring.slice(-40)) {
            const [b, a] = p.split(":")
            console.log(`    ${p}  ${dis(parseInt(b, 16), parseInt(a, 16), 12)}`)
          }
        }
      }
      if (ring.length >= 4000) ring.shift()
      ring.push(`${pb.toString(16).padStart(2, "0")}:${pc.toString(16).padStart(4, "0")}`)
      return origPI(cb)
    }

    doSetRunMode(RUN_MODE.NEED_BOOT)
    doSetRunMode(RUN_MODE.RUNNING, false)
    // Settle on the ProDOS 8 banner: the machine parks in the 16-bit delay loop
    // at 01:33CC. Only then is a bank $00 visit interesting.
    for (let f = 0; f < 1200; f++) jest.advanceTimersByTime(17)
    console.log(`[SETTLED] instr=${instr} PB=${cpu.PB.toString(16)} PC=${cpu.PC.toString(16)}`)
    phase = 1
    instr = 0
    ring.length = 0
    for (let f = 0; f < 2400; f++) jest.advanceTimersByTime(17)

    console.log(`[FINAL] instr=${instr} PB=${cpu.PB.toString(16)} PC=${cpu.PC.toString(16)} escaped=${escaped}`)
    console.log(`[FINAL] code at PC: ${dis(cpu.PB, cpu.PC, 24)}`)
    console.log(`[FINAL] code at $00:F120: ${dis(0x00, 0xf120, 48)}`)
    console.log(`[FINAL] code at $00:F160: ${dis(0x00, 0xf160, 48)}`)
    // The bug this guards: with Math.random() bus noise the machine was
    // nondeterministic and, often enough, ran off into the byte ramp at
    // $8500-$8700 that lives in bank 0 between the two crash addresses reported
    // in AGENTS.md section 34 ($8149, $6F02, $85E6). Two consecutive runs now
    // both end at $00:E03B with identical instruction counts.
    expect(cpu.PC < 0x8000 || cpu.PC > 0x8700).toBe(true)
  } finally {
    doSetRunMode(RUN_MODE.PAUSED, false)
    resetCpuSpeedForTesting()
    jest.useRealTimers()
  }
}, 1800000)