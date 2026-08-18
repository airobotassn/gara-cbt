// 미니게임 목록 페이지 (/games) — 예전엔 /arena 런처의 팝업(MiniGamePicker)이었으나
//   전용 페이지로 승격. 껍데기는 부모 페이지 /arena 와 동일한 규칙(연보라 배경 + 굵은 제목).
//   게임 목록은 src/lib/minigames.ts 한 곳에서만 관리(새 게임 = 그 배열에 한 줄).
//   커버 셀 스타일(.mg-shelf/.mg-cover…)은 모달 시절부터 이어진 공용, 페이지 껍데기는 .mgp 스코프.
import { Link, useNavigate } from 'react-router-dom'
import { MINIGAMES } from '../lib/minigames'
import StarField from '../components/StarField'
import { useT } from '../lib/i18n'
import '../styles/minigame.css'

export default function MiniGames() {
  const navigate = useNavigate()
  const { t } = useT()
  return (
    <div className="mgp">
      {/* 밤하늘 — /arena 와 같은 별(다크에서만). 내용은 .mgp-in 이 z-index:1 로 그 위에 선다. */}
      <StarField />
      <div className="mgp-in">
        <Link className="mgp-back" to="/arena" aria-label={t('arena.title')}>
          <span>‹</span> {t('arena.title')}
        </Link>

        <header className="mgp-head">
          <h1>
            {t('arena.bGame')}
            <b className="mgp-count">{MINIGAMES.length}</b>
          </h1>
          <p>{t('arena.bGameS')}</p>
        </header>

        <div className="mg-shelf">
          {MINIGAMES.map((g) => {
          // 제목은 사전에서 온다(데이터에 한국어를 두지 않는다) — accent 토큰만 색을 달리 준다.
          const gTitle = t(`mg.${g.id}.title`)
          const [pre, post] =
            g.accent && gTitle.includes(g.accent)
              ? [gTitle.slice(0, gTitle.indexOf(g.accent)), g.accent]
              : [gTitle, '']
          return (
            <button
              key={g.id}
              className="mg-cover"
              onClick={() => navigate(`/games/${g.id}`)}
              aria-label={gTitle}
            >
              <img className="mg-art" src={g.art} alt="" />
              <span className="mg-caption">
                <span className="mg-badge">{t(`mg.${g.id}.badge`)}</span>
                <b className="mg-name">
                  {pre}
                  {post && <i className="mg-accent">{post}</i>}
                </b>
                <span className="mg-tag">{t(`mg.${g.id}.tagline`)}</span>
                <span className="mg-play">
                  <b className="mg-play-tri" />
                  PLAY
                </span>
              </span>
            </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
