import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { callFunction } from '../lib/supabase'

type RecommendLevelResponse = {
  level: number | null
  alt: number | null
  lowConfidence?: boolean
}

// 레벨별 응시자 분포(대략) → 고레벨부터 누적해 '세계 상위 %' 구간을 만든다.
const LEVEL_DIST: Record<number, number> = { 1: 184, 2: 172, 3: 241, 4: 230, 5: 150, 6: 90, 7: 33 }
function topPercentBand(level: number): { lo: number; hi: number } {
  const total = Object.values(LEVEL_DIST).reduce((a, b) => a + b, 0)
  let above = 0
  for (let l = 7; l > level; l--) above += LEVEL_DIST[l] ?? 0
  const within = LEVEL_DIST[level] ?? 0
  const lo = Math.max(1, Math.round((above / total) * 100))
  const hi = Math.round(((above + within) / total) * 100)
  return { lo, hi }
}
function levelFromTopPercent(p: number): number {
  const clamped = Math.min(100, Math.max(1, Math.round(p)))
  for (let l = 7; l >= 1; l--) {
    if (clamped <= topPercentBand(l).hi) return l
  }
  return 1
}
// '상위 N%'(숫자+ % / 퍼 / 프로 / percent) 파싱. 없으면 null. 숫자 구간이라 AI 없이 결정적 처리.
function parseTopPercent(s: string): number | null {
  const tt = s.trim()
  const m =
    tt.match(/(\d{1,3})\s*(?:%|％|퍼센트|퍼|프로|percent|pct)/i) ??
    (/^\d{1,3}$/.test(tt) ? ([tt, tt] as unknown as RegExpMatchArray) : null)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= 100 ? n : null
}

// CBT 메인(랜딩) — 무료 레벨 진단 검색창 + 자격검정 CTA
export default function Landing() {
  const navigate = useNavigate()
  const { isFullUser } = useAuth()
  const { t } = useT()
  const [learnSoon, setLearnSoon] = useState(false)

  // 검색어 → (레벨 추천) → '세계 상위 %' 구간
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState<string | null>(null)
  const [band, setBand] = useState<{ lo: number; hi: number } | null>(null)

  // 시험 로그인이 홈으로 떨어져도 '시험 의도' 표식이 있으면 안내 화면으로 자동 이동
  useEffect(() => {
    if (isFullUser && localStorage.getItem('examIntent')) {
      localStorage.removeItem('examIntent')
      navigate('/exam/prepare', { replace: true })
    }
  }, [isFullUser, navigate])

  async function recommend(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q || searching) return
    setSearchErr(null)

    // '상위 90%', '5프로' 같은 숫자 퍼센트는 AI/캐시 없이 바로 구간 매핑(결정적·무료).
    const pct = parseTopPercent(q)
    if (pct != null) {
      setBand(topPercentBand(levelFromTopPercent(pct)))
      return
    }

    setSearching(true)
    try {
      const res = await callFunction<RecommendLevelResponse>('recommend-level', { query: q })
      if (res.level == null || res.lowConfidence) {
        setBand(null)
        setSearchErr(t('reco.unclear'))
      } else {
        setBand(topPercentBand(res.level))
      }
    } catch {
      setSearchErr(t('reco.error'))
      setBand(null)
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="lp">
      <div className="aura" />
      <h1>
        {t('landing.hero_pre')} <span className="em">{t('landing.hero_em')}</span>
        <br />
        {t('landing.hero_post')}
      </h1>

      {/* 무료 레벨 진단 — 검색어로 '세계 상위 %' 가늠 */}
      <form className="lp-search" onSubmit={recommend}>
        <input
          className="lp-search-input"
          type="text"
          value={query}
          maxLength={200}
          placeholder={t('reco.placeholder')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="lp-search-btn"
          type="submit"
          disabled={searching || query.trim().length === 0}
        >
          {searching ? t('reco.loading') : t('reco.button')}
        </button>
      </form>
      {searchErr ? <div className="lp-search-err">{searchErr}</div> : null}
      {band ? (
        <div className="lp-reco">
          ✨ {t('reco.pct_range', { lo: band.lo, hi: band.hi })}
          <div className="lp-reco-sub">{t('landing.lead')}</div>
        </div>
      ) : null}

      <div className="lp-ctas">
        <button className="cta-ghost" onClick={() => navigate('/test/select')}>
          {t('landing.cta_diagnose')} <span className="arr">→</span>
        </button>
        <button className="cta" onClick={() => navigate('/exam')}>
          {t('landing.cta_exam')} <span className="arr">→</span>
        </button>
        <button className="cta-ghost soon" onClick={() => setLearnSoon(true)}>
          {t('landing.cta_learn')} <span className="cta-soon-tag">{t('landing.soon')}</span>
        </button>
      </div>
      {learnSoon ? <div className="lp-soon-note">{t('landing.learn_soon')}</div> : null}
    </div>
  )
}
