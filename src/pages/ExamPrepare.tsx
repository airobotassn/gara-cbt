import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { isMobileDevice } from '../lib/device'
import MobileBlock from '../components/MobileBlock'
import HomeLink from '../components/HomeLink'
import {
  SEB_REQUIRED,
  isSEB,
  sebConfigured,
  sebLaunchUrl,
  sebPracticeLaunchUrl,
  SEB_INSTALLER_URL,
} from '../lib/seb'
import { makePracticeExam } from '../lib/practice'
import {
  DEFAULT_EXAM_SLUG,
  TOTAL_QUESTIONS,
  TEST_DURATION_MINUTES,
  RESULT_RELEASE_DAYS,
} from '../lib/testConfig'
import type { StartExamResponse } from '../lib/types'

const STEPS = ['안내사항', '유의사항', '보안 프로그램 설치', '메뉴 설명', '문제풀이 연습', '시험 준비 완료']

// 국가공인 CBT 형태의 응시 전 단계 플로우 (창을 하나씩 넘기며 진행)
export default function ExamPrepare() {
  const navigate = useNavigate()
  const { isFullUser, loginWithGoogle } = useAuth()
  const [step, setStep] = useState(0)
  const [agree, setAgree] = useState(false)
  const [practice, setPractice] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)
  const [err, setErr] = useState('')

  if (isMobileDevice()) return <MobileBlock />

  const inSeb = isSEB()
  const checks = [
    { ok: !isMobileDevice(), label: 'PC(데스크톱) 환경' },
    { ok: window.innerWidth >= 1024, label: '화면 크기 (가로 1024px 이상)' },
    { ok: !!document.fullscreenEnabled, label: '전체화면 지원' },
    { ok: navigator.onLine, label: '인터넷 연결' },
  ]

  function startPractice() {
    if (SEB_REQUIRED && !isSEB()) {
      window.location.href = sebPracticeLaunchUrl()
      return
    }
    navigate('/exam/run/practice', { state: makePracticeExam() })
  }

  async function startExam() {
    if (!isFullUser) {
      loginWithGoogle()
      return
    }
    if (!agree || starting) return
    setErr('')

    // 보안 브라우저가 필요한데 일반 브라우저면 → SEB 로 시험 열기
    if (SEB_REQUIRED && !inSeb) {
      if (!sebConfigured()) {
        setErr('보안 브라우저 설정이 아직 준비되지 않았습니다. 관리자에게 문의해 주세요.')
        return
      }
      window.location.href = sebLaunchUrl()
      return
    }

    setStarting(true)
    try {
      try {
        await document.documentElement.requestFullscreen?.()
      } catch {
        /* 무시 */
      }
      const res = await callFunction<StartExamResponse>('start-exam', {
        examSlug: DEFAULT_EXAM_SLUG,
      })
      navigate(`/exam/run/${res.attemptId}`, { state: res })
    } catch (e) {
      setStarting(false)
      setErr(e instanceof Error ? e.message : '시험을 시작할 수 없습니다.')
    }
  }

  const last = step === STEPS.length - 1

  return (
    <div className="exam-center">
      <HomeLink />
      <div className="prep">
        <ol className="prep-steps">
          {STEPS.map((s, i) => (
            <li key={s} className={`${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`}>
              <span className="prep-no">{i < step ? '✓' : i + 1}</span>
              <span className="prep-label">{s}</span>
            </li>
          ))}
        </ol>

        <div className="prep-body">
          <h2 className="prep-title">{STEPS[step]}</h2>

          {/* 0. 안내사항 */}
          {step === 0 && (
            <div className="prep-text">
              <p>GARA 자격검정(CBT) 응시 화면입니다. 아래 안내를 끝까지 확인해 주세요.</p>
              <ul>
                <li>총 <b>{TOTAL_QUESTIONS}문항</b>, 제한시간 <b>{TEST_DURATION_MINUTES}분</b>, 4지선다 객관식입니다.</li>
                <li>제한시간이 끝나면 <b>자동으로 제출</b>됩니다.</li>
                <li>채점 결과는 제출 <b>{RESULT_RELEASE_DAYS}일 후</b> 공개됩니다.</li>
                <li>본 시험은 <b>PC(데스크톱/노트북) 전용</b>입니다.</li>
              </ul>
            </div>
          )}

          {/* 1. 유의사항 */}
          {step === 1 && (
            <div className="prep-text">
              <p>다음 유의사항을 반드시 지켜주세요. 위반 시 채점에서 불이익을 받을 수 있습니다.</p>
              <ul>
                <li>화면 <b>캡처·복사·우클릭</b> 및 개발자도구는 차단됩니다.</li>
                <li>다른 창·탭으로 <b>이탈</b>하면 화면이 가려지고 <b>횟수가 기록</b>됩니다.</li>
                <li>안 푼 문항이 있으면 <b>제출되지 않으며</b>, 미응답 문항으로 이동합니다.</li>
                <li><b>모니터는 1대만</b> 권장하며, 보안 브라우저가 추가 화면을 가립니다.</li>
                <li>부정행위가 확인되면 응시가 무효 처리될 수 있습니다.</li>
              </ul>
            </div>
          )}

          {/* 2. 보안 프로그램 설치 */}
          {step === 2 && (
            <div className="prep-text">
              {inSeb ? (
                <div className="prep-seb-ok">
                  ✅ <b>보안 브라우저로 실행 중</b>입니다. 다음으로 진행하세요.
                </div>
              ) : (
                <>
                  <p>
                    시험은 화면 캡처·복사·다른 프로그램을 차단하는 <b>보안 시험 프로그램(Safe Exam Browser)</b>에서
                    진행됩니다. 스위스 취리히공대(ETH)가 만든 공식 프로그램으로 전 세계 대학·시험기관이 사용합니다.
                  </p>
                  <a
                    className="exam-btn"
                    href={SEB_INSTALLER_URL}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'inline-block', margin: '6px 0' }}
                  >
                    보안 프로그램(SEB) 설치하기
                  </a>
                  <ul>
                    <li>설치 시 Windows에 <b>“게시자: ETH Zürich”</b> 로 표시되면 정상입니다.</li>
                    <li>“Windows가 PC를 보호했습니다” → <b>추가 정보 → 실행</b> (정상 과정).</li>
                    <li>설치 후 마지막 단계의 <b>「시험 시작」</b>을 누르면 보안 브라우저로 열립니다.</li>
                  </ul>
                </>
              )}
            </div>
          )}

          {/* 3. 메뉴 설명 */}
          {step === 3 && (
            <div className="prep-text">
              <p>시험 화면 구성은 다음과 같습니다.</p>
              <ul>
                <li><b>왼쪽</b>: 문제와 보기. 상단에 경과시간·글자크기·스크랩 버튼.</li>
                <li><b>오른쪽</b>: <b>답안지</b>(번호별 1~4 선택), <b>문제풀이 현황</b>(전체 보기), <b>캔버스</b>(메모).</li>
                <li>답은 <b>보기를 클릭</b>하거나 <b>답안지의 번호를 클릭</b>해 선택합니다.</li>
                <li><b>스크랩</b>한 문항은 현황에서 ★로 표시됩니다.</li>
                <li>아래쪽 <b>이전 / 제출 / 다음</b>으로 이동·제출합니다.</li>
              </ul>
            </div>
          )}

          {/* 4. 문제풀이 연습 + 환경 점검 */}
          {step === 4 && (
            <div className="prep-practice">
              <h4 className="prep-sub">응시 환경 자동 점검</h4>
              <ul className="check-list" style={{ marginBottom: 18 }}>
                {checks.map((c) => (
                  <li key={c.label} className={c.ok ? 'ok' : 'no'}>
                    <span className="ic">{c.ok ? '✓' : '✕'}</span>
                    <span className="lab">{c.label}</span>
                    <span className="note">{c.ok ? '정상' : '확인 필요'}</span>
                  </li>
                ))}
                <li className={inSeb ? 'ok' : 'info'}>
                  <span className="ic">{inSeb ? '✓' : 'ℹ'}</span>
                  <span className="lab">보안 브라우저(SEB)</span>
                  <span className="note">{inSeb ? '실행 중' : '실제 시험은 보안 브라우저로 시작됩니다'}</span>
                </li>
              </ul>

              <h4 className="prep-sub">모의 문제</h4>
              <p className="prep-note">아래 보기를 클릭해 답 선택을 연습해 보세요. (채점되지 않습니다)</p>
              <div className="prep-sample">
                <div className="prep-sample-q">
                  <span className="prep-sample-no">예시</span>
                  다음 중 GARA 자격검정 응시 방법으로 올바른 것은?
                </div>
                <div className="cbt-opts">
                  {[
                    '보기를 클릭하거나 답안지 번호를 눌러 답을 고른다',
                    '휴대폰으로 응시한다',
                    '화면을 캡처해 저장한다',
                    '다른 탭을 열어 검색한다',
                  ].map((opt, i) => (
                    <button
                      key={i}
                      className={`cbt-opt ${practice === i ? 'sel' : ''}`}
                      onClick={() => setPractice(i)}
                    >
                      <span className="cbt-opt-no">{i + 1}</span>
                      <span className="cbt-opt-lab">{opt}</span>
                    </button>
                  ))}
                </div>
                {practice !== null && (
                  <div className={`prep-sample-fb ${practice === 0 ? 'ok' : 'no'}`}>
                    {practice === 0 ? '정답입니다! 실제 시험도 이렇게 답을 선택합니다.' : '연습이니 괜찮아요. 1번이 올바른 방법입니다.'}
                  </div>
                )}
              </div>
              <button className="exam-btn-ghost sm" style={{ marginTop: 14 }} onClick={startPractice}>
                보안 브라우저로 모의 1문제 풀어보기 →
              </button>
            </div>
          )}

          {/* 5. 시험 준비 완료 */}
          {step === 5 && (
            <div className="prep-text">
              <p>모든 안내를 확인했습니다. 준비가 되면 시험을 시작하세요.</p>
              <ul>
                <li>「시험 시작」을 누르면 <b>보안 브라우저로 전환</b>되어 시험이 열립니다.</li>
                <li>시작 후에는 <b>제한시간({TEST_DURATION_MINUTES}분)</b>이 즉시 시작되며, 처음부터 다시 시작할 수 없습니다.</li>
              </ul>
              <label className="prep-agree">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>위 안내와 유의사항을 모두 확인했으며, 시험에 응시합니다.</span>
              </label>
              {!isFullUser && <p className="prep-warn">본인 확인을 위해 구글 로그인 후 시작할 수 있습니다.</p>}
              {err && <p className="prep-warn">{err}</p>}
            </div>
          )}
        </div>

        <div className="prep-foot">
          <button
            className="exam-btn-ghost"
            disabled={step === 0 || starting}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            이전
          </button>
          {!last ? (
            <button className="exam-btn" onClick={() => setStep((s) => s + 1)}>
              다음
            </button>
          ) : (
            <button className="exam-btn" disabled={(!agree && isFullUser) || starting} onClick={startExam}>
              {starting ? '시험 준비 중…' : isFullUser ? '시험 시작' : '로그인 후 시작'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
