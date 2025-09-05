import {
  faWalking,
  faPersonRunning,
  faPersonBiking,
  faTruckFast,
  faRocket,
} from "@fortawesome/free-solid-svg-icons"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import { DropdownButton } from "./dropdownbutton"
import { handleGetSpeedMode } from "../main2worker"
import { setPreferenceSpeedMode } from "../localstorage"
import { snailIcon } from "../img/icon_snail"
import { turtleIcon } from "../img/icon_turtle"
import { useTranslation } from "../../i18n/useTranslation"

export const SpeedDropdown = (props: { updateDisplay: UpdateDisplay }) => {
  const { t } = useTranslation()
  const speedMode = handleGetSpeedMode()
  
  const speedNames = [
    t("speed.snail"),    // "0.1 MHz (Snail)"
    t("speed.slow"),     // "0.5 MHz (Slow)"
    t("speed.normal"),  // "1 MHz (Normal)"
    t("speed.two"),     // "2 MHz"
    t("speed.three"),   // "3 MHz"
    t("speed.fast"),    // "4 MHz (Fast)"
    t("speed.warp")     // "Ludicrous/Warp Speed"
  ]
  
  const iconSize = 22
  const icons = [
    <svg key="-2" width="27" height="27" className="fill-color">{snailIcon}</svg>,
    <svg key="-1" width="27" height="27" className="fill-color">{turtleIcon}</svg>,
    <FontAwesomeIcon key="0" icon={faWalking} style={{ fontSize: `${iconSize}px` }}/>,
    <FontAwesomeIcon key="1" icon={faPersonRunning} style={{ fontSize: `${iconSize}px` }}/>,
    <FontAwesomeIcon key="2" icon={faPersonBiking} style={{ fontSize: `${iconSize}px` }}/>,
    <FontAwesomeIcon key="3" icon={faTruckFast} style={{ fontSize: `${iconSize}px` }}/>,
    <FontAwesomeIcon key="4" icon={faRocket} style={{ fontSize: `${iconSize}px` }}/>
  ]
  const icon = icons[speedMode + 2] // Adjust for the first two modes (snail and turtle)

  return (
    <DropdownButton 
      currentIndex = {speedMode + 2}
      itemNames = {speedNames}
      closeCallback = {(index: number) => {setPreferenceSpeedMode(index - 2); props.updateDisplay()}}
      icon ={icon}
      icons = {icons}
      tooltip = {t("config.speed")}
    />
  )
}
