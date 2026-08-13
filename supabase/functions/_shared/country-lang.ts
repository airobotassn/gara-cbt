// 국가 → 번역 대상 언어.
//
//  ⚠️ 계정에 '번역 언어' 컬럼을 따로 두지 않는 게 이 파일의 존재 이유다.
//     번역 언어를 요청 파라미터나 자유 설정값으로 두면 한 사람이 언어를 바꿔가며
//     (방 × 언어) 조합을 무한히 만들 수 있다 — 캐시가 한 번도 안 맞아서 비용이 폭발하는
//     **유일한** 경로다. 국가는 온보딩에서 정하고 이미 1회만 바꿀 수 있게 잠겨 있으므로
//     (profiles.region_changed_at), 언어를 국가에서 파생시키면 그 잠금을 그대로 물려받는다.
//
//  ⚠️ 화면 언어(i18n 6개국어)와는 **다른 축**이다. 화면은 한국어인데 번역은 스페인어일 수 있고,
//     여기엔 전 세계 언어가 들어온다.
//
//  한 나라에 공용어가 여럿인 경우(스위스·캐나다·인도 …)는 **가장 널리 쓰이는 하나**로 접는다.
//  나라 단위보다 잘게 나누려면 사용자가 직접 고르게 해야 하는데, 그 순간 위의 잠금이 풀린다.
//  목록에 없는 나라는 영어로 떨어뜨린다 — 틀려도 대부분 읽히는 쪽이다.

const COUNTRY_LANG: Record<string, string> = {
  // 동아시아
  KR: 'ko', KP: 'ko',
  JP: 'ja',
  CN: 'zh-Hans', SG: 'zh-Hans',
  TW: 'zh-Hant', HK: 'zh-Hant', MO: 'zh-Hant',
  MN: 'mn',

  // 동남아시아
  VN: 'vi', TH: 'th', ID: 'id', MY: 'ms', BN: 'ms',
  PH: 'fil', KH: 'km', LA: 'lo', MM: 'my', TL: 'pt',

  // 남아시아
  IN: 'hi', NP: 'ne', BD: 'bn', PK: 'ur', LK: 'si', BT: 'dz', MV: 'dv', AF: 'ps',

  // 중동·북아프리카 (아랍어권)
  SA: 'ar', AE: 'ar', EG: 'ar', IQ: 'ar', JO: 'ar', KW: 'ar', LB: 'ar',
  LY: 'ar', MA: 'ar', OM: 'ar', PS: 'ar', QA: 'ar', SD: 'ar', SY: 'ar',
  TN: 'ar', YE: 'ar', BH: 'ar', DZ: 'ar', MR: 'ar', EH: 'ar', KM: 'ar', DJ: 'ar',
  IR: 'fa', IL: 'he', TR: 'tr',

  // 유럽 — 서/남
  ES: 'es', PT: 'pt-pt', FR: 'fr', IT: 'it', DE: 'de', AT: 'de',
  CH: 'de', LI: 'de', LU: 'fr', MC: 'fr', AD: 'ca', SM: 'it', VA: 'it',
  NL: 'nl', BE: 'nl', GR: 'el', CY: 'el', MT: 'mt',

  // 유럽 — 북
  SE: 'sv', NO: 'nb', DK: 'da', FI: 'fi', IS: 'is',
  FO: 'fo', AX: 'sv', SJ: 'nb', GL: 'da',

  // 유럽 — 중/동
  PL: 'pl', CZ: 'cs', SK: 'sk', HU: 'hu', RO: 'ro', MD: 'ro',
  BG: 'bg', HR: 'hr', SI: 'sl', RS: 'sr-Cyrl', ME: 'sr-Latn',
  BA: 'bs', MK: 'mk', AL: 'sq', XK: 'sq',
  RU: 'ru', UA: 'uk', BY: 'be', LT: 'lt', LV: 'lv', EE: 'et',
  GE: 'ka', AM: 'hy', AZ: 'az', KZ: 'kk', KG: 'ky', UZ: 'uz', TJ: 'tg', TM: 'tk',

  // 중남미 (스페인어권)
  MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', VE: 'es', EC: 'es',
  GT: 'es', CU: 'es', BO: 'es', DO: 'es', HN: 'es', PY: 'es', SV: 'es',
  NI: 'es', CR: 'es', PA: 'es', UY: 'es', PR: 'es', GQ: 'es',
  BR: 'pt', AO: 'pt', MZ: 'pt', CV: 'pt', GW: 'pt', ST: 'pt',
  HT: 'ht', SR: 'nl', AW: 'nl', CW: 'nl', SX: 'nl', BQ: 'nl',
  GF: 'fr', GP: 'fr', MQ: 'fr', BL: 'fr', MF: 'fr', PM: 'fr',

  // 아프리카 (프랑스어권)
  SN: 'fr', CI: 'fr', ML: 'fr', BF: 'fr', NE: 'fr', TD: 'fr', CF: 'fr',
  CG: 'fr', CD: 'fr', GA: 'fr', CM: 'fr', BJ: 'fr', TG: 'fr', GN: 'fr',
  BI: 'fr', RW: 'rw', MG: 'mg', RE: 'fr', YT: 'fr', NC: 'fr', PF: 'fr', WF: 'fr',

  // 아프리카 (기타)
  ET: 'am', ER: 'ti', SO: 'so', KE: 'sw', TZ: 'sw', UG: 'sw',
  ZA: 'af', ZW: 'sn', MW: 'ny', ZM: 'ny', MU: 'fr', SC: 'fr',
  NG: 'ha', GH: 'en', LR: 'en', SL: 'en', GM: 'en', BW: 'tn', LS: 'st', SZ: 'en',
  NA: 'af', SS: 'en',
}

/**
 * 국가코드(ISO2) → 번역 대상 언어. 모르는 나라는 영어.
 * 국가가 아예 없으면 null 을 돌려준다 — 호출부가 온보딩으로 유도해야 한다.
 */
export function langForCountry(country: string | null | undefined): string | null {
  const c = (country ?? '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return null
  return COUNTRY_LANG[c] ?? 'en'
}

/**
 * 같은 언어인지 — 지역 변종(zh-Hans / zh-Hant, pt / pt-pt)까지 구분해서 본다.
 * 원문 언어 == 독자 언어면 번역하지 않으므로 이 판정이 곧 비용이다.
 *   · 'zh-Hans' 와 'zh-Hant' 는 **다르다**(간체 ↔ 번체는 번역해야 읽힌다)
 *   · 감지가 'zh' 처럼 뭉뚱그려 오면 접두어가 같으므로 같은 언어로 본다
 *     — 어느 쪽인지 모르는 채 번역하면 절반은 헛돈이다.
 */
export function sameLang(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? '').trim().toLowerCase()
  const y = (b ?? '').trim().toLowerCase()
  if (!x || !y) return false
  if (x === y) return true
  const [xb] = x.split('-')
  const [yb] = y.split('-')
  // 한쪽이 지역 없이 왔을 때만 접두어 비교를 허용한다(zh vs zh-Hans → 같다고 본다).
  if (x === xb || y === yb) return xb === yb
  return false
}
