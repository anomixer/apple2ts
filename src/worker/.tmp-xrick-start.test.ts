import { doSetMachineName, doSetRunMode, doSetSpeedMode, getCPU } from "./motherboard"
import { getShrDisplayed, getTextPageAsString, memGetC000, memGet24 } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { iigsEnsoniq, docAccess, resetDocAccess, ensoniqDocRam } from "./devices/iigs_ensoniq"
import { setKeyboardState } from "./devices/keyboard"
import * as fs from "fs"

const PO_PATH = "C:\\dev\\emu\\ap2\\DISKS\\xrick800k.po"
const OUT_DIR = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\xrick-start"

test("XRick start + DOC audio probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  doSetSpeedMode(2)  // 7.1 MHz for boot only: load XRick faster, keep DOC rate from the video clock
  iigsEnsoniq.reset()
  resetDocAccess()

  const w2m = require("./worker2main")
  const captured: Array<{ sr: number, frames: number }> = []
  const blocks: Int16Array[] = []
  w2m.passEnsoniqSound = (samples: Int16Array, rate: number) => {
    captured.push({ sr: rate, frames: samples.length / 2 })
    if (blocks.length < 600) blocks.push(Int16Array.from(samples))
  }

  const data = fs.readFileSync(PO_PATH)
  const props: DriveProps = {
    index: 0, hardDrive: true, drive: 1, filename: "xrick800k.po", status: "",
    motorRunning: false, diskHasChanges: false, isWriteProtected: false,
    diskData: new Uint8Array(data), lastAppleWriteTime: 0, cloudData: null,
    writableFileHandle: null, lastLocalFileWriteTime: 0,
  }
  expect(doSetEmuDriveNewData(props)).toBe(true)
  doSetRunMode(RUN_MODE.NEED_BOOT)
  doSetRunMode(RUN_MODE.RUNNING, false)

  const pump = (frames: number) => {
    for (let f = 0; f < frames; f++) jest.advanceTimersByTime(17)
  }

  const activeOsc = () => {
    let n = 0
    for (let i = 0; i < 32; i++) if (!(iigsEnsoniq.oscillators[i].control & 1)) n++
    return n
  }
  const report = (label: string) => {
    const a = docAccess
    const cpu = getCPU() as any
    console.log(`[XRICK-START] ${label} c${a.control} d${a.data} al${a.addrLow} ah${a.addrHigh} r${a.reads} ` +
      `osce=${iigsEnsoniq.osce} rate=${iigsEnsoniq.outputRate()} samples=${iigsEnsoniq.samplesGenerated} ` +
      `halts=${iigsEnsoniq.haltCount} irq=${iigsEnsoniq.irqTicks} active=${activeOsc()} ` +
      `PC=${cpu.PB.toString(16)}:${cpu.PC.toString(16)}`)
    console.log(`[XRICK-START]   docNonZero=${ensoniqDocRam.reduce((n, b) => n + (b !== 0 ? 1 : 0), 0)} ` +
      `blocks=${captured.length} lastRates=${captured.slice(-4).map(c => `${c.sr}/${c.frames}`).join(",")}`)
  }

  const stages = [1000, 2000, 3000, 4000, 5000, 6000]
  for (const st of stages) {
    pump(st === 1000 ? 1000 : 1000)
    report(`boot${st}`)
  }

  doSetSpeedMode(1)
  pump(60)

  // Try each plausible start key: prompt asks joystick or keyboard.
  const keys: Array<{ key: number, domCode: string }> = [
    { key: 0x4b, domCode: "KeyK" },
    { key: 0x4a, domCode: "KeyJ" },
    { key: 0x0d, domCode: "Enter" },
    { key: 0x20, domCode: "Space" },
    { key: 0x35, domCode: "Escape" },
    { key: 0x28, domCode: "KeyK" },
  ]
  for (const k of keys) {
    const before = getShrDisplayed().slice()
    const beforeText = getTextPageAsString()
    setKeyboardState({ key: k.key, isDown: true, repeat: false, domCode: k.domCode })
    pump(40)
    setKeyboardState({ key: k.key, isDown: false, repeat: false, domCode: k.domCode })
    pump(260)
    const after = getShrDisplayed()
    const changed = Array.from(after).reduce((n, b, i) => n + (b === before[i] ? 0 : 1), 0)
    console.log(`[XRICK-START] after ${k.domCode} key=${k.key.toString(16)} -> shrChanged=${changed} textChanged=${getTextPageAsString() !== beforeText} ` +
      `c000=${memGetC000(0xC000).toString(16)} active=${activeOsc()} halts=${iigsEnsoniq.haltCount} irq=${iigsEnsoniq.irqTicks}`)
    report(`after-${k.domCode}`)
  }

  const cpu = getCPU() as any
  const pc = (cpu.PB << 16) | cpu.PC
  const dump: string[] = []
  dump.push(`PC=${cpu.PB.toString(16)}:${cpu.PC.toString(16)} A=${cpu.A.toString(16)} X=${cpu.X.toString(16)} Y=${cpu.Y.toString(16)} P=${cpu.P.toString(16)}`)
  for (let i = 0; i < 64; i++) {
	 const addr = (pc + i) & 0xffffff
    dump.push(`${addr.toString(16).padStart(6, "0")} ${memGet24(addr).toString(16).padStart(2, "0")}`)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(`${OUT_DIR}\\pc-dump.txt`, dump.join("\n"))

  // Capture audio if any oscillator started; flatten after the key attempts.
  if (blocks.length > 0) {
    const flat: number[] = []
    for (const b of blocks) {
      for (let i = 0; i + 1 < b.length; i += 2) flat.push((b[i] + b[i + 1]) / 32768)
    }
    fs.writeFileSync(`${OUT_DIR}\\audio.json`, JSON.stringify({ sr: captured.at(-1)?.sr || iigsEnsoniq.outputRate(), data: flat }))
  }
}, 600000)
