/**
 * Translations, loaded one language at a time.
 *
 * All thirteen used to be imported statically, which put 641 kB of JSON into
 * the main bundle: someone reading the site in Spanish downloaded the Arabic,
 * Hindi, Japanese, Korean, Russian and Chinese translations to never look at
 * them. Each is its own chunk now, fetched when it is the language in use.
 *
 * English is fetched alongside whatever else is active, because it is the
 * fallback: a key added to `en.json` and not yet translated has to resolve to
 * the English string rather than to its own name.
 *
 * `i18next-browser-languagedetector` is gone with them. Detection here is two
 * rules, localStorage then the browser's own list, which is exactly what it was
 * configured to do, and doing it inline is what lets the right language be
 * fetched BEFORE init rather than after.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED = [
  'en',
  'es',
  'fr',
  'de',
  'pt',
  'zh',
  'ar',
  'hi',
  'ru',
  'ja',
  'ko',
  'it',
  'nl',
] as const;

export type Language = (typeof SUPPORTED)[number];

const FALLBACK: Language = 'en';
/** The key `i18next-browser-languagedetector` used, kept so nobody's choice is lost. */
const STORAGE_KEY = 'i18nextLng';

/**
 * One dynamic import per language. Written out rather than built from a
 * template because a bundler can only split what it can see statically.
 */
const LOADERS: Record<Language, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('./locales/en.json'),
  es: () => import('./locales/es.json'),
  fr: () => import('./locales/fr.json'),
  de: () => import('./locales/de.json'),
  pt: () => import('./locales/pt.json'),
  zh: () => import('./locales/zh.json'),
  ar: () => import('./locales/ar.json'),
  hi: () => import('./locales/hi.json'),
  ru: () => import('./locales/ru.json'),
  ja: () => import('./locales/ja.json'),
  ko: () => import('./locales/ko.json'),
  it: () => import('./locales/it.json'),
  nl: () => import('./locales/nl.json'),
};

const isSupported = (value: string): value is Language =>
  (SUPPORTED as readonly string[]).includes(value);

/** localStorage first, then the browser's list, then English. */
export function detectLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)?.split('-')[0];
    if (stored && isSupported(stored)) return stored;
  } catch {
    // A browser that refuses storage still gets a language, just not a remembered one.
  }

  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag?.split('-')[0];
    if (base && isSupported(base)) return base;
  }
  return FALLBACK;
}

/** Fetches a language's bundle unless it is already in memory. */
async function load(language: Language): Promise<void> {
  if (i18n.hasResourceBundle(language, 'translation')) return;
  const module = await LOADERS[language]();
  i18n.addResourceBundle(language, 'translation', module.default, true, true);
}

/**
 * Arabic is the only right-to-left locale here. Without this the whole app
 * renders Arabic text left-aligned with the punctuation on the wrong side,
 * which is worst on the long prose of the Terms and Privacy pages. `lang` goes
 * with it so the browser picks the right font and hyphenation.
 */
const RTL_LANGUAGES: readonly string[] = ['ar'];

function applyDocumentDirection(language: string) {
  const base = language.split('-')[0];
  document.documentElement.lang = base;
  document.documentElement.dir = RTL_LANGUAGES.includes(base) ? 'rtl' : 'ltr';
}

/**
 * Loads a language, then switches to it, in that order.
 *
 * The other way round shows the raw keys for as long as the fetch takes, which
 * on a slow connection is the whole interface turning into `nav.discover`.
 */
export async function setLanguage(language: Language): Promise<void> {
  await load(language);
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Not remembering the choice is better than refusing to make it.
  }
  await i18n.changeLanguage(language);
}

/**
 * Initialises i18next with the language actually in use. Awaited before the
 * first render, so nothing paints in the wrong language and then corrects
 * itself.
 */
export async function bootstrapI18n(): Promise<void> {
  const language = detectLanguage();

  await i18n.use(initReactI18next).init({
    lng: language,
    fallbackLng: FALLBACK,
    supportedLngs: SUPPORTED as unknown as string[],
    resources: {},
    interpolation: {
      escapeValue: false, // React already safes from xss
    },
  });

  await Promise.all([load(language), language === FALLBACK ? null : load(FALLBACK)]);

  applyDocumentDirection(i18n.language);
  i18n.on('languageChanged', applyDocumentDirection);
}

export default i18n;
