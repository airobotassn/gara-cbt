import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { callFunction, isFunctionCode } from '../lib/supabase'
import SebExitButton from '../components/SebExitButton'
import { SEB_REQUIRED, isSEB } from '../lib/seb'
import { DEFAULT_EXAM_SLUG } from '../lib/testConfig'
import {
  examAuthHeaders,
  getExamToken,
  readHandoffNonce,
  setExamToken,
  stripHandoffFromUrl,
} from '../lib/examToken'
import type { StartExamResponse } from '../lib/types'
import { useT } from '../lib/i18n'

// SEB 진입점(.seb 의 startURL = /exam/seb).
//
// SEB 는 새 브라우저 프로필이라 **세션이 없고, 그 안에서 로그인할 방법도 없다**(SEB 가 외부 사이트를 막고
// 구글도 이런 브라우저를 거부한다). 그래서 일반 브라우저의 응시 준비 화면이 SEB 를 띄우기 직전에
// 일회용 인계표(nonce)를 만들어 실행 링크에 실어 보내고, 그 표가 SEB 설정(startURLAppendQueryParameter)에
// 의해 이 화면의 주소로 넘어온다. 여기서 표를 **시험 전용 토큰**으로 바꿔 응시를 시작한다.
//   · 표(nonce)  : 수 분짜리 1회용. 주소·접속 로그에 남으므로 인증수단 본체가 아니다.
//   · 토큰       : start-exam · submit-exam 만 받아주고, 표에 박힌 응시권 하나로 묶여 있다.
// 서버 쪽 설명 = supabase/functions/seb-handoff · _shared/exam-token.ts.
//
// ⚠️ 옛 코드는 여기서 ensureAnonymous() 로 익명 세션을 만들었는데, 응시권 도입 이후 start-exam 이
//    익명을 403 으로 막으면서 **SEB 경로가 통째로 죽어 있었다.** 익명으로 되돌리지 말 것.
// ⚠️ 본인인증은 여전히 별개 과제다 — 이 표를 남에게 넘기면 대리응시가 된다. 그건 본인인증이 막을 문제고,
//    여기 안내 문구가 그 자리를 잡아두고 있다.
export default function SebStart() {
  const navigate = useNavigate()
  const { t, lang } = useT()
  const [err, setErr] = useState('')
  // 진입 거절(서버 code='reentry_blocked'·'attempt_voided') — 재시도가 의미 없어 문의 안내로 바꾼다.
  const [voided, setVoided] = useState(false)
  const [starting, setStarting] = useState(false)
  const started = useRef(false)

  // 주소에서 표를 **첫 렌더에** 꺼내고 주소창에서는 지운다.
  // 표를 state 로 들고 있어야 하는 이유 = 아래에서 주소를 지운 뒤에도 '다시 시도' 를 누를 수 있어야 한다
  // (표는 서버에서 1회용이라 실제로 교환에 성공한 뒤엔 재시도해도 거절된다 — 그건 서버가 판정한다).
  const [nonce] = useState(() => readHandoffNonce(window.location.search))
  useEffect(() => {
    if (nonce) stripHandoffFromUrl()
  }, [nonce])

  // SEB 밖에서 이 URL 로 직접 들어오면 우회 방지(운영). dev 는 통과(테스트용).
  useEffect(() => {
    if (SEB_REQUIRED && !isSEB()) navigate('/exam', { replace: true })
  }, [navigate])

  async function begin() {
    if (started.current) return
    started.current = true
    setStarting(true)
    setErr('')
    try {
      // ① 표 → 토큰. 표가 아예 없으면(옛 .seb 로 들어옴·설정 누락) 여기서 끊는다 —
      //    익명 세션으로 넘어가 봐야 start-exam 이 403 을 줄 뿐이라 사용자만 헷갈린다.
      // ⚠️ **이미 교환했으면 다시 부르지 않는다.** 표는 1회용이라, 교환은 됐는데 그다음 start-exam 이
      //    실패한 경우(응시 창 안 열림 등) 재시도가 redeem 부터 다시 타면 '표가 유효하지 않다' 로 바뀌어
      //    진짜 이유를 영영 못 보게 된다.
      if (!getExamToken()) {
        if (!nonce) throw new Error(t('seb.err_no_handoff'))
        const { token } = await callFunction<{ token: string }>('seb-handoff', {
          action: 'redeem',
          nonce,
        })
        setExamToken(token)
      }

      // ② 전체화면 → 응시 시작. 응시권은 토큰에 박혀 있어 body 로 보내지 않는다(서버가 토큰 값을 쓴다).
      await document.documentElement.requestFullscreen?.().catch(() => {})
      const res = await callFunction<StartExamResponse>(
        'start-exam',
        // SEB 안에서는 화면 언어가 startURL 의 ?lang= 에서 온다(i18n detect) — 그 값이 곧 응시 언어다.
        { examSlug: DEFAULT_EXAM_SLUG, lang },
        examAuthHeaders(),
      )
      navigate(`/exam/run/${res.attemptId}`, { state: res, replace: true })
    } catch (e) {
      started.current = false
      setStarting(false)
      // 무효는 재시도로 풀리지 않는다 — 버튼을 감추고 문의 안내로 바꾼다.
      if (isFunctionCode(e, 'reentry_blocked') || isFunctionCode(e, 'attempt_voided')) setVoided(true)
      setErr(e instanceof Error ? e.message : t('prep.err_start'))
    }
  }

  return (
    <div className="exam-center">
      <div style={{ textAlign: 'center', maxWidth: 460, margin: '0 auto', padding: 24 }}>
        {err ? (
          <>
            <p className="prep-warn" style={{ marginBottom: 16 }}>{err}</p>
            {/* 재진입 무효 — 재시도해봐야 같은 답이 온다. 다시 시도 버튼 대신 문의 경로만 남긴다.
                ⚠️ 응시자 입장에서 "왜 무효인지" 가 안 보이면 문의조차 못 한다. 사유를 반드시 말해준다. */}
            {voided && (
              <p className="font-body-md text-body-md text-on-surface-variant" style={{ marginBottom: 16, lineHeight: 1.65 }}>
                {t('seb.voided_how')}
              </p>
            )}
            {/* 표도 토큰도 없으면 재시도해봐야 같은 곳에서 막힌다 — SEB 를 닫고 다시 시작하라고 말해준다.
                (토큰이 있으면 교환은 이미 끝난 것이라, 실패한 건 응시 시작 쪽이고 재시도가 의미 있다.) */}
            {voided ? null : nonce || getExamToken() ? (
              <button className="exam-btn" onClick={begin}>{t('seb.entry_retry')}</button>
            ) : (
              <p className="font-body-md text-body-md text-on-surface-variant" style={{ marginBottom: 16 }}>
                {t('seb.err_no_handoff_how')}
              </p>
            )}
            {/* ⚠️ 여기가 갇히기 가장 쉬운 자리다 — 오류가 나면 재시도 말고는 할 게 없고,
                SEB 는 뒤로가기·주소창이 없다. 나가는 버튼을 반드시 남겨둘 것. */}
            <div style={{ marginTop: 18 }}>
              <SebExitButton />
            </div>
          </>
        ) : starting ? (
          <p className="font-body-lg text-body-lg text-on-surface-variant animate-pulse">{t('seb.entry_loading')}</p>
        ) : (
          <>
            <div style={{ fontSize: 42, marginBottom: 14 }}>🪪</div>
            <h2 className="font-title-md text-title-md font-bold text-on-surface" style={{ marginBottom: 10 }}>
              [본인인증수단 개발중]
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant" style={{ marginBottom: 22, lineHeight: 1.65 }}>
              현재 본인인증 수단을 준비 중입니다.<br />
              아래 <b>확인</b>을 누르면 시험을 시작합니다.
            </p>
            <button className="exam-btn" onClick={begin}>확인</button>
            {/* 시작 전이라 나가도 잃을 게 없다 — 잘못 열었을 때 재부팅하지 않도록 길을 열어둔다. */}
            <div style={{ marginTop: 18 }}>
              <SebExitButton />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
