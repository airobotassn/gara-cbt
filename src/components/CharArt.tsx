// 캐릭터 그림 한 장 — 무대 · 선택 화면 · 보관함 · 남의 방이 **같은 이 컴포넌트**를 쓴다.
//
// 왜 컴포넌트로 뺐나: 그림이 아직 없다(계열 3 × 성별 2 × 레벨 7 = 42장). 화면마다 <img> 를 직접 쓰면
// 파일이 없는 자리마다 깨진 이미지 아이콘이 뜨고, 그림이 도착했을 때 고칠 곳이 네 군데가 된다.
//
// ⚠️ CSS 배경이 아니라 <img> 인 이유 = **onError 폴백**이다. background-image 는 실패를 알 수 없어
//    파일이 없으면 그냥 빈 자리가 된다(그림이 도착하기 전까지 무대에 캐릭터가 아예 안 선다).
import { useState, useSyncExternalStore } from 'react'
import {
  CHAR_FALLBACK_SRC, charArtSrc, CHAR_MIN_LEVEL,
  loadCharArt, subscribeCharArt, charArtVersion,
} from '../lib/hubCosmetics'

// 구독을 시작할 때 조회도 같이 건다 — 렌더 중에 부르면 '그리는 일'이 네트워크를 타게 된다.
//   ⚠️ 모듈 최상위에 둬야 한다(참조가 바뀌면 useSyncExternalStore 가 매 렌더 다시 구독한다).
const subscribeArt = (fn: () => void) => {
  void loadCharArt()
  return subscribeCharArt(fn)
}

export default function CharArt({
  charKey,
  level = CHAR_MIN_LEVEL,
  className,
  alt = '',
  srcOverride,
}: {
  /** 캐릭터 키(`char_a_m` 등). null·'default' 면 폴백 그림. */
  charKey: string | null | undefined
  /** 캐릭터 레벨(1~7 = ARENA 레벨). 레벨마다 그림이 다르다. */
  level?: number
  className?: string
  alt?: string
  /**
   * 그림 주소를 **직접** 준다(관리자 꾸미기 관리의 미리보기 전용).
   *
   * 왜 필요한가: 미리보기는 진짜 `/hub` 을 iframe 으로 띄우는데, 그 창은 캐릭터 표를 **뜰 때 한 번만**
   * 읽고 들고 있다(`loadCharArt`). 그래서 방금 올린 그림은 물론이고 저장까지 마친 그림도 창을 다시
   * 띄우기 전에는 안 바뀐다 — 관리자 입장에선 "올려도 미리보기가 그대로"다(2026-09-03 지적).
   * ⚠️ 창을 다시 띄우는 방식(src 교체)으로 풀지 말 것 — 크기 슬라이더를 움직이는 내내 깜빡인다.
   *    그래서 값만 흘려 넣는다.
   */
  srcOverride?: string | null
}) {
  // 관리자가 올린 캐릭터 표가 도착하면 다시 그린다. 안 구독하면 표가 와도 이미 그려진 화면은
  // 코드 경로(=없는 파일 → 폴백)인 채로 남는다. 조회는 모듈이 한 번만 한다.
  useSyncExternalStore(subscribeArt, charArtVersion, charArtVersion)
  const wanted = srcOverride
    ? srcOverride
    : charKey && charKey !== 'default' ? charArtSrc(charKey, level) : CHAR_FALLBACK_SRC
  // 실패한 경로를 **집합으로** 기억한다 — boolean 하나면 캐릭터나 레벨을 바꿨을 때
  // 새 그림도 폴백으로 시작한다(멀쩡한 파일이 있는데 안 보인다).
  const [failed, setFailed] = useState<Set<string>>(() => new Set())
  const src = failed.has(wanted) ? CHAR_FALLBACK_SRC : wanted
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      // 폴백 자체가 실패하면 더 바꿀 게 없다 — 무한 onError 루프를 막는다.
      onError={() => {
        if (wanted === CHAR_FALLBACK_SRC) return
        setFailed((prev) => (prev.has(wanted) ? prev : new Set(prev).add(wanted)))
      }}
      draggable={false}
    />
  )
}
