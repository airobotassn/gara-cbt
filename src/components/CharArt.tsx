// 캐릭터 그림 한 장 — 무대 · 선택 화면 · 보관함 · 남의 방이 **같은 이 컴포넌트**를 쓴다.
//
// 왜 컴포넌트로 뺐나: 그림이 아직 없다(계열 3 × 성별 2 × 레벨 7 = 42장). 화면마다 <img> 를 직접 쓰면
// 파일이 없는 자리마다 깨진 이미지 아이콘이 뜨고, 그림이 도착했을 때 고칠 곳이 네 군데가 된다.
//
// ⚠️ CSS 배경이 아니라 <img> 인 이유 = **onError 폴백**이다. background-image 는 실패를 알 수 없어
//    파일이 없으면 그냥 빈 자리가 된다(그림이 도착하기 전까지 무대에 캐릭터가 아예 안 선다).
import { useState } from 'react'
import { CHAR_FALLBACK_SRC, charArtSrc, CHAR_MIN_LEVEL } from '../lib/hubCosmetics'

export default function CharArt({
  charKey,
  level = CHAR_MIN_LEVEL,
  className,
  alt = '',
}: {
  /** 캐릭터 키(`char_a_m` 등). null·'default' 면 폴백 그림. */
  charKey: string | null | undefined
  /** 캐릭터 레벨(1~7 = ARENA 레벨). 레벨마다 그림이 다르다. */
  level?: number
  className?: string
  alt?: string
}) {
  const wanted = charKey && charKey !== 'default' ? charArtSrc(charKey, level) : CHAR_FALLBACK_SRC
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
