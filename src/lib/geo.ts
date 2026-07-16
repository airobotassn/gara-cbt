// Client-side geolocation prefill + KR region name→ISO mapping.
// Pure mapping (regionNameToIso) is unit-tested in tests/geo-mapping.mjs (no network).
// fetchGeoPrefill is best-effort and NON-BLOCKING: any error/timeout yields nulls.
import { isValidRegion } from './regions';

// Normalized (lowercase, trimmed) KR region name/alias → ISO 3166-2:KR code.
const NAME_TO_ISO: Readonly<Record<string, string>> = {
  seoul: 'KR-11',
  busan: 'KR-26',
  daegu: 'KR-27',
  incheon: 'KR-28',
  gwangju: 'KR-29',
  daejeon: 'KR-30',
  ulsan: 'KR-31',
  gyeonggi: 'KR-41',
  'gyeonggi-do': 'KR-41',
  gangwon: 'KR-42',
  'gangwon-do': 'KR-42',
  'gangwon-do (특별자치)': 'KR-42',
  'north chungcheong': 'KR-43',
  'chungcheongbuk-do': 'KR-43',
  chungbuk: 'KR-43',
  'south chungcheong': 'KR-44',
  'chungcheongnam-do': 'KR-44',
  chungnam: 'KR-44',
  'north jeolla': 'KR-45',
  'jeollabuk-do': 'KR-45',
  jeonbuk: 'KR-45',
  'south jeolla': 'KR-46',
  'jeollanam-do': 'KR-46',
  jeonnam: 'KR-46',
  'north gyeongsang': 'KR-47',
  'gyeongsangbuk-do': 'KR-47',
  gyeongbuk: 'KR-47',
  'south gyeongsang': 'KR-48',
  'gyeongsangnam-do': 'KR-48',
  gyeongnam: 'KR-48',
  jeju: 'KR-49',
  'jeju-do': 'KR-49',
  sejong: 'KR-50',
};

/**
 * Map a KR region NAME to its ISO 3166-2:KR code.
 * If `regionCode` is already a valid KR-xx, it is returned as-is (provider passthrough).
 * Otherwise `name` is normalized (trim + lowercase) and looked up in the alias table.
 * Unknown → null.
 */
export function regionNameToIso(
  name: string | null | undefined,
  regionCode?: string | null,
): string | null {
  if (regionCode && isValidRegion(regionCode)) return regionCode;
  if (!name) return null;
  const key = name.trim().toLowerCase();
  return NAME_TO_ISO[key] ?? null;
}

interface IpWhoResponse {
  country_code?: string;
  region?: string;
  region_code?: string;
}

/**
 * Best-effort IP-based geolocation prefill via https://ipwho.is/.
 * NON-BLOCKING: any error, timeout, or malformed response returns nulls.
 */
export async function fetchGeoPrefill(): Promise<{
  country_code: string | null;
  region_code: string | null;
}> {
  const empty = { country_code: null, region_code: null };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    let data: IpWhoResponse;
    try {
      const res = await fetch('https://ipwho.is/', { signal: controller.signal });
      if (!res.ok) return empty;
      data = (await res.json()) as IpWhoResponse;
    } finally {
      clearTimeout(timer);
    }
    const country_code =
      typeof data.country_code === 'string' && data.country_code.length === 2
        ? data.country_code.toUpperCase()
        : null;
    const region_code = regionNameToIso(data.region, data.region_code);
    return { country_code, region_code };
  } catch {
    return empty;
  }
}
