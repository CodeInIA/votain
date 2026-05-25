export interface Language {
  code: string;
  flag: string;
  name: string;
  nativeName: string;
}

export const LANGUAGES: Language[] = [
  { code: 'en', flag: '🇬🇧', name: 'English',    nativeName: 'English'    },
  { code: 'es', flag: '🇪🇸', name: 'Spanish',    nativeName: 'Español'    },
  { code: 'fr', flag: '🇫🇷', name: 'French',     nativeName: 'Français'   },
  { code: 'de', flag: '🇩🇪', name: 'German',     nativeName: 'Deutsch'    },
  { code: 'pt', flag: '🇵🇹', name: 'Portuguese', nativeName: 'Português'  },
  { code: 'it', flag: '🇮🇹', name: 'Italian',    nativeName: 'Italiano'   },
  { code: 'nl', flag: '🇳🇱', name: 'Dutch',      nativeName: 'Nederlands' },
  { code: 'ru', flag: '🇷🇺', name: 'Russian',    nativeName: 'Русский'    },
  { code: 'zh', flag: '🇨🇳', name: 'Chinese',    nativeName: '中文'        },
  { code: 'ja', flag: '🇯🇵', name: 'Japanese',   nativeName: '日本語'      },
  { code: 'ko', flag: '🇰🇷', name: 'Korean',     nativeName: '한국어'      },
  { code: 'ar', flag: '🇸🇦', name: 'Arabic',     nativeName: 'العربية'    },
  { code: 'hi', flag: '🇮🇳', name: 'Hindi',      nativeName: 'हिन्दी'      },
];

export function getLanguageByCode(code: string): Language | undefined {
  const base = code.split('-')[0].toLowerCase();
  return LANGUAGES.find(l => l.code === base);
}
