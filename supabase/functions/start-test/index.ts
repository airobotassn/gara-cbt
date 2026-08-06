// start-test: 일일 응시 제한 검사 → 이전 in_progress 만료 → 레벨 축 층화추출(레벨 구간별 10/20/30문항,
//             정답 제외·응시 언어 투영) → attempt 생성
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  adminClient,
  getUser,
  getRank,
  hasRecentSubmission,
  isCooldownExempt,
  isAdminUser,
  axisKeysForLevel,
  pickLang,
  projText,
  projOptionsForLevel,
  questionsForLevel,
  dailyAttemptsLeft,
  axisQuota,
  MIN_LEVEL,
  MAX_LEVEL,
} from '../_shared/scoring.ts'

// 배열 셔플(Fisher–Yates)
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { level, lang: rawLang } = await req.json()
    if (typeof level !== 'number' || level < MIN_LEVEL || level > MAX_LEVEL) {
      return json({ error: '잘못된 레벨입니다.' }, 400)
    }
    const lang = pickLang(rawLang)

    const user = await getUser(req)
    if (!user) return json({ error: '인증이 필요합니다.' }, 401)
    // 게스트(익명) 응시 허용(2026-08-06 부활). 결과는 총점만 나가고 누적은 안 된다
    // — 잠금은 submit-test·get-result 의 lockedResult 가 건다.
    // ⚠️ 익명을 **일일 제한에서 면제하지 말 것**(아래 dailyAttemptsLeft 는 익명에도 그대로 적용한다).
    //    2026-08-05 에 익명을 통째로 막았던 이유가 그 면제였다 — 시크릿창으로 세션을 계속 만들면서
    //    무제한으로 응시해 Lv.1 문제은행을 긁어갈 수 있었다. 세션마다 새 계정이라 제한이 만능은 아니지만,
    //    적어도 한 세션으로 무한히 뽑는 경로는 닫힌다.
    const admin = adminClient()

    // 레벨 잠금: 현재 등급(rank)까지만 응시 가능. 첫 유저 = MIN_LEVEL(1).
    // 승급 시 한 단계씩 해제. 클라가 우회해 잠긴 레벨을 시작하지 못하게 서버에서 강제.
    // 관리자는 문항 확인용으로 전 레벨 면제.
    const isAdmin = await isAdminUser(admin, user)
    if (!isAdmin) {
      const unlocked = await getRank(admin, user.id)
      if (level > unlocked) {
        return json({ error: '아직 잠긴 레벨입니다. 한 단계씩 승급하면 해제됩니다.' }, 403)
      }
    }

    // ⚠️ 옛 쿨다운(3일 1회)은 아래 '하루 N회'로 대체됐다. 되살릴 일이 있으면 true 로.
    const COOLDOWN_ENABLED = false
    if (COOLDOWN_ENABLED && !isCooldownExempt(user.email)) {
      if (await hasRecentSubmission(admin, user.id)) {
        return json({ error: '최근 3일 내 응시 기록이 있어 지금은 응시할 수 없습니다.' }, 429)
      }
    }

    // 하루 응시 제한 — 기본 2회, **그날 승급할 때마다 1회씩 추가**(승급하면 소모분을 돌려받는 셈).
    //   별도 테이블 없이 test_attempts 로 계산한다: 남은 = 기본 + 오늘 승급수 − 오늘 시작수.
    //   · 기준일 = KST 캘린더일(started_at)
    //   · 시작만 하고 이탈한 in_progress/expired 도 '소모'로 센다(시작→이탈 반복으로 무한 응시 방지)
    //   · 관리자만 면제. **게스트(익명)도 면제하지 않는다** — 옛 익명 면제가 곧 무제한 응시 구멍이었다.
    if (!isAdmin) {
      const { left, used, allowed } = await dailyAttemptsLeft(admin, user.id)
      if (left <= 0) return json({ error: 'daily_limit', allowed, used }, 429)
    }

    // 같은 유저의 진행중 attempt는 모두 만료 처리(동시 1개 + 방치 정리)
    await admin
      .from('test_attempts')
      .update({ status: 'expired' })
      .eq('user_id', user.id)
      .eq('status', 'in_progress')

    // 해당 레벨 문제 풀(정답 제외 X — 여기선 서버만, 클라엔 투영 후 정답 빼고 보냄)
    const { data: pool, error: poolErr } = await admin
      .from('test_questions')
      .select('id, category, prompt_i18n, options_i18n')
      .eq('level', level)
      .eq('active', true)
      .limit(500)
    if (poolErr) return json({ error: poolErr.message }, 500)
    if (!pool || pool.length === 0) {
      return json({ error: '해당 레벨의 문제가 없습니다.' }, 400)
    }

    // 축별 그룹핑
    const axes = axisKeysForLevel(level)
    const byAxis = new Map<string, typeof pool>()
    for (const ax of axes) byAxis.set(ax, [])
    for (const q of pool) {
      if (byAxis.has(q.category)) byAxis.get(q.category)!.push(q)
    }

    // 층화추출: 그 레벨의 문항 수(10/20/30)를 축 수로 균등 배분하고 나머지는 랜덤 축에 +1
    const totalQ = questionsForLevel(level)
    const quota = axisQuota(axes.length, totalQ)
    const extra = new Set(shuffle(axes).slice(0, quota.extraAxes))
    const picked: typeof pool = []
    const usedIds = new Set<string>()
    for (const ax of axes) {
      const need = quota.base + (extra.has(ax) ? 1 : 0)
      const got = shuffle(byAxis.get(ax) ?? []).slice(0, need)
      for (const q of got) {
        picked.push(q)
        usedIds.add(q.id)
      }
    }
    // 축별 문항이 모자라 목표 수에 미달이면 남은 풀에서 보충(그래도 모자라면 그 수만큼만 출제 —
    // 승급컷은 비율이라 실제 출제 수 기준으로 판정된다)
    if (picked.length < totalQ) {
      const leftover = shuffle(pool.filter((q) => !usedIds.has(q.id)))
      for (const q of leftover) {
        if (picked.length >= totalQ) break
        picked.push(q)
        usedIds.add(q.id)
      }
    }
    const final = shuffle(picked).slice(0, totalQ)

    // attempt 생성
    const { data: attempt, error: aErr } = await admin
      .from('test_attempts')
      .insert({
        user_id: user.id,
        level,
        lang,
        status: 'in_progress',
        total_questions: final.length,
      })
      .select('id, started_at')
      .single()
    if (aErr || !attempt) return json({ error: aErr?.message ?? '생성 실패' }, 500)

    // 출제 문항 고정(부정 제출 방지)
    const answerRows = final.map((q) => ({
      attempt_id: attempt.id,
      question_id: q.id,
      category: q.category,
      selected_index: null,
      is_correct: false,
    }))
    const { error: insErr } = await admin.from('test_answers').insert(answerRows)
    if (insErr) return json({ error: insErr.message }, 500)

    // 정답 제외 + 응시 언어로 투영해서 반환
    return json({
      attemptId: attempt.id,
      level,
      lang,
      startedAt: attempt.started_at,
      questions: final.map((q) => ({
        id: q.id,
        category: q.category,
        prompt: projText(q.prompt_i18n, lang),
        options: projOptionsForLevel(q.options_i18n, lang, level),
      })),
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
