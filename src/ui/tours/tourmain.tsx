import { Step } from "react-joyride"
import { i18n } from "../../i18n"

export const getTourMain = (): Step[] => {
  const t = i18n.t.bind(i18n)
  
  return [
    {
      target: "body",
      placement: "center",
      content: t("tour.welcome") + " " + t("tour.clickNext")
    },
    {
      target: "#tour-boot-button",
      content: t("tour.bootButton"),
    },
    {
      target: "#tour-reset-button",
      content: t("tour.resetButton"),
    },
    {
      target: "#tour-disk-images",
      content: t("tour.diskImages"),
    },
    {
      target: "#tour-floppy-disks",
      content: t("tour.floppyDisks"),
    },
    {
      target: "#tour-saverestore",
      content: t("tour.saveRestore"),
    },
    {
      target: "#tour-theme-button",
      content: t("tour.themeButton")
    },
    {
      target: "body",
      placement: "center",
      content: t("tour.endTour"),
    },
  ]
}

// 保持向後相容性
export const tourMain = getTourMain()
