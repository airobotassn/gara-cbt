// IP 기반 프리필 — **국가까지만**. 지역(시도)은 뽑지 않는다.
//
// ⛔ **지역을 되살리지 말 것(2026-08-24 결정).** 위치정보법이 보는 건 "IP 를 썼냐"가 아니라
//    "그 값이 사람에 붙어 저장되느냐 · 얼마나 장소를 특정하느냐"다. 국가 단위는 장소라기보다
//    관할·언어 구분에 가깝지만, 시도(市道)부터는 "그 사람이 어디 있었나"가 된다 —
//    그걸 온보딩 폼에 미리 채우면 사용자가 그냥 확정하는 것만으로 **IP 유래 위치가 계정에 저장된다**.
//    ("사용자가 골랐다"는 형식만 남는다.) 그래서 이 파일은 지역을 만들 능력 자체를 갖지 않는다 —
//    호출부에서 안 쓰는 정도로 두면 다음 사람이 다시 배선한다.
//    · 함께 지운 것: KR 시도 이름→ISO 표(`NAME_TO_ISO`) · `regionNameToIso` · `tests/geo-mapping.mjs`.
//    · 사용자 영향: 한국 사용자가 온보딩에서 시도를 한 번 더 고른다. 해외는 원래 지역 프리필이
//      없었으므로 변화 없음(지역 목록은 `regionCatalog` 가 지도 파일에서 만든다).
//
// ⚠️ 이 조회는 **브라우저가 제3자(ipwho.is)에게 직접** 한다 — 우리 서버는 IP 를 받지도 보지도 않는다.
//    엣지 함수로 옮기지 말 것. 옮기는 순간 "우리가 위치정보를 수집한다"가 되어 성격이 바뀐다.
// ⚠️ best-effort · NON-BLOCKING: 오류·타임아웃·형식 불일치는 전부 null 이다.
//    ⛔ 못 알아냈다고 'KR' 로 떨어뜨리지 말 것 — 외국 사용자가 화면에 뜬 '대한민국'을 그대로 확정해
//       버리고, 그건 1회 변경권을 쓰지 않으면 못 되돌린다.

interface IpWhoResponse {
  country_code?: string;
}

/**
 * IP 기반 국가 프리필. 반환값은 **국가 코드 하나**이고, 쓰임새는 두 가지뿐이다:
 * 국가 셀렉트의 맨 위 정렬 · 기본 선택. 저장되는 값은 언제나 사용자가 확정한 선택이다.
 */
export async function fetchGeoPrefill(): Promise<{ country_code: string | null }> {
  const empty = { country_code: null };
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
    return { country_code };
  } catch {
    return empty;
  }
}
