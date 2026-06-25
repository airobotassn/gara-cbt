// tools/coldstart.mjs — 지식 저장소(kb_chunks) 콜드스타트 적재기 (생성 LLM 없이).
//
// 흐름:  위키피디아 본문(plaintext) → 문단단위 청크(원문 그대로) → kb-save(임베딩 + 중복제거 + 적재)
//
// 왜 생성 LLM(kb-extract/flash)을 안 쓰나
//   · 콜드스타트는 사람(여기선 에이전트)이 직접 모는 일회성 → 청킹/축배정을 코드+큐레이션으로 처리.
//   · 청크 = 위키 "문단을 그대로" 잘라 씀 → 원문보존이 기계적으로 보장(할루시네이션 0, quote 검사 불필요).
//   · 축은 문서별로 미리 1개 지정(아래 ARTICLES) → 라우팅에 LLM 불필요.
//   · 남는 외부 호출은 "임베딩"뿐(벡터는 코드로 못 만듦) — 임베딩 할당량은 생성 할당량과 별개.
//   · kb_chunks 는 service-role 전용이라 insert 는 kb-save(함수)를 거쳐야 함(보안 모델).
//
// 재실행 안전: kb-save 가 같은 레벨 안 0.92↑ 유사 청크를 건너뜀 → 같은 문서 또 돌려도 중복 안 쌓임.
//
// 사용:  node tools/coldstart.mjs [minLevel] [maxLevel]   (기본 1 7)
//        node tools/coldstart.mjs check                    (출처 제목 검증, 적재 안 함)

const FN_BASE = 'https://jfvldoywvzvqhitcgalr.supabase.co/functions/v1'
const MAX_CHARS = 13000  // 문서당 청크로 쓸 본문 상한
const MAX_CHUNKS = 16    // 문서당 청크 개수 상한(한 문서가 축을 독식하지 않게)
const MIN_PARA = 180     // 이보다 짧은 문단은 스킵(스텁/캡션)
const PACE_MS = 900      // kb-save(임베딩) 호출 사이 간격
const MAX_RETRY = 4
const WIKI_UA = 'GARA-coldstart/1.0 (AI literacy test knowledge base; contact tkgkd159@gmail.com)'

// 레벨별 6축 (tools/index.html 의 AXES 와 동기화) — 요약 출력용 라벨
const AXES = {
  1: [['l1_principle','생성형 AI 기본 원리'],['l1_security','AI 취약점·보안'],['l1_ethics','AI 윤리·편향'],['l1_responsibility','AI 사회적 책임·규범'],['l1_llm_eco','LLM 응용·생태계'],['l1_prompt','프롬프트 엔지니어링']],
  2: [['l2_genai','생성형 AI 중급'],['l2_api','생성형 AI API 호출'],['l2_algo','AI 알고리즘 기획'],['l2_sensor','내장 센서 제어'],['l2_block','블록코딩 논리'],['l2_python','파이썬 기초']],
  3: [['l3_rag','RAG·검색 파이프라인'],['l3_llm_ctrl','LLM 활용·생성 제어'],['l3_vision_eval','비전 인식·평가지표'],['l3_vision_data','비전 처리·데이터'],['l3_c_basic','C 기초 문법·흐름'],['l3_c_adv','C 메모리·구조·고급']],
  4: [['l4_preproc','물리적 AI 전처리'],['l4_stm32','STM32 정밀제어'],['l4_ros2','ROS2 시스템 통합'],['l4_plc','PLC 프로그래밍'],['l4_sim','공정 시뮬레이션'],['l4_smartfactory','스마트공장']],
  5: [['l5_reasoning','AI 지능·추론'],['l5_edge','엣지 AI 컴퓨팅'],['l5_iiot','산업 IoT·데이터 연계'],['l5_dtwin','디지털 트윈·시뮬레이션'],['l5_sysopt','시스템 통합·제조 최적화'],['l5_ros2','로봇 OS·제어(ROS2)']],
  6: [['l6_swarm','군집 지능'],['l6_hrc','인간-로봇 협업(HRC)'],['l6_dtwin','디지털 트윈'],['l6_orchestration','AI 오케스트레이션'],['l6_process_opt','지능형 공정 최적화'],['l6_robosec','로보틱스 보안 및 사이버-물리 시스템']],
  7: [['l7_standard','글로벌 표준 및 규제'],['l7_arch','초거대 시스템 아키텍처'],['l7_phyfusion','차세대 물리-지능 융합'],['l7_faulttol','극단적 결함 허용'],['l7_governance','AI 생태계 및 거버넌스'],['l7_ethics','범용 물리 지능 윤리']],
}
const AXIS_LABEL = {}
Object.values(AXES).flat().forEach(([k, l]) => (AXIS_LABEL[k] = l))

// 레벨별 출처: [축코드, (lang,) 위키문서제목]. 문서마다 축 1개 고정(라우팅에 LLM 불필요).
const ARTICLES = {
  1: [
    ['l1_principle','Generative artificial intelligence'], ['l1_principle','Foundation model'],
    ['l1_llm_eco','Large language model'], ['l1_llm_eco','ChatGPT'],
    ['l1_prompt','Prompt engineering'],
    ['l1_security','Prompt injection'], ['l1_security','Adversarial machine learning'],
    ['l1_ethics','Algorithmic bias'], ['l1_ethics','Ethics of artificial intelligence'],
    ['l1_responsibility','Regulation of artificial intelligence'],
  ],
  2: [
    ['l2_genai','Transformer (deep learning architecture)'], ['l2_genai','Diffusion model'],
    ['l2_algo','Machine learning'], ['l2_algo','Supervised learning'],
    ['l2_api','Application programming interface'], ['l2_api','Representational state transfer'],
    ['l2_python','Python (programming language)'],
    ['l2_block','Scratch (programming language)'],
    ['l2_sensor','Sensor'], ['l2_sensor','Microcontroller'],
  ],
  3: [
    ['l3_rag','Retrieval-augmented generation'], ['l3_rag','Vector database'],
    ['l3_llm_ctrl','Fine-tuning (deep learning)'], ['l3_llm_ctrl','Hallucination (artificial intelligence)'],
    ['l3_vision_data','Computer vision'], ['l3_vision_data','Convolutional neural network'],
    ['l3_vision_eval','Object detection'], ['l3_vision_eval','Precision and recall'],
    ['l3_c_basic','C (programming language)'],
    ['l3_c_adv','Pointer (computer programming)'], ['l3_c_adv','C dynamic memory allocation'],
  ],
  4: [
    ['l4_ros2','Robot Operating System'],
    ['l4_plc','Programmable logic controller'], ['l4_plc','IEC 61131-3'], ['l4_plc','Ladder logic'],
    ['l4_stm32','STM32'], ['l4_stm32','ARM Cortex-M'], ['l4_stm32','PID controller'],
    ['l4_preproc','Sensor fusion'], ['l4_preproc','Kalman filter'],
    ['l4_sim','Computer simulation'],
    ['l4_smartfactory','Industry 4.0'],
  ],
  5: [
    ['l5_edge','Edge computing'], ['l5_edge','AI accelerator'],
    ['l5_iiot','Industrial internet of things'], ['l5_iiot','Internet of things'], ['l5_iiot','OPC Unified Architecture'], ['l5_iiot','MQTT'],
    ['l5_dtwin','Digital twin'],
    ['l5_sysopt','Mathematical optimization'], ['l5_sysopt','Operations research'],
    ['l5_reasoning','Automated reasoning'],
    ['l5_ros2','Robot Operating System'],
  ],
  6: [
    ['l6_swarm','Swarm intelligence'], ['l6_swarm','Swarm robotics'], ['l6_swarm','Ant colony optimization algorithms'],
    ['l6_hrc','Human–robot interaction'], ['l6_hrc','Cobot'],
    ['l6_orchestration','Multi-agent system'],
    ['l6_process_opt','Model predictive control'],
    ['l6_robosec','Cyber-physical system'],
    ['l6_dtwin','Digital twin'],
  ],
  7: [
    ['l7_standard','Artificial Intelligence Act'], ['l7_standard','Regulation of artificial intelligence'],
    ['l7_governance','AI safety'],
    ['l7_faulttol','Fault tolerance'], ['l7_faulttol','Redundancy (engineering)'],
    ['l7_arch','Distributed computing'], ['l7_arch','Scalability'],
    ['l7_ethics','Machine ethics'], ['l7_ethics','Roboethics'],
    ['l7_phyfusion','Neuromorphic engineering'],
  ],
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const parseSpec = (spec) => spec.length === 3 ? { axis: spec[0], lang: spec[1], title: spec[2] } : { axis: spec[0], lang: 'en', title: spec[1] }

// 위키피디아 본문(plaintext). formatversion=2, explaintext → 깨끗한 텍스트. 리다이렉트 자동.
async function fetchWiki(lang, title) {
  const u = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', prop: 'extracts',
    explaintext: '1', redirects: '1', titles: title,
  })
  const r = await fetch(u, { headers: { 'User-Agent': WIKI_UA } })
  if (!r.ok) throw new Error(`wiki HTTP ${r.status}`)
  const j = await r.json()
  const p = j?.query?.pages?.[0]
  if (!p || p.missing || !p.extract) return null
  return { text: p.extract, title: p.title }
}

// 본문 → 문단단위 청크(원문 그대로). 섹션 제목을 토픽으로. 참고문헌류 섹션은 스킵.
const SKIP_SECTION = /^(references|see also|external links|notes|citations|further reading|bibliography|sources|footnotes|works cited|gallery|external resources)$/i
function chunkLocal(text, axisKey) {
  const lines = text.split('\n')
  let topic = '개요'
  const chunks = []
  let used = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const h = line.match(/^(={2,})\s*(.+?)\s*\1$/)
    if (h) { topic = h[2].trim(); continue }     // 섹션 제목 → 토픽
    if (SKIP_SECTION.test(topic)) continue
    if (line.length < MIN_PARA) continue          // 스텁 문단 스킵
    if (chunks.length >= MAX_CHUNKS || used + line.length > MAX_CHARS) break
    chunks.push({ text: line, axis: axisKey, topic })
    used += line.length
  }
  return chunks
}

// Edge Function 호출(429/5xx 재시도, billing/할당량소진은 즉시 중단 신호).
async function callFn(path, body) {
  let lastErr
  for (let a = 0; a < MAX_RETRY; a++) {
    try {
      const r = await fetch(`${FN_BASE}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({ error: `HTTP ${r.status} (non-JSON)` }))
      if (r.ok && !j.error) return j
      lastErr = j.error || `HTTP ${r.status}`
      if (/billing|plan|exceeded your current quota/i.test(String(lastErr))) { const e = new Error(lastErr); e.quota = true; throw e }
      if (!/429|5\d\d|overload|temporar|unavailable/i.test(String(lastErr))) break
    } catch (e) {
      if (e.quota) throw e
      lastErr = e instanceof Error ? e.message : String(e)
    }
    await sleep(2500 * (a + 1))
  }
  throw new Error(lastErr || '실패')
}

async function run(minL, maxL) {
  const totals = {}
  for (const [k] of Object.values(AXES).flat()) totals[k] = { saved: 0, dup: 0, chunks: 0 }
  const misses = []

  for (let level = minL; level <= maxL; level++) {
    const arts = ARTICLES[level] || []
    console.log(`\n══════ Lv.${level} — 문서 ${arts.length}개 ══════`)
    for (const spec of arts) {
      const { axis, lang, title } = parseSpec(spec)
      const tag = `  [Lv${level}] ${title} → ${axis.replace(/^l\d_/, '')}`
      let wiki
      try { wiki = await fetchWiki(lang, title) } catch (e) { console.log(`${tag} … 위키 실패: ${e.message}`); misses.push(`${title} (wiki)`); continue }
      if (!wiki) { console.log(`${tag} … 문서 없음`); misses.push(`${title} (없음)`); continue }

      const chunks = chunkLocal(wiki.text, axis)
      if (!chunks.length) { console.log(`${tag} … 청크 0(본문 형식)`); misses.push(`${title} (청크0)`); continue }

      let sv
      try {
        sv = await callFn('kb-save', {
          level, embed: false,  // 무료 경로: 본문만 적재(임베딩은 나중에 백필)
          source: { url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(wiki.title.replace(/ /g, '_'))}`, title: wiki.title },
          chunks,
        })
      } catch (e) {
        if (e.quota) { console.log(`\n⛔ 임베딩 할당량 소진 — 중단. 결제 활성화/리셋 후 다시 실행.\n   (지금까지 저장분은 유지됨)`); printSummary(totals, misses, minL, maxL); return }
        console.log(`${tag} … 저장 실패: ${e.message}`); misses.push(`${title} (save: ${e.message})`); continue
      }
      totals[axis].chunks += chunks.length
      totals[axis].saved += sv.saved || 0
      totals[axis].dup += sv.skipped || 0
      console.log(`${tag} … 청크 ${chunks.length} → 저장 ${sv.saved} (중복 ${sv.skipped})`)
      await sleep(PACE_MS)
    }
  }
  printSummary(totals, misses, minL, maxL)
}

function printSummary(totals, misses, minL, maxL) {
  console.log(`\n\n════════ 최종 커버리지 (저장된 청크 수) ════════`)
  for (let level = minL; level <= maxL; level++) {
    console.log(`\nLv.${level}`)
    for (const [key, label] of AXES[level] || []) {
      const t = totals[key]
      const flag = t.saved === 0 ? '  ⚠ 비었음' : t.saved < 5 ? '  · 얇음' : ''
      console.log(`  ${label.padEnd(22)} 저장 ${String(t.saved).padStart(3)}  (중복 ${t.dup})${flag}`)
    }
  }
  if (misses.length) { console.log(`\n실패/누락 ${misses.length}건:`); for (const m of misses) console.log(`  - ${m}`) }
  console.log(`\n완료.`)
}

// 출처 제목 검증(위키 전용)
async function checkTitles() {
  console.log('출처 제목 검증(위키피디아만)\n')
  let ok = 0, bad = 0
  const problems = []
  for (let level = 1; level <= 7; level++) {
    console.log(`── Lv.${level} ──`)
    for (const spec of ARTICLES[level] || []) {
      const { lang, title, axis } = parseSpec(spec)
      let w
      try { w = await fetchWiki(lang, title) } catch (e) { console.log(`  ✗ ${title} — ${e.message}`); problems.push(title); bad++; continue }
      if (!w) { console.log(`  ✗ ${title} — 문서 없음`); problems.push(title); bad++; continue }
      const redir = w.title !== title ? ` → "${w.title}"` : ''
      console.log(`  ✓ [${axis.replace(/^l\d_/, '')}] ${title}${redir} — ${w.text.length}자`); ok++
      await sleep(120)
    }
  }
  console.log(`\n요약: 정상 ${ok} · 문제 ${bad}`)
  if (problems.length) console.log('손볼 것:\n' + problems.map((p) => '  - ' + p).join('\n'))
}

const argv = process.argv.slice(2)
if (argv[0] === 'check') {
  checkTitles().catch((e) => { console.error('치명적 오류:', e); process.exit(1) })
} else {
  const minL = Math.max(1, Math.min(7, +argv[0] || 1))
  const maxL = Math.max(minL, Math.min(7, +argv[1] || (argv[0] ? +argv[0] : 7)))
  console.log(`콜드스타트(Gemini 미사용·본문만 무료적재) 시작: Lv.${minL}~${maxL}  (문서당 ≤${MAX_CHUNKS}청크/${MAX_CHARS}자)`)
  run(minL, maxL).catch((e) => { console.error('치명적 오류:', e); process.exit(1) })
}
