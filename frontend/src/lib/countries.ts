/**
 * ISO 3166-1 country data for the eligibility picker.
 *
 * Only the alpha-3 to alpha-2 mapping is stored here. Everything a human reads
 * is derived at runtime:
 *
 *  - The NAME comes from `Intl.DisplayNames`, which the browser already carries
 *    in every locale this app ships. Hardcoding 250 names across 13 languages
 *    would be three thousand strings to translate and keep correct, for data the
 *    platform hands over for free and keeps up to date on its own.
 *  - The FLAG is the alpha-2 code rewritten as regional indicator symbols. On
 *    Windows, whose system font has no flag glyphs, `main.tsx` already installs
 *    country-flag-emoji-polyfill so they render anyway.
 *
 * The policy itself always speaks alpha-3, because that is what the proof system
 * and the on-chain policy hash use. The alpha-2 code never leaves this module.
 *
 * Table generated from `i18n-iso-countries` rather than typed by hand.
 */

/** alpha-3 => alpha-2, for every assigned ISO 3166-1 code. */
const ALPHA3_TO_ALPHA2: Record<string, string> = {
  ABW: "AW", AFG: "AF", AGO: "AO", AIA: "AI", ALA: "AX", ALB: "AL", AND: "AD",
  ARE: "AE", ARG: "AR", ARM: "AM", ASM: "AS", ATA: "AQ", ATF: "TF", ATG: "AG",
  AUS: "AU", AUT: "AT", AZE: "AZ", BDI: "BI", BEL: "BE", BEN: "BJ", BES: "BQ",
  BFA: "BF", BGD: "BD", BGR: "BG", BHR: "BH", BHS: "BS", BIH: "BA", BLM: "BL",
  BLR: "BY", BLZ: "BZ", BMU: "BM", BOL: "BO", BRA: "BR", BRB: "BB", BRN: "BN",
  BTN: "BT", BVT: "BV", BWA: "BW", CAF: "CF", CAN: "CA", CCK: "CC", CHE: "CH",
  CHL: "CL", CHN: "CN", CIV: "CI", CMR: "CM", COD: "CD", COG: "CG", COK: "CK",
  COL: "CO", COM: "KM", CPV: "CV", CRI: "CR", CUB: "CU", CUW: "CW", CXR: "CX",
  CYM: "KY", CYP: "CY", CZE: "CZ", DEU: "DE", DJI: "DJ", DMA: "DM", DNK: "DK",
  DOM: "DO", DZA: "DZ", ECU: "EC", EGY: "EG", ERI: "ER", ESH: "EH", ESP: "ES",
  EST: "EE", ETH: "ET", FIN: "FI", FJI: "FJ", FLK: "FK", FRA: "FR", FRO: "FO",
  FSM: "FM", GAB: "GA", GBR: "GB", GEO: "GE", GGY: "GG", GHA: "GH", GIB: "GI",
  GIN: "GN", GLP: "GP", GMB: "GM", GNB: "GW", GNQ: "GQ", GRC: "GR", GRD: "GD",
  GRL: "GL", GTM: "GT", GUF: "GF", GUM: "GU", GUY: "GY", HKG: "HK", HMD: "HM",
  HND: "HN", HRV: "HR", HTI: "HT", HUN: "HU", IDN: "ID", IMN: "IM", IND: "IN",
  IOT: "IO", IRL: "IE", IRN: "IR", IRQ: "IQ", ISL: "IS", ISR: "IL", ITA: "IT",
  JAM: "JM", JEY: "JE", JOR: "JO", JPN: "JP", KAZ: "KZ", KEN: "KE", KGZ: "KG",
  KHM: "KH", KIR: "KI", KNA: "KN", KOR: "KR", KWT: "KW", LAO: "LA", LBN: "LB",
  LBR: "LR", LBY: "LY", LCA: "LC", LIE: "LI", LKA: "LK", LSO: "LS", LTU: "LT",
  LUX: "LU", LVA: "LV", MAC: "MO", MAF: "MF", MAR: "MA", MCO: "MC", MDA: "MD",
  MDG: "MG", MDV: "MV", MEX: "MX", MHL: "MH", MKD: "MK", MLI: "ML", MLT: "MT",
  MMR: "MM", MNE: "ME", MNG: "MN", MNP: "MP", MOZ: "MZ", MRT: "MR", MSR: "MS",
  MTQ: "MQ", MUS: "MU", MWI: "MW", MYS: "MY", MYT: "YT", NAM: "NA", NCL: "NC",
  NER: "NE", NFK: "NF", NGA: "NG", NIC: "NI", NIU: "NU", NLD: "NL", NOR: "NO",
  NPL: "NP", NRU: "NR", NZL: "NZ", OMN: "OM", PAK: "PK", PAN: "PA", PCN: "PN",
  PER: "PE", PHL: "PH", PLW: "PW", PNG: "PG", POL: "PL", PRI: "PR", PRK: "KP",
  PRT: "PT", PRY: "PY", PSE: "PS", PYF: "PF", QAT: "QA", REU: "RE", ROU: "RO",
  RUS: "RU", RWA: "RW", SAU: "SA", SDN: "SD", SEN: "SN", SGP: "SG", SGS: "GS",
  SHN: "SH", SJM: "SJ", SLB: "SB", SLE: "SL", SLV: "SV", SMR: "SM", SOM: "SO",
  SPM: "PM", SRB: "RS", SSD: "SS", STP: "ST", SUR: "SR", SVK: "SK", SVN: "SI",
  SWE: "SE", SWZ: "SZ", SXM: "SX", SYC: "SC", SYR: "SY", TCA: "TC", TCD: "TD",
  TGO: "TG", THA: "TH", TJK: "TJ", TKL: "TK", TKM: "TM", TLS: "TL", TON: "TO",
  TTO: "TT", TUN: "TN", TUR: "TR", TUV: "TV", TWN: "TW", TZA: "TZ", UGA: "UG",
  UKR: "UA", UMI: "UM", URY: "UY", USA: "US", UZB: "UZ", VAT: "VA", VCT: "VC",
  VEN: "VE", VGB: "VG", VIR: "VI", VNM: "VN", VUT: "VU", WLF: "WF", WSM: "WS",
  XKK: "XK", YEM: "YE", ZAF: "ZA", ZMB: "ZM", ZWE: "ZW",
};

export const ALL_ALPHA3 = Object.keys(ALPHA3_TO_ALPHA2);

export function isKnownAlpha3(code: string): boolean {
  return code.toUpperCase() in ALPHA3_TO_ALPHA2;
}

/**
 * Flag emoji for an alpha-3 code, or an empty string when the code is unknown.
 *
 * Regional indicator symbols sit 0x1F1E6 above ASCII 'A', so a two-letter code
 * maps straight onto them with no lookup table.
 */
export function countryFlag(alpha3: string): string {
  const alpha2 = ALPHA3_TO_ALPHA2[alpha3.toUpperCase()];
  if (!alpha2) return "";
  return String.fromCodePoint(
    ...[...alpha2].map(letter => 0x1f1e6 + letter.charCodeAt(0) - 65),
  );
}

/**
 * A `DisplayNames` instance is not free to build and the picker asks for every
 * country on every keystroke, so one is kept per locale.
 */
const displayNamesCache = new Map<string, Intl.DisplayNames | null>();

function displayNamesFor(locale: string): Intl.DisplayNames | null {
  if (!displayNamesCache.has(locale)) {
    try {
      displayNamesCache.set(locale, new Intl.DisplayNames([locale], { type: "region" }));
    } catch {
      // An unsupported locale is not worth failing over: the code still reads.
      displayNamesCache.set(locale, null);
    }
  }
  return displayNamesCache.get(locale) ?? null;
}

/** Localised country name, falling back to the alpha-3 code itself. */
export function countryName(alpha3: string, locale: string): string {
  const code = alpha3.toUpperCase();
  const alpha2 = ALPHA3_TO_ALPHA2[code];
  if (!alpha2) return code;
  try {
    return displayNamesFor(locale)?.of(alpha2) ?? code;
  } catch {
    return code;
  }
}

export interface CountryOption {
  alpha3: string;
  name: string;
  flag: string;
}

export function countryOption(alpha3: string, locale: string): CountryOption {
  const code = alpha3.toUpperCase();
  return { alpha3: code, name: countryName(code, locale), flag: countryFlag(code) };
}

/**
 * Every country, named in `locale` and sorted by that name.
 *
 * Sorted with `localeCompare` in the same locale, so an accented name lands
 * where a reader of that language expects it rather than after Z.
 */
export function allCountries(locale: string): CountryOption[] {
  return ALL_ALPHA3
    .map(alpha3 => countryOption(alpha3, locale))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** Strips diacritics so "espana" finds "España". */
const fold = (value: string): string =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Search over the country list, matching the localised name or the alpha-3 code.
 *
 * Substring rather than prefix: someone looking for "South Korea" should find it
 * by typing "korea", and someone who happens to know the code should be able to
 * type that instead.
 */
export function searchCountries(
  query: string,
  locale: string,
  exclude: string[] = [],
): CountryOption[] {
  const excluded = new Set(exclude.map(code => code.toUpperCase()));
  const available = allCountries(locale).filter(c => !excluded.has(c.alpha3));

  const needle = fold(query.trim());
  if (!needle) return available;

  return available.filter(
    c => fold(c.name).includes(needle) || c.alpha3.toLowerCase().includes(needle),
  );
}
