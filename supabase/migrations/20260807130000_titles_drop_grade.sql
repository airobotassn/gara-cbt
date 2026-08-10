-- 칭호에서 '급수'를 걷어낸다 — 2026-07 자격 체계 개편이 RPC 에만 반영되지 않았다.
--
-- 무엇이 틀어져 있었나:
--   옛 user_titles(20260714000800)는 **구 모델**을 그대로 계산하고 있었다.
--     · 트랙  : exams.tier 에 'master' 포함 여부로 Pro / Master **둘**로만 접음
--     · 급수  : 정답률 >=0.90 '1급' / >=0.80 '2급' / >=0.70 '3급' / else '4급'
--   그런데 src/lib/caris.ts 는 그 모델을 **폐기**했다고 명시한다 —
--   지금 체계는 티어 6개(beginner·pro·elite / master·grandmaster·zenith)가 **각각 독립 시험**이고
--   합격은 60% 하나뿐이다. 점수로 급수를 나누는 축이 아예 없어졌다.
--   그래서 화면에 'CARIS Pro 1급' 같은, 제도상 존재하지 않는 칭호가 찍히고 있었다.
--
-- 바뀌는 것:
--   · grade 제거. 칭호는 **합격한 티어 그 자체**다.
--   · 트랙 2개로 접지 않고 **티어 6개를 각각** 돌려준다(elite 합격과 pro 합격은 다른 자격이다).
--   · 표시 이름은 여기서 만들지 않고 **티어 key 만** 돌려준다.
--     이름(Beginner·Grand Master…)의 단일 출처는 프론트 src/lib/caris.ts / 서버 _shared/exam-tickets.ts 의
--     TIER_LABEL 이다. SQL 에 CASE 로 한 벌 더 두면 동기화 페어가 하나 더 생긴다(CLAUDE.md 관례).
--   · 정렬은 exam_tiers.sort **내림차순** — 배지에 하나만 띄울 때 최상위 자격이 나와야 한다.
--
-- 안 바뀌는 것: 합격선 60%, 응시 기록에서 ON READ 파생(certificates 테이블 없음), 쓰기 경로 없음,
--   service_role 전용 실행 권한. 구매·뽑기로는 못 얻는다는 성질 그대로다.
--
-- ⚠️ 반환 형태가 [{track, grade}] → [{tier, exam_title}] 로 **바뀐다**. 소비처 두 곳을 같이 고칠 것:
--   supabase/functions/leaderboard/index.ts (me.title 조립) · src/pages/Hub.tsx (배지·칭호 모달).

create or replace function public.user_titles(p_uid uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'tier',       tier,
      'exam_title', exam_title
    ) order by sort desc), '[]'::jsonb)
  from (
    -- 같은 티어를 여러 회차에서 합격했을 수 있다 → 티어당 1행(가장 잘 본 것).
    select distinct on (t.tier) t.tier, t.sort, e.title as exam_title
    from (
      select ea.exam_id,
             ea.total_correct::numeric / ea.total_questions as ratio
      from exam_attempts ea
      where ea.user_id = p_uid
        and ea.status = 'submitted'
        and ea.total_questions > 0
        and ea.total_correct::numeric / ea.total_questions >= 0.60   -- 합격선 60% (티어 무관 단일)
    ) q
    join exams e on e.id = q.exam_id
    -- inner join 이 의도다: exam_tiers 에 없는 옛/오타 티어는 칭호로 만들지 않는다
    -- (exams.tier 에는 CHECK 이 없어서 실제로 들어갈 수 있다 — 20260807090000 주석 참고).
    join exam_tiers t on t.tier = e.tier
    order by t.tier, q.ratio desc
  ) best;
$$;

comment on function public.user_titles(uuid) is
  '구매/뽑기 불가 — exam_attempts 합격(60%)에서만 파생. 급수 없음(2026-07 체계 개편), 티어 key 를 그대로 반환.';

-- 권한은 옛 정의와 동일하게 유지(create or replace 가 기존 ACL 을 지우지 않지만 명시해 둔다).
revoke execute on function public.user_titles(uuid) from public, anon, authenticated;
grant  execute on function public.user_titles(uuid) to service_role;
