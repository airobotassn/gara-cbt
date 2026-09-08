// /daily/gallery — **개발 서버에서만 열리는 해설 그림 도감** (2026-09-08).
//
// 해설 그림이 100장을 넘어가면서 "고친 그림이 실제로 어떻게 보이나"를 확인할 자리가 없어졌다.
// /daily 는 하루에 한 장만 보여주므로, 그림 하나를 보려면 날짜를 기다리거나 ?term= 으로 번호를 찍어야 했다.
// 이 화면은 **등록된 그림 전부**를 한 화면에 늘어놓는다 — 새 그림을 그린 뒤 여기서 훑고,
// 깨진 좌표·겹친 라벨·빠진 색을 잡는다.
//
// ⚠️ **서비스에는 안 나간다.** App.tsx 가 `import.meta.env.DEV` 일 때만 이 라우트를 건다.
// ⚠️ 그림 자체는 `.dy-page` 아래 규칙으로 그려지므로 감싸는 껍데기가 필요하다(관리자 미리보기와 같은 방식).
import { useState } from 'react'
import '../styles/daily.css'
import DailyVisual, { DAILY_VISUALS } from '../components/DailyVisual'
import { TERM_THEORY } from '../lib/terms'
import { tTheory, useDailyI18n } from '../lib/dailyI18n'

// 언어를 바꿔 가며 훑는다 — **그림 속 글자가 넘치는지**는 언어마다 다르고, 그게 이 화면의 두 번째 용도다.
// ⚠️ 여기서는 앱의 언어 설정을 바꾸지 않는다(도감만 그 언어로 그린다). 앱 언어까지 바꾸면 검수하다 화면이 통째로 바뀐다.
const LANGS = ['ko', 'en', 'ja', 'zh', 'hi', 'vi'] as const

export default function DailyGallery() {
  const [q, setQ] = useState('')
  const [lang, setLang] = useState<string>('ko')
  useDailyI18n(lang)
  // 그림 키 → 그 그림을 쓰는 용어(해설). 짝이 없는 그림은 '(안 쓰임)' 으로 드러난다.
  const owner: Record<string, string> = {}
  for (const [term, t] of Object.entries(TERM_THEORY)) if (t.visual) owner[t.visual] = term
  const keys = Object.keys(DAILY_VISUALS).filter((k) => {
    const s = q.trim()
    return !s || k.includes(s) || (owner[k] ?? '').includes(s)
  })
  return (
    <div className="dy-page" style={{ padding: '20px clamp(12px, 3vw, 28px) 60px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <b style={{ fontSize: 24 }}>해설 그림 도감</b>
        <span style={{ color: 'var(--ink2)', fontSize: 14 }}>
          {keys.length} / {Object.keys(DAILY_VISUALS).length}장 · 해설 {Object.keys(TERM_THEORY).length}개 · 개발 서버 전용
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="용어·그림키 검색"
          style={{ padding: '7px 11px', borderRadius: 10, border: '2px solid var(--line)', background: 'var(--card)', color: 'var(--ink)', fontWeight: 700 }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          {LANGS.map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              style={{
                padding: '6px 11px', borderRadius: 999, fontWeight: 900, cursor: 'pointer',
                border: `2px solid ${lang === l ? 'var(--brand)' : 'var(--line)'}`,
                background: 'var(--card)', color: 'var(--ink)',
              }}
            >{l}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 16, alignItems: 'start' }}>
        {keys.map((k) => {
          const term = owner[k]
          const th = term ? tTheory(term, TERM_THEORY[term]) : undefined
          return (
            <div key={k} className="dy-th-card" style={{ marginTop: 0 }}>
              <div className="dy-th-head">
                <span className="dy-th-badge">{term ?? '(안 쓰임)'}</span>
                <b style={{ fontSize: 13, color: 'var(--ink2)' }}>{k}</b>
              </div>
              <DailyVisual name={k} />
              {th && <p className="dy-th-point">{th.point}</p>}
              {th?.why?.length ? (
                <ul className="dy-th-why">{th.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
              ) : null}
              {th?.compare && <p className="dy-th-cmp"><span>헷갈리면</span>{th.compare}</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
