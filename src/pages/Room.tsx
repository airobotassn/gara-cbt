// /room/:handle — **남의 방**(공개). 로그인 없이 열린다.
//
// 왜 공개인가: 이 화면의 목적이 "랭커 방 구경 + 채팅에서 눌러 들어가기 + SNS 링크" 라서다.
// 로그인 게이트를 걸면 SNS 에서 눌러 들어온 사람이 방 대신 로그인 화면을 본다.
//
// ⚠️ 방 그림은 /hub 와 **같은 컴포넌트(RoomView)** 다. 여기서 따로 그리면
//    내 방과 남이 보는 내 방이 갈리고, 그 차이는 배치를 바꿔봐야 드러나 제일 늦게 발견된다.
// ⚠️ 루트에 `.hub` 클래스가 필요하다 — hub.css 의 모든 선택자가 `.hub` 아래로 스코프돼 있다.
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import '../styles/hub.css'
import { callFunction } from '../lib/supabase'
import { useAuth } from '../context/AuthProvider'
import { useT } from '../lib/i18n'
import { tierName } from '../lib/caris'
import { Avatar } from '../components/GemAvatar'
import CharArt from '../components/CharArt'
import { roomUrl } from '../lib/room'
import { skinByPart } from '../lib/hubCosmetics'
import { arenaLevelForScore } from '../lib/scoring'

interface RoomResp {
  handle: string
  name: string | null
  avatarUrl: string | null
  seasonTotal: number | null
  title: string | null
  // 그 사람이 장착한 캐릭터·스킨(2026-08-20). 남의 방도 **그 사람이 꾸민 대로** 보여야 한다 —
  // 여기만 기본 그림으로 두면 공유 카드와 방이 다른 사람처럼 보인다.
  character: string | null
  skin: string | null
  error?: string
}

export default function Room() {
  const { handle = '' } = useParams()
  const { user } = useAuth()
  const { t } = useT()
  // ⚠️ 결과에 **어느 방 것인지(for)를 같이 담는다.** 주소가 바뀌었을 때 이펙트 안에서 setState 로
  //    비우면(허브 컨벤션 위반이기도 하다) 렌더가 한 번 더 돌고, 안 비우면 새 방 화면에 전 방이 잠깐 남는다.
  //    for 를 비교하면 둘 다 없이 자동으로 '로딩'으로 떨어진다.
  const [res, setRes] = useState<{ for: string; data: RoomResp | null } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    callFunction<RoomResp>('room', { action: 'view', handle })
      .then((d) => { if (alive) setRes({ for: handle, data: d }) })
      .catch(() => { if (alive) setRes({ for: handle, data: null }) })
    return () => { alive = false }
  }, [handle])

  const current = res?.for === handle ? res : null
  const data = current?.data ?? null
  const failed = !!current && !current.data

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(roomUrl(handle))
    } catch {
      const ta = document.createElement('textarea')
      ta.value = roomUrl(handle)
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const isMine = !!user?.id && user.id === handle
  // 아직 응답을 못 받았으면 기본 스킨으로 그린다(skinByPart 가 모르는 값·null 을 기본으로 떨어뜨린다).
  const skin = skinByPart(data?.skin ?? null)
  const name = data?.name || t('room.someone')
  const badge = data?.title ? <span className="tt">🏆 CARIS {tierName(data.title)}</span> : null

  return (
    <div className="hub" data-skin={skin.key} data-ui={skin.ui}>
      {/* 무대 = 그 사람의 배경 + 그 사람의 캐릭터. /hub 와 **같은 마크업·같은 CSS** 다 —
          내 허브와 남이 보는 내 방이 갈리면 배치를 바꿔봐야 드러나 제일 늦게 발견된다.
          ⚠️ `.hub-scene` 은 `.hub > *:not(...)` 예외 목록에 있어야 viewport 고정이 풀리지 않는다. */}
      <div className="hub-scene" aria-hidden="true">
        <div className="hub-scene-bg" />
        <div className="hub-scene-char">
          {/* 레벨은 시즌 총점에서 파생한다 — 허브가 자기 화면에 쓰는 것과 같은 함수라
              내 허브와 남이 보는 내 방의 캐릭터가 어긋나지 않는다. */}
          <CharArt charKey={data?.character ?? null} level={arenaLevelForScore(data?.seasonTotal ?? 0)} className="hub-scene-char-img" />
        </div>
      </div>

      <div className="hub-backrow">
        {/* 들어온 길이 랭킹일 수도 채팅일 수도 SNS 일 수도 있다 — 어디서 왔든 말이 되는 곳(아레나)으로 보낸다. */}
        <Link className="hub-back" to="/arena"><span className="material-symbols-outlined">arrow_back</span>WORLD ARENA</Link>
        <div className="hub-backrow-act">
          <button className="hub-share" onClick={copyLink}>{t(copied ? 'room.copied' : 'room.copy')}</button>
        </div>
      </div>

      <div className="home">
        <div className="hud">
          <div className="hud-av">
            <div className="av"><Avatar avatarUrl={data?.avatarUrl ?? null} seed={handle} size={44} /></div>
          </div>
          <div className="hud-mid">
            <div className="hud-name">{name} {badge}</div>
            <div className="hud-xp">
              <span className="gchip">
                <span className="num">
                  {data?.seasonTotal != null ? t('room.season_pt', { n: data.seasonTotal.toLocaleString() }) : '—'}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* 무대는 배경 레이어(.hub-scene)가 화면 전체에 이미 그리고 있다 — 여기는 그 위 빈 자리다.
            ⚠️ 옛 미니룸 상자(RoomView: CSS 벽·바닥 + 가구 + 옛 로봇)는 2026-08-20 제거됐다.
               배경이 사진 한 장이 된 뒤로 그 상자가 새 배경 위에 회색 사각형으로 겹쳐 떠 있었다. */}
        <div className="stage-zone">
          {!data && (
            <p className="rmpick-empty" style={{ paddingTop: 40 }}>
              {failed ? t('room.not_found') : t('common.loading')}
            </p>
          )}
        </div>

        <div className="dock">
          <Link className="cta-main" to="/hub">{t(isMine ? 'room.my_room_edit' : 'room.my_room')}</Link>
        </div>
      </div>
    </div>
  )
}
