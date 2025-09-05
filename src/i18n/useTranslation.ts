import { useState, useEffect } from "react"
import { i18n, Language } from "./index"

export const useTranslation = () => {
  const [language, setLanguage] = useState<Language>(i18n.getLanguage())
  
  useEffect(() => {
    const handleLanguageChange = (event: CustomEvent<Language>) => {
      setLanguage(event.detail)
    }
    
    window.addEventListener("languageChanged", handleLanguageChange as EventListener)
    
    return () => {
      window.removeEventListener("languageChanged", handleLanguageChange as EventListener)
    }
  }, [])
  
  const changeLanguage = (lang: Language) => {
    i18n.setLanguage(lang)
  }
  
  return {
    t: i18n.t.bind(i18n),
    language,
    changeLanguage
  }
}
