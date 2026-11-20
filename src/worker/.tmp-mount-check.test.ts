import { doSetEmuDriveNewData, getDriveStateByIndex } from "./devices/drivestate"
import { doSetMachineName } from "./motherboard"
import { setIsTesting } from "./worker2main"
import * as fs from "fs"

test("mount check", () => {
  setIsTesting()
  doSetMachineName("APPLE2GS")
  const system = "C:/dev/emu/ap2/DISKS/GSOS601.po"
  const merlin = "C:/dev/emu/ap2/DISKS/merlin 16+ v4.68 (1989)(roger wagner publishing)(disk 1 of 3).2mg"
  const mount = (index: number, drive: number, path: string) =>
    doSetEmuDriveNewData({
      index, hardDrive: false, drive, filename: path.split("/").pop()!, status: "",
      motorRunning: false, diskHasChanges: false, isWriteProtected: false,
      diskData: new Uint8Array(fs.readFileSync(path)), lastAppleWriteTime: 0,
      cloudData: null, writableFileHandle: null, lastLocalFileWriteTime: 0,
    } as DriveProps)
  console.log('gs', mount(4, 1, system))
  console.log('merlin', mount(5, 2, merlin))
  for (const i of [4, 5]) {
    const d = getDriveStateByIndex(i)
    console.log(i, JSON.stringify({ filename: d.filename, drive: d.drive, is35: d.is35, isHardDrive: d.isHardDrive, diskSwitched: d.diskSwitched, motorRunning: d.motorRunning, bytes: d.diskData?.length }))
  }
})
