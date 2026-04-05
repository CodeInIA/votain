import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Resources
import enTranslation from './locales/en.json';
import esTranslation from './locales/es.json';
import frTranslation from './locales/fr.json';
import deTranslation from './locales/de.json';
import ptTranslation from './locales/pt.json';
import zhTranslation from './locales/zh.json';
import arTranslation from './locales/ar.json';
import hiTranslation from './locales/hi.json';
import ruTranslation from './locales/ru.json';
import jaTranslation from './locales/ja.json';
import koTranslation from './locales/ko.json';
import itTranslation from './locales/it.json';
import nlTranslation from './locales/nl.json';

const resources = {
  en: { translation: enTranslation },
  es: { translation: esTranslation },
  fr: { translation: frTranslation },
  de: { translation: deTranslation },
  pt: { translation: ptTranslation },
  zh: { translation: zhTranslation },
  ar: { translation: arTranslation },
  hi: { translation: hiTranslation },
  ru: { translation: ruTranslation },
  ja: { translation: jaTranslation },
  ko: { translation: koTranslation },
  it: { translation: itTranslation },
  nl: { translation: nlTranslation },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'es', 'fr', 'de', 'pt', 'zh', 'ar', 'hi', 'ru', 'ja', 'ko', 'it', 'nl'],
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false, // React already safes from xss
    },
  });

export default i18n;