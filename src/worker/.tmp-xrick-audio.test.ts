import { doSetMachineName, doSetRunMode } from "./motherboard"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { iigsEnsoniq, docAccess, resetDocAccess, ensoniqDocRam } from "./devices/iigs_ensoniq"
import * as fs from "fs"

const PO_PATH = "C:\\dev\\emu\\ap2\\DISKS\\xrick800k.po"
const OUT_PATH = "C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\xrick_audio.json"

test("XRick DOC audio probe", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  iigsEnsoniq.reset()
  resetDocAccess()

  const w2m = require("./worker2main")
  const captured: Array<{ sr: number, frames: number }> = []
  const blocks: Int16Array[] = []
  w2m.passEnsoniqSound = (samples: Int16Array, rate: number) => {
    captured.push({ sr: rate, frames: samples.length / 2 })
    if (blocks.length < 400) {
      blocks.push(Int16Array.from(samples))
    }
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
    const a = docAccess
    console.log(`[XRICK-AUDIO] ${label} frames=${label} c${a.control} d${a.data} al${a.addrLow} ah${a.addrHigh} r${a.reads} ` +
      `osce=${iigsEnsoniq.osce} rate=${iigsEnsoniq.outputRate()} samples=${iigsEnsoniq.samplesGenerated} ` +
      `halts=${iigsEnsoniq.haltCount} irq=${iigsEnsoniq.irqTicks}`)
    console.log(`[XRICK-AUDIO]   osc0 freq=${iigsEnsoniq.oscillators[0].freq.toString(16)} wtsize=${iigsEnsoniq.oscillators[0].wtsize.toString(16)} control=${iigsEnsoniq.oscillators[0].control.toString(16)} vol=${iigsEnsoniq.oscillators[0].vol.toString(16)} data=${iigsEnsoniq.oscillators[0].data.toString(16)} ptr=${iigsEnsoniq.oscillators[0].wavetblpointer.toString(16)} wtblsize=${iigsEnsoniq.oscillators[0].wavetblsize} res=${iigsEnsoniq.oscillators[0].resolution}`)
    console.log(`[XRICK-AUDIO]   osc1 freq=${iigsEnsoniq.oscillators[1].freq.toString(16)} control=${iigsEnsoniq.oscillators[1].control.toString(16)} vol=${iigsEnsoniq.oscillators[1].vol.toString(16)} ptr=${iigsEnsoniq.oscillators[1].wavetblpointer.toString(16)}`)
    const docNonZero = ensoniqDocRam.reduce((n, b) => n + (b !== 0 ? 1 : 0), 0)
    console.log(`[XRICK-AUDIO]   docNonZero=${docNonZero} blocks=${captured.length} ` +
      `lastRates=${captured.slice(-8).map(c => `${c.sr}/${c.frames}`).join(",")}`)
  }

  const stages = (process.env.XRICK_AUDIO_STAGES || "2000,4000,6000,8000,10000,12000,14000,16000,18000,20000")
    .split(",").map(Number)
  let last = 0
  for (let idx = 0; idx < stages.length; idx++) {
    const st = stages[idx]
    pump(st - last)
    last = st
    report(`stage${st}`)
  }

}, 600000)
