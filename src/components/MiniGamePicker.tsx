// 미니게임 선택 팝업 — 표지형 커버를 눌러 /games/:id 로 들어간다.
//   원래 /hub 의 모달이었으나 미니게임 진입점이 /arena 하단 런처로 옮겨가면서 분리했다.
//   게임 목록은 src/lib/minigames.ts 한 곳에서만 관리(새 게임 = 그 배열에 한 줄).
import { useNavigate } from 'react-router-dom'
import { MINIGAMES } from '../lib/minigames'
import '../styles/minigame.css'

export function MiniGamePicker({ title, onClose }: { title: string; onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="mgm-backdrop" onClick={onClose}>
      <div className="mgm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mgm-head">
          <h3>{title}</h3>
          <button className="mgm-close" onClick={onClose} aria-label="close">
            ×
          </button>
        </div>
        <div className="mg-shelf">
          {MINIGAMES.map((g) => {
            // 제목 중 accent 토큰(예: 'CARI')만 색을 달리 준다.
            const [pre, post] =
              g.accent && g.title.includes(g.accent)
                ? [g.title.slice(0, g.title.indexOf(g.accent)), g.accent]
                : [g.title, '']
            return (
              <button
                key={g.id}
                className="mg-cover"
                onClick={() => {
                  onClose()
                  navigate(`/games/${g.id}`)
                }}
                aria-label={g.title}
              >
                <img className="mg-art" src={g.art} alt="" />
                <span className="mg-caption">
                  <span className="mg-badge">{g.badge}</span>
                  <b className="mg-name">
                    {pre}
                    {post && <i className="mg-accent">{post}</i>}
                  </b>
                  <span className="mg-tag">{g.tagline}</span>
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
