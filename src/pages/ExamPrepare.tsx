import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { isMobileDevice } from '../lib/device'
import MobileBlock from '../components/MobileBlock'
import SebRequired from '../components/SebRequired'
import { SEB_REQUIRED, isSEB } from '../lib/seb'
import { DEFAULT_EXAM_SLUG, TOTAL_QUESTIONS, TEST_DURATION_MINUTES, RESULT_RELEASE_DAYS } from '../lib/testConfig'
import type { StartExamResponse } from '../lib/types'

const STEPS = ['안내사항', '유의사항', '메뉴 설명', '문제풀이 연습', '시험 준비 완료']

// 국가공인 CBT 형태의 응시 전 단계: 안내 → 유의 → 메뉴 → 연습 → 준비완료 → 시험시작
export default function ExamPrepare() {
  const navigate = useNavigate()
  const { isFullUser, loginWithGoogle } = useAuth()
  const [step, setStep] = useState(0)
  const [agree, setAgree] = useState(false)
  const [practice, setPractice] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)
  const [err, setErr] = useState('')

  if (isMobileDevice()) return <MobileBlock />
  if (SEB_REQUIRED && !isSEB()) return <SebRequired />

  async function startExam() {
    if (!isFullUser) {
      loginWithGoogle()
      return
    }
    if (!agree || starting) return
    setStarting(true)
    setErr('')
    try {
      // 시험 시작은 사용자 제스처 → 전체화면 진입 허용(실패해도 진행)
      try {
        await document.documentElement.requestFullscreen?.()
      } catch {
        /* 거부/미지원 — 무시 */
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

          {step === 1 && (
            <div className="prep-text">
              <p>다음 유의사항을 반드시 지켜주세요. 위반 시 채점에서 불이익을 받을 수 있습니다.</p>
              <ul>
                <li>화면 <b>캡처·복사·우클릭</b> 및 개발자도구는 차단됩니다.</li>
                <li>다른 창·탭으로 <b>이탈</b>하면 화면이 가려지고 <b>횟수가 기록</b>됩니다.</li>
                <li>안 푼 문항이 있으면 <b>제출되지 않으며</b>, 미응답 문항으로 이동합니다.</li>
                <li>시험 중 <b>새로고침</b>하면 시험이 종료될 수 있으니 주의하세요.</li>
                <li>부정행위가 확인되면 응시가 무효 처리될 수 있습니다.</li>
              </ul>
            </div>
          )}

          {step === 2 && (
            <div className="prep-text">
              <p>시험 화면 구성은 다음과 같습니다.</p>
              <ul>
                <li><b>왼쪽</b>: 문제와 보기. 상단에 경과시간·글자크기·스크랩 버튼이 있습니다.</li>
                <li><b>오른쪽</b>: <b>답안지</b>(번호별 1~4 선택), <b>문제풀이 현황</b>(전체 보기), <b>캔버스</b>(메모).</li>
                <li>답은 <b>보기를 클릭</b>하거나 <b>답안지의 번호를 클릭</b>해 선택할 수 있습니다.</li>
                <li><b>스크랩</b>한 문항은 현황에서 ★로 표시되어 다시 찾기 쉽습니다.</li>
                <li>아래쪽 <b>이전 / 제출 / 다음</b>으로 이동·제출합니다.</li>
              </ul>
            </div>
          )}

          {step === 3 && (
            <div className="prep-practice">
              <p className="prep-note">아래는 연습 문제입니다. 보기를 클릭해 선택해 보세요. (채점되지 않습니다)</p>
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
                    {practice === 0
                      ? '정답입니다! 실제 시험도 이렇게 답을 선택합니다.'
                      : '연습이니 괜찮아요. 1번이 올바른 응시 방법입니다.'}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="prep-text">
              <p>모든 안내를 확인했습니다. 준비가 되면 시험을 시작하세요.</p>
              <ul>
                <li>시험을 시작하면 <b>전체화면</b>으로 전환되고 <b>제한시간({TEST_DURATION_MINUTES}분)</b>이 즉시 시작됩니다.</li>
                <li>시작 후에는 처음부터 다시 시작할 수 없습니다.</li>
              </ul>
              <label className="prep-agree">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>위 안내와 유의사항을 모두 확인했으며, 시험에 응시합니다.</span>
              </label>
              {!isFullUser && (
                <p className="prep-warn">본인 확인을 위해 구글 로그인 후 시작할 수 있습니다.</p>
              )}
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
