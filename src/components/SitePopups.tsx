// 관리자가 등록한 팝업을 사용자 화면에 띄운다(홈페이지 관리 > 팝업 관리).
//
// ⛔ **응시 화면에는 절대 뜨지 않는다.** 설정으로 켤 수 있게 두지도 않는다 —
//    SEB 잠금 화면에서 팝업을 닫으려다 화면을 벗어나면 그 응시가 무효 처리된다.
//    그래서 라우트로 하드코딩해 막는다(데이터가 아니라 코드가 지킨다).
// ⚠️ 노출 기간·활성 여부는 DB 정책이 이미 거른다(popups 읽기 정책) — 여기선 기기·위치만 본다.
// ⚠️ "오늘 하루 안 보기" 가 없으면 매번 떠서 금방 미움받는다. localStorage 에 날짜로 남긴다.
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isMobileDevice } from '../lib/device'

interface PopupRow {
  id: string
  title: string
  body: string
  image_url: string | null
  link_url: string | null
  device: 'pc' | 'mobile' | 'both'
  placements: string[]
  sort_order: number
}

/** 지금 주소가 어느 자리인지 — 관리자가 팝업마다 고른 값과 맞춘다. */
function placementOf(pathname: string): string | null {
  // ⛔ 응시·준비·SEB·**시험환경 테스트** 화면은 아무 팝업도 받지 않는다.
  //    환경 테스트는 모의 응시로 이어지고(운영에서는 SEB 가 켜진다) 그 앞에 팝업이 끼면
  //    "환경이 이상한가?" 로 읽혀 점검 자체를 방해한다.
  if (/^\/exam\/(run|prepare|seb|check)/.test(pathname)) return null
  if (pathname === '/' ) return 'main'
  if (pathname.startsWith('/exam') || pathname.startsWith('/certificate') || pathname.startsWith('/plan') || pathname.startsWith('/guide')) return 'caris'
  if (pathname.startsWith('/arena') || pathname.startsWith('/test') || pathname.startsWith('/hub') || pathname.startsWith('/games') || pathname.startsWith('/ranking') || pathname.startsWith('/daily')) return 'arena'
  if (pathname.startsWith('/ebooks')) return 'library'
  return null
}

const HIDE_KEY = 'gara_popup_hide_v1'
const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
function hiddenToday(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDE_KEY) ?? '{}') as Record<string, string>
    const today = todayKst()
    return new Set(Object.entries(raw).filter(([, d]) => d === today).map(([id]) => id))
  } catch { return new Set() }
}
function hideToday(id: string) {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDE_KEY) ?? '{}') as Record<string, string>
    raw[id] = todayKst()
    localStorage.setItem(HIDE_KEY, JSON.stringify(raw))
  } catch { /* 저장 실패해도 닫히기만 하면 된다 */ }
}

export default function SitePopups() {
  const { pathname } = useLocation()
  const place = placementOf(pathname)
  const [rows, setRows] = useState<PopupRow[]>([])
  const [closed, setClosed] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!place) return
    let alive = true
    supabase
      .from('popups')
      .select('id, title, body, image_url, link_url, device, placements, sort_order')
      .order('sort_order')
      .then(({ data }) => { if (alive) setRows((data ?? []) as PopupRow[]) })
    return () => { alive = false }
  }, [place])

  if (!place) return null
  const mobile = isMobileDevice()
  const hidden = hiddenToday()
  const show = rows.filter((p) =>
    (p.placements ?? []).includes(place) &&
    (p.device === 'both' || (p.device === 'mobile' ? mobile : !mobile)) &&
    !hidden.has(p.id) && !closed.has(p.id))
  if (!show.length) return null

  const close = (id: string, forToday: boolean) => {
    if (forToday) hideToday(id)
    setClosed((s) => new Set(s).add(id))
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', pointerEvents: 'none' }}>
        {show.map((p) => (
          <div
            key={p.id}
            style={{
              pointerEvents: 'auto', width: 'min(420px, 92vw)', maxHeight: '84vh', overflow: 'auto',
              background: 'var(--bg, #fff)', color: 'var(--ink, #111)',
              border: '1px solid var(--line2, rgba(128,128,128,.3))', borderRadius: 16,
              boxShadow: '0 20px 60px -20px rgba(0,0,0,.6)',
            }}
          >
            {p.image_url && (
              p.link_url
                ? <a href={p.link_url} target="_blank" rel="noreferrer"><img src={p.image_url} alt="" style={{ width: '100%', display: 'block', borderRadius: '16px 16px 0 0' }} /></a>
                : <img src={p.image_url} alt="" style={{ width: '100%', display: 'block', borderRadius: '16px 16px 0 0' }} />
            )}
            <div style={{ padding: '18px 20px' }}>
              <b style={{ display: 'block', fontSize: 17, marginBottom: 8 }}>{p.title}</b>
              {p.body && <div style={{ fontSize: 14, lineHeight: 1.75, whiteSpace: 'pre-wrap', opacity: 0.85 }}>{p.body}</div>}
              {p.link_url && (
                <a href={p.link_url} target="_blank" rel="noreferrer"
                  style={{ display: 'inline-block', marginTop: 12, fontSize: 14, fontWeight: 700, color: 'var(--blue, #3f7bd6)' }}>
                  자세히 보기 →
                </a>
              )}
            </div>
            <div style={{ display: 'flex', borderTop: '1px solid var(--line2, rgba(128,128,128,.3))' }}>
              <button onClick={() => close(p.id, true)} style={popupBtn}>오늘 하루 안 보기</button>
              <button onClick={() => close(p.id, false)} style={{ ...popupBtn, borderLeft: '1px solid var(--line2, rgba(128,128,128,.3))', fontWeight: 700 }}>닫기</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const popupBtn: React.CSSProperties = {
  flex: 1, padding: '13px 10px', background: 'none', border: 'none',
  color: 'inherit', fontSize: 14, cursor: 'pointer',
}
