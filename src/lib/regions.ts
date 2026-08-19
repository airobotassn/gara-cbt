// ISO 3166-2:KR — 17 시도. 단일 진실(single source of truth) for client-side region codes.
// Must stay set-equal with supabase/functions/_shared/regions.ts and the regions(code)
// seed in supabase/migrations/20260714000000_region_onboarding.sql
// (enforced by tests/db/regions-set-equality.mjs).

export const REGION_CODES = [
  'KR-11', // 서울특별시
  'KR-26', // 부산광역시
  'KR-27', // 대구광역시
  'KR-28', // 인천광역시
  'KR-29', // 광주광역시
  'KR-30', // 대전광역시
  'KR-31', // 울산광역시
  'KR-41', // 경기도
  'KR-42', // 강원특별자치도
  'KR-43', // 충청북도
  'KR-44', // 충청남도
  'KR-45', // 전북특별자치도
  'KR-46', // 전라남도
  'KR-47', // 경상북도
  'KR-48', // 경상남도
  'KR-49', // 제주특별자치도
  'KR-50', // 세종특별자치시
] as const;

export interface Region {
  readonly code: string;
  readonly i18nKey: string;
}

export const REGIONS: readonly Region[] = REGION_CODES.map((code) => ({
  code,
  i18nKey: `region.${code}`,
}));

export function isValidRegion(code: string): boolean {
  return (REGION_CODES as readonly string[]).includes(code);
}

// ⚠️ 여기 REGION_CODES 는 **한국 17개**뿐이다 — 관리자 화면의 시도 필터처럼 한국을 전제로 한 자리에서만 쓴다.
//    온보딩·마이페이지의 지역 선택은 전 세계를 다루므로 lib/regionCatalog.ts (지도 파일 기반)를 쓸 것.
//    그쪽이 211개국·3,504개 구역을 6개국어 이름과 함께 알고 있고, 정답지는 DB regions 테이블이다.

// Full ISO 3166-1 alpha-2 country codes (uppercase). Static array so it works in
// any runtime without relying on Intl availability for the list itself.
export const COUNTRY_CODES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR',
  'AS', 'AT', 'AU', 'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE',
  'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ',
  'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD',
  'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR',
  'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM',
  'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI',
  'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS',
  'GT', 'GU', 'GW', 'GY', 'HK', 'HM', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT',
  'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN',
  'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK',
  'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME',
  'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ',
  'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU',
  'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM',
  'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS',
  'RU', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI',
  'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV',
  'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK',
  'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA',
  'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
] as const;

/**
 * ISO 3166-1 alpha-2 → 국기 이모지. 'KR' → 🇰🇷
 * 두 글자를 지역표시기호(Regional Indicator, U+1F1E6~)로 옮기면 브라우저가 국기로 합성한다.
 * 코드가 없거나 두 글자 알파벳이 아니면 빈 문자열(호출부에서 렌더 생략).
 */
export function flagEmoji(code?: string | null): string {
  const c = (code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** 국기 파일이 실제로 있는 코드인지 O(1) 로 보기 위한 색인. 없는 코드에 <img> 를 걸면 404 + 깨진 그림이 뜬다. */
const FLAG_SET: ReadonlySet<string> = new Set(COUNTRY_CODES as readonly string[]);

/**
 * ISO 3166-1 alpha-2 → 국기 이미지 경로. 'KR' → '/flags/kr.svg'
 *
 * ⚠️ 왜 이모지(`flagEmoji`)를 안 쓰고 파일을 두나 (2026-08-18)
 *   **윈도우에 국기 글리프가 없다.** Segoe UI Emoji 에 지역표시기호 합성이 빠져 있어서
 *   크롬·엣지는 🇰🇷 대신 `KR` 두 글자를 그린다(파이어폭스만 Twemoji 를 내장해 제대로 보인다).
 *   사용자 대다수가 윈도우라 이모지로는 국기가 아예 안 보이는 것과 같다.
 *
 *   그림은 `public/flags/*.svg`(flag-icons 4x3, MIT, 249개국 · 총 2.0MB)다. 파일당 하나라
 *   **화면에 뜬 나라만 받는다** — 시상대면 3장이고 70%가 2KB 미만이다. 그 뒤론 캐시.
 *   ⚠️ 번들에 넣지 말 것. 249개를 통으로 싣는 순간 첫 진입 비용이 된다(그 규칙은 CLAUDE.md 참고).
 *
 * ⚠️ **PNG·WebP 로 되돌리지 말 것 (2026-08-18에 flagcdn w160 WebP 에서 갈아탔다).**
 *   그 파일들은 20~30px 로 그려도 흐렸는데, 원인이 크기가 아니라 **파일 자체가 이미 뭉개져
 *   있는 것**이었다(120px 로 확대해 보면 성조기 별·인도 차크라가 계단으로 깨져 있다).
 *   그래서 w160→w320→w640 으로 올려도 눈에 띄는 개선이 없었다 — 벡터만이 답이었다.
 *   덤으로 4x3 이라 `aspect-ratio:4/3` 박스에 안 잘린다(flagcdn 은 국기마다 실제 비율이라 잘렸다).
 *   ⚠️ 큰 파일 몇 개(세르비아 177KB·볼리비아 100KB — 문장이 복잡한 국기)는 SVGO 로도 1.4%밖에
 *   안 줄어든다. 이미 최적화된 파일이라 손대봐야 소용없다.
 *
 * 코드가 없거나 파일이 없는 나라면 빈 문자열 → 호출부에서 렌더 생략(빈 자리를 남기지 않는다).
 */
export function flagUrl(code?: string | null): string {
  const c = (code ?? '').trim().toUpperCase();
  if (!FLAG_SET.has(c)) return '';
  return `/flags/${c.toLowerCase()}.svg`;
}

/**
 * 국가 셀렉트가 그리는 목록 — 화면 언어로 이름을 매겨 **그 언어 기준으로 정렬**한다
 * (코드 순으로 두면 한국어 화면에서 AD·AE·AF… 로 나와 자기 나라를 찾을 수가 없다).
 * `first` 를 주면 그 나라를 맨 위로 끌어올린다 — IP 로 알아낸 접속 국가를 맨 앞에 세우는 용도이고,
 * 목록에 두 번 나오지 않도록 아래 정렬 목록에서는 빼서 돌려준다.
 */
export function countryOptions(
  lang: string,
  first?: string | null,
): { pinned: { code: string; name: string } | null; rest: { code: string; name: string }[] } {
  const named = (COUNTRY_CODES as readonly string[]).map((code) => ({ code, name: countryName(code, lang) }));
  let collator: Intl.Collator;
  try {
    collator = new Intl.Collator(lang);
  } catch {
    collator = new Intl.Collator();
  }
  const top = first ? named.find((c) => c.code === first) ?? null : null;
  const rest = named.filter((c) => c.code !== top?.code).sort((a, b) => collator.compare(a.name, b.name));
  return { pinned: top, rest };
}

export function countryName(code: string, lang: string): string {
  try {
    const dn = new Intl.DisplayNames([lang], { type: 'region' });
    return dn.of(code) ?? code;
  } catch {
    return code;
  }
}
