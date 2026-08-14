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
import RoomView from '../components/RoomView'
import { roomUrl, type RoomSlot, type RoomSlots } from '../lib/room'

interface RoomResp {
  handle: string
  name: string | null
  avatarUrl: string | null
  seasonTotal: number | null
  title: string | null
  slots: RoomSlots
  layout: RoomSlot[]
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
  const name = data?.name || t('room.someone')
  const badge = data?.title ? <span className="tt">🏆 CARIS {tierName(data.title)}</span> : null
  const empty = !!data && Object.keys(data.slots ?? {}).length === 0

  return (
    <div className="hub">
      <div className="hub-backrow">
        {/* 들어온 길이 랭킹일 수도 채팅일 수도 SNS 일 수도 있다 — 어디서 왔든 말이 되는 곳(아레나)으로 보낸다. */}
        <Link className="hub-back" to="/arena"><span className="ic">←</span>WORLD ARENA</Link>
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

        <div className="stage-zone">
          {data ? (
            <RoomView layout={data.layout} slots={data.slots} name={name} badge={badge} />
          ) : (
            <p className="rmpick-empty" style={{ paddingTop: 40 }}>
              {failed ? t('room.not_found') : t('common.loading')}
            </p>
          )}
        </div>

        {/* 빈 방 안내는 방 **아래**에 둔다 — 방 위에 겹치면 남의 방을 가린다. */}
        {empty && <p className="rmpick-empty">{t('room.empty')}</p>}

        <div className="dock">
          <Link className="cta-main" to="/hub">{t(isMine ? 'room.my_room_edit' : 'room.my_room')}</Link>
        </div>
      </div>
    </div>
  )
}
