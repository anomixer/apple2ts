import { en } from "./languages/en"
import { zhTW } from "./languages/zh-TW"

export type Language = "en" | "zh-TW"
export type TranslationKey = keyof typeof en

const translations = {
  "en": en,
  "zh-TW": zhTW
}

class I18n {
  private currentLanguage: Language = "en"
  
  constructor() {
    // 從 localStorage 讀取語言設定
    const saved = localStorage.getItem("apple2ts-language")
    if (saved && (saved === "en" || saved === "zh-TW")) {
      this.currentLanguage = saved as Language
    } else {
      // 偵測瀏覽器語言
      const browserLang = navigator.language.toLowerCase()
      if (browserLang.includes("zh") && (browserLang.includes("tw") || browserLang.includes("hant"))) {
        this.currentLanguage = "zh-TW"
      }
    }
  }
  
  setLanguage(lang: Language) {
    this.currentLanguage = lang
    localStorage.setItem("apple2ts-language", lang)
    // 觸發重新渲染
    window.dispatchEvent(new CustomEvent("languageChanged", { detail: lang }))
  }
  
  getLanguage(): Language {
    return this.currentLanguage
  }
  
  // 支援巢狀屬性的翻譯函數
  t(key: string): string {
    const keys = key.split(".")
    let value: unknown = translations[this.currentLanguage]
    
    for (const k of keys) {
      value = (value as Record<string, unknown>)?.[k]
    }
    
    return (value as string) || key // 找不到翻譯時返回 key
  }
}

export const i18n = new I18n()
export const t = i18n.t.bind(i18n)
