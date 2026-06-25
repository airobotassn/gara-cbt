// start-test: 쿨다운 검사 → 이전 in_progress 만료 → 레벨 6축 층화추출 20문항(정답 제외, 응시 언어 투영) → attempt 생성
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
  QUESTIONS_PER_TEST,
  BASE_PER_AXIS,
  EXTRA_AXES,
  MIN_LEVEL,
  MAX_LEVEL,
} from '../_shared/lib.ts'

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

    const admin = adminClient()

    // 레벨 잠금: 현재 등급(rank)까지만 응시 가능. 게스트/첫 유저 = MIN_LEVEL(1).
    // 승급 시 한 단계씩 해제. 클라가 우회해 잠긴 레벨을 시작하지 못하게 서버에서 강제.
    // 관리자는 문항 확인용으로 전 레벨 면제.
    const isAdmin = await isAdminUser(admin, user)
    if (!isAdmin) {
      const unlocked = await getRank(admin, user.id)
      if (level > unlocked) {
        return json({ error: '아직 잠긴 레벨입니다. 한 단계씩 승급하면 해제됩니다.' }, 403)
      }
    }

    // ⚠️ 테스트 단계: 쿨다운(3일 1회) 임시 비활성화. 정식 오픈 시 true 로 되돌리기.
    const COOLDOWN_ENABLED = false
    if (COOLDOWN_ENABLED && !user.is_anonymous && !isCooldownExempt(user.email)) {
      if (await hasRecentSubmission(admin, user.id)) {
        return json({ error: '최근 3일 내 응시 기록이 있어 지금은 응시할 수 없습니다.' }, 429)
      }
    }

    // 같은 유저의 진행중 attempt는 모두 만료 처리(동시 1개 + 방치 정리)
    await admin
      .from('test_attempts')
      .update({ status: 'expired' })
      .eq('user_id', user.id)
      .eq('status', 'in_progress')

    // 해당 레벨 문제 풀(정답 제외 X — 여기선 서버만, 클라엔 투영 후 정답 빼고 보냄)
    const { data: pool, error: poolErr } = await admin
      .from('questions')
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

    // 층화추출: 각 축 3개, 랜덤 2축은 4개
    const extra = new Set(shuffle(axes).slice(0, EXTRA_AXES))
    const picked: typeof pool = []
    const usedIds = new Set<string>()
    for (const ax of axes) {
      const need = BASE_PER_AXIS + (extra.has(ax) ? 1 : 0)
      const got = shuffle(byAxis.get(ax) ?? []).slice(0, need)
      for (const q of got) {
        picked.push(q)
        usedIds.add(q.id)
      }
    }
    // 축 부족으로 20개 미달이면 남은 풀에서 보충
    if (picked.length < QUESTIONS_PER_TEST) {
      const leftover = shuffle(pool.filter((q) => !usedIds.has(q.id)))
      for (const q of leftover) {
        if (picked.length >= QUESTIONS_PER_TEST) break
        picked.push(q)
        usedIds.add(q.id)
      }
    }
    const final = shuffle(picked).slice(0, QUESTIONS_PER_TEST)

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
    const { error: insErr } = await admin.from('attempt_answers').insert(answerRows)
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
