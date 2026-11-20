import { doSetMachineName, doSetRunMode } from "./motherboard"
import { doSetEmuDriveNewData } from "./devices/drivestate"
import { RUN_MODE } from "../common/utility"
import { setIsTesting } from "./worker2main"
import { iigsEnsoniq, resetDocAccess } from "./devices/iigs_ensoniq"
import { setKeyboardState } from "./devices/keyboard"
import * as fs from "fs"

const PO_PATH = "C:\\dev\\emu\\ap2\\DISKS\\xrick800k.po"

test("XRick DOC register write trace", () => {
  jest.useFakeTimers()
  setIsTesting()
  doSetMachineName("APPLE2GS")
  iigsEnsoniq.reset()
  resetDocAccess()
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
  for (let f = 0; f < 1000; f++) jest.advanceTimersByTime(17)

  const e = iigsEnsoniq as any
  const log: string[] = []
  const regNames = ["freqlo","freqhi","vol","data","ptr","ctrl","size"]
  const origData = e.writeData.bind(e)
  e.writeData = function (v: number) {
    if (!(this.soundctl & 0x40)) {
      const adl = this.soundadrl
      const grp = adl & 0xe0
      const name = regNames[grp >> 5] || "?" + (grp >> 5).toString()
      const osc = adl & 0x1f
      const o = this.oscillators[osc]
      log.push(`REG ${adl.toString(16)} ${name}+${osc} <- ${v.toString(16)} oldf=${o.freq.toString(16)} oldc=${o.control.toString(16)} oldv=${o.vol.toString(16)}`)
    }
    return origData(v)
  }
  const origCtl = e.writeControl.bind(e)
  e.writeControl = function (v: number) { log.push(`CTL <- ${v.toString(16)} old=${this.soundctl.toString(16)}`); return origCtl(v) }
  const origLow = e.writeAddrLow.bind(e)
  e.writeAddrLow = function (v: number) { log.push(`ADL <- ${v.toString(16)}`); return origLow(v) }
  const origHigh = e.writeAddrHigh.bind(e)
  e.writeAddrHigh = function (v: number) { log.push(`ADH <- ${v.toString(16)}`); return origHigh(v) }

  for (let f = 0; f < 300; f++) {
    if (f === 0) setKeyboardState({ key: 0x4b, isDown: true, repeat: false, domCode: "KeyK" })
    if (f === 20) setKeyboardState({ key: 0x4b, isDown: false, repeat: false, domCode: "KeyK" })
    jest.advanceTimersByTime(17)
  }
  console.log(log.join("\n"))
  console.log("osce", iigsEnsoniq.osce, "rate", iigsEnsoniq.outputRate(), "halts", iigsEnsoniq.haltCount, "irq", iigsEnsoniq.irqTicks)
  fs.writeFileSync("C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\xrick-start\\reg-writes2.txt", log.join("\n"))
}, 300000)

declare const DriveProps: any
