import { RUN_MODE } from "../../common/utility"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import {
  faArrowRotateRight,
  faClipboard,
  faFolderOpen,
  faPaste,
  faPowerOff,
  faSave,
} from "@fortawesome/free-solid-svg-icons"
import { handleSetCPUState } from "../controller"
import { handleCopyToClipboard } from "../copycanvas"
import { handleGetRunMode, passPasteText } from "../main2worker"
import { handleFileSave } from "../savestate"
import { useTranslation } from "../../i18n/useTranslation"

const ControlButtons = (props: DisplayProps) => {
  const { t } = useTranslation()
  const runMode = handleGetRunMode()
  
  return <span className="flex-row" id="tour-maincontrols">
    <button className="push-button .boot-button"
      title={t("controls.boot")}
      id="tour-boot-button"
      onClick={() => { handleSetCPUState(RUN_MODE.NEED_BOOT) }}>
      <FontAwesomeIcon icon={faPowerOff} />
    </button>
    <button className="push-button"
      title={t("controls.reset")}
      id="tour-reset-button"
      onClick={() => { handleSetCPUState(RUN_MODE.NEED_RESET) }}
      disabled={runMode === RUN_MODE.IDLE || runMode === RUN_MODE.NEED_BOOT}
    >
      <FontAwesomeIcon icon={faArrowRotateRight} />
    </button>
    <span id="tour-saverestore" className="flex-row">
    <button className="push-button" title={t("controls.restoreState")}
      onClick={() => props.setShowFileOpenDialog(true, 0)}>
      <FontAwesomeIcon icon={faFolderOpen} style={{ fontSize: "0.9em" }} />
    </button>
    <button className="push-button" title={t("controls.saveState")}
      onClick={() => handleFileSave(false)}
      disabled={runMode === RUN_MODE.IDLE || runMode === RUN_MODE.NEED_BOOT}>
      <FontAwesomeIcon icon={faSave} />
    </button>
    </span>
    <button className="push-button" title={t("controls.copyScreen")}
      onClick={() => handleCopyToClipboard()}>
      <FontAwesomeIcon icon={faClipboard} />
    </button>
    <button className="push-button" title={t("controls.pasteText")}
      onClick={() => {
        navigator.clipboard.readText().then((data) => passPasteText(data))
      }}>
      <FontAwesomeIcon icon={faPaste} />
    </button>
  </span>
}

export default ControlButtons
