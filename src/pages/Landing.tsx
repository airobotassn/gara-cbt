import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'

// CBT 메인(랜딩) — 무료 레벨 진단 검색창 + 자격검정 CTA
// ⚠️ 임시(땜빵): 검색창은 레벨 추천(recommend-level)을 하지 않고, 무엇을 입력하든 레벨테스트로 이동만 한다.
//    보고 후 원복/변경 예정. recommend-level 함수와 i18n reco.* 문구는 그대로 남겨둠.
export default function Landing() {
  const navigate = useNavigate()
  const { isFullUser } = useAuth()
  const { t } = useT()
  const [learnSoon, setLearnSoon] = useState(false)
  const [query, setQuery] = useState('')

  // 시험 로그인이 홈으로 떨어져도 '시험 의도' 표식이 있으면 안내 화면으로 자동 이동
  useEffect(() => {
    if (isFullUser && localStorage.getItem('examIntent')) {
      localStorage.removeItem('examIntent')
      navigate('/exam/prepare', { replace: true })
    }
  }, [isFullUser, navigate])

  // 임시: 입력 내용과 무관하게 무료 레벨 진단으로 이동
  function goToTest(e: React.FormEvent) {
    e.preventDefault()
    navigate('/test/select')
  }

  return (
    <div className="lp">
      <div className="aura" />
      <h1>
        {t('landing.hero_pre')} <span className="em">{t('landing.hero_em')}</span>
        <br />
        {t('landing.hero_post')}
      </h1>

      {/* 무료 레벨 진단 — (임시) 무엇을 입력하든 레벨테스트로 이동 */}
      <form className="lp-search" onSubmit={goToTest}>
        <input
          className="lp-search-input"
          type="text"
          value={query}
          maxLength={200}
          placeholder={t('reco.placeholder')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="lp-search-btn" type="submit" aria-label={t('landing.cta_diagnose')}>
          →
        </button>
      </form>

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
