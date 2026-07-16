-- ============================================================
-- 칭호(자격증 트랙·급수) — exam_attempts 합격에서 ON READ 파생 (G006b).
--   · certificates 테이블 없음: 응시 기록(exam_attempts)에서 읽을 때마다 계산.
--   · 합격 = status='submitted' AND total_questions>0 AND 정답률>=0.60.
--   · 급수: 정답률 >=0.90 '1급' / >=0.80 '2급' / >=0.70 '3급' / else '4급'.
--   · 트랙: exams.tier 에 'master' 포함 → 'Master', 아니면 'Pro'.
--   · 트랙별 최고 급수 1개만(distinct on) → jsonb 배열 [{track, grade, exam_title}].
--   · 구매/뽑기 불가 — exam_attempts 합격에서만 파생(진짜 취득자만). 쓰기 경로 없음(read-only).
--   · SECURITY DEFINER + set search_path=public. service-role(엣지fn)만 실행:
--     PUBLIC/anon/authenticated 는 revoke → service_role 에만 grant.
--   멱등(재실행 안전). schema.sql 의 동명 블록과 DDL 동일.
-- ============================================================
create or replace function public.user_titles(p_uid uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'track',      track,
      'grade',      grade,
      'exam_title', exam_title
    ) order by track), '[]'::jsonb)
  from (
    select distinct on (track) track, grade, exam_title
    from (
      select
        case when e.tier ilike '%master%' then 'Master' else 'Pro' end as track,
        case when q.ratio >= 0.90 then '1급'
             when q.ratio >= 0.80 then '2급'
             when q.ratio >= 0.70 then '3급'
             else '4급' end                                            as grade,
        e.title                                                        as exam_title,
        q.ratio                                                        as ratio
      from (
        select ea.exam_id,
               ea.total_correct::numeric / ea.total_questions as ratio
        from exam_attempts ea
        where ea.user_id = p_uid
          and ea.status = 'submitted'
          and ea.total_questions > 0
          and ea.total_correct::numeric / ea.total_questions >= 0.60
      ) q
      join exams e on e.id = q.exam_id
    ) graded
    order by track, ratio desc
  ) best;
$$;
comment on function public.user_titles(uuid) is '구매/뽑기 불가 — exam_attempts 합격에서만 파생';
revoke execute on function public.user_titles(uuid) from public, anon, authenticated;
grant  execute on function public.user_titles(uuid) to service_role;

-- 편의 함수: 칭호 보유 여부(배지 노출용). user_titles 파생.
create or replace function public.has_title(p_uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select jsonb_array_length(public.user_titles(p_uid)) > 0;
$$;
revoke execute on function public.has_title(uuid) from public, anon, authenticated;
grant  execute on function public.has_title(uuid) to service_role;
