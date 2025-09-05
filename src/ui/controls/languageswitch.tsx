import React from "react"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import { faGlobe } from "@fortawesome/free-solid-svg-icons"
import { useTranslation } from "../../i18n/useTranslation"
import { Language } from "../../i18n"

const LanguageSwitch: React.FC = () => {
  const { language, changeLanguage } = useTranslation()
  
  const toggleLanguage = () => {
    const newLang: Language = language === "en" ? "zh-TW" : "en"
    changeLanguage(newLang)
  }
  
  const getLanguageDisplay = () => {
    return language === "en" ? "中" : "EN"
  }
  
  return (
    <button 
      className="push-button"
      title={language === "en" ? "Switch to Traditional Chinese" : "切換到英文"}
      onClick={toggleLanguage}
      style={{ position: "relative", minWidth: "40px" }}
    >
      <FontAwesomeIcon 
        icon={faGlobe} 
        style={{ fontSize: "0.8em", marginRight: "4px" }}
      />
      <span style={{ fontSize: "0.75em", fontWeight: "bold" }}>
        {getLanguageDisplay()}
      </span>
    </button>
  )
}

export default LanguageSwitch
