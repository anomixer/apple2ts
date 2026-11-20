import { doSetMachineName, doSetRunMode, getCPU, getIigsVblCount } from "./motherboard"
import { getShrDisplayed, memGetC000 } from "./memory"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { iigsEnsoniq, docAccess, resetDocAccess, ensoniqDocRam } from "./devices/iigs_ensoniq"
import { setKeyboardState } from "./devices/keyboard"
import * as fs from "fs"

const PO_PATH = "C:\\dev\\emu\\ap2\\DISKS\\xrick800k.po"

test("XRick DOC registers and start keys", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  iigsEnsoniq.reset()
  resetDocAccess()

  const captured: Array<{ sr: number, frames: number }> = []
  const audioBlocks: Int16Array[] = []
  let capturing = false
  const w2m = require("./worker2main")
  w2m.passEnsoniqSound = (samples: Int16Array, rate: number) => {
    captured.push({ sr: rate, frames: samples.length / 2 })
    if (capturing) audioBlocks.push(Int16Array.from(samples))
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

  const report = (label: string) => {
    const cpu = getCPU() as any
    const postedFrames = captured.reduce((n, c) => n + c.frames, 0)
    console.log(`[DOC] ${label} frames PC=${cpu.PB.toString(16)}:${cpu.PC.toString(16)} osce=${iigsEnsoniq.osce} rate=${iigsEnsoniq.outputRate()} samples=${iigsEnsoniq.samplesGenerated} posted=${postedFrames} vbl=${getIigsVblCount()} halts=${iigsEnsoniq.haltCount} irq=${iigsEnsoniq.irqTicks} docNZ=${ensoniqDocRam.reduce((n, b) => n + (b !== 0 ? 1 : 0), 0)} blocks=${captured.length} ${captured.slice(-3).map(c => `${c.sr}/${c.frames}`).join(",")}`)
    for (let i = 0; i < 8; i++) {
      const o = iigsEnsoniq.oscillators[i]
      console.log(`[DOC] osc${i} freq=${o.freq.toString(16)} wtsize=${o.wtsize} ctrl=${o.control.toString(16)} vol=${o.vol.toString(16)} ptr=${o.wavetblpointer.toString(16)} wtbl=${o.wavetblsize} res=${o.resolution}`)
    }
  }

  pump(1000)
  report("boot1000")
  console.log(`[DOC] c000=${memGetC000(0xC000).toString(16)}`)

  const cpu0 = getCPU() as any
  const origWrite8 = cpu0.write8.bind(cpu0)
  const docWrites: string[] = []
  cpu0.write8 = function (address: number, value: number) {
    if ((address & 0xffff) >= 0xc03c && (address & 0xffff) <= 0xc03f && docWrites.length < 400) {
      docWrites.push(`${this.PB.toString(16).padStart(2, "0")}:${this.PC.toString(16).padStart(4, "0")} ${address.toString(16)} <- ${value.toString(16)}`)
    }
    return origWrite8(address, value)
  }

  const keys: Array<{ key: number, domCode: string }> = [
    { key: 0x4b, domCode: "KeyK" },
    { key: 0x4a, domCode: "KeyJ" },
    { key: 0x0d, domCode: "Enter" },
    { key: 0x20, domCode: "Space" },
    { key: 0x28, domCode: "KeyK2" },
    { key: 0x26, domCode: "KeyJ2" },
  ]
  capturing = true
  for (const k of keys) {
    setKeyboardState({ key: k.key, isDown: true, repeat: false, domCode: k.domCode })
    pump(20)
    setKeyboardState({ key: k.key, isDown: false, repeat: false, domCode: k.domCode })
    pump(80)
    report(`after-${k.domCode}`)
  }
  const outDir = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\xrick-start"
  fs.mkdirSync(outDir, { recursive: true })
  const flat: Array<{ l: number[], r: number[] }> = []
  for (const b of audioBlocks) {
    const l: number[] = []
    const r: number[] = []
    for (let i = 0; i + 1 < b.length; i += 2) {
      l.push(b[i])
      r.push(b[i + 1])
    }
    flat.push({ l, r })
  }
  fs.writeFileSync(`${outDir}\\doc-audio.json`, JSON.stringify({ rate: 26320, blocks: flat }))
  fs.writeFileSync(`${outDir}\\doc-writes.txt`, docWrites.join("\n"))
}, 600000)
