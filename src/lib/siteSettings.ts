// 사이트 정보 — 관리자가 정한 값을 사용자 화면이 읽는다(푸터 사업자 정보·탭 제목·정책 문서 시행일 등).
//
// ⚠️ 관리자 화면만 만들고 여기 연결을 안 하면 "입력해도 아무것도 안 바뀌는 설정"이 된다.
// ⚠️ `site_settings` 는 공개 읽기 정책이 붙어 있어 **로그인 없이도** 읽힌다(푸터는 누구에게나 보인다).
//    쓰기는 함수(service role)만 — 관리자 화면이 `admin` 함수를 통해 저장한다.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type SiteSettings = Record<string, string>

// 한 번 읽어 모듈에 들고 있는다 — 푸터가 페이지마다 다시 마운트되는데 그때마다 조회하면 왕복이 늘어난다.
let cache: SiteSettings | null = null
let inflight: Promise<SiteSettings> | null = null

export async function loadSiteSettings(): Promise<SiteSettings> {
  if (cache) return cache
  if (inflight) return inflight
  inflight = (async () => {
    const { data } = await supabase.from('site_settings').select('key, value')
    const map: SiteSettings = {}
    for (const r of (data ?? []) as { key: string; value: string }[]) map[r.key] = r.value ?? ''
    cache = map
    inflight = null
    return map
  })()
  return inflight
}

/** 사이트 정보를 쓰는 컴포넌트용. 값이 오기 전엔 빈 객체라 화면이 깨지지 않는다. */
export function useSiteSettings(): SiteSettings {
  const [s, setS] = useState<SiteSettings>(() => cache ?? {})
  useEffect(() => {
    let alive = true
    loadSiteSettings().then((v) => { if (alive) setS(v) })
    return () => { alive = false }
  }, [])
  return s
}

/**
 * 브라우저 탭 제목·설명·파비콘을 사이트 정보대로 맞춘다. 앱에서 한 번만 부른다.
 * ⚠️ 값이 비어 있으면 **건드리지 않는다** — 빈 값으로 덮으면 index.html 의 기본값까지 지워진다.
 */
export function applySiteHead(s: SiteSettings) {
  if (s.site_name?.trim()) document.title = s.site_name.trim()
  if (s.site_desc?.trim()) {
    let m = document.querySelector('meta[name="description"]')
    if (!m) {
      m = document.createElement('meta')
      m.setAttribute('name', 'description')
      document.head.appendChild(m)
    }
    m.setAttribute('content', s.site_desc.trim())
  }
  if (s.favicon_url?.trim()) {
    let l = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!l) {
      l = document.createElement('link')
      l.rel = 'icon'
      document.head.appendChild(l)
    }
    l.href = s.favicon_url.trim()
  }
}
