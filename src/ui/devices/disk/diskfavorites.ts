import { determineVtocType, VTOC_REFRESH } from "../../../common/prodos_hdv"
import { DISK_COLLECTION_ITEM_TYPE } from "../../diskdialog/diskpanel_utils"
import { DiskBookmarks } from "./diskbookmarks"

export const canFavoriteDisk = (drive: DriveProps) => Boolean(drive.cloudData?.itemId)

export const isDiskFavorite = (bookmarks: DiskBookmarks, drive: DriveProps) =>
  Boolean(drive.cloudData?.itemId && bookmarks.contains(drive.cloudData.itemId))

const favoriteType = (cloudData: CloudData) => {
  if (cloudData.providerName === "DemoZoo") return DISK_COLLECTION_ITEM_TYPE.DEMOZOO
  if (cloudData.providerName === "InternetArchive" || cloudData.downloadUrl) {
    return DISK_COLLECTION_ITEM_TYPE.INTERNET_ARCHIVE
  }
  return DISK_COLLECTION_ITEM_TYPE.CLOUD_DRIVE
}

export const setDiskFavorite = (
  bookmarks: DiskBookmarks,
  drive: DriveProps,
  enabled: boolean,
  screenshotUrl: URL,
) => {
  const cloudData = drive.cloudData
  if (!cloudData?.itemId) return
  if (!enabled) {
    bookmarks.remove(cloudData.itemId)
    return
  }

  const type = favoriteType(cloudData)
  bookmarks.set({
    type,
    id: cloudData.itemId,
    title: cloudData.title || cloudData.fileName || drive.filename,
    screenshotUrl,
    lastUpdated: new Date(type === DISK_COLLECTION_ITEM_TYPE.CLOUD_DRIVE
      ? cloudData.lastSyncTime
      : Date.now()),
    diskUrl: type === DISK_COLLECTION_ITEM_TYPE.INTERNET_ARCHIVE
      ? cloudData.downloadUrl
      : undefined,
    cloudData,
    vtocType: determineVtocType(cloudData.fileName || drive.filename, drive.diskData),
    vtocVersion: VTOC_REFRESH,
  })
}