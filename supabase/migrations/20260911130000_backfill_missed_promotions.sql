-- 2026-09-11 · 저장 안 된 승급 2건 백필 — 9/4 컬럼 드롭 뒤 applyAttempt 가 조용히 실패했다
--
--   2026-09-04 에 `user_progress.points` 를 지웠는데(20260904460000) `applyAttempt` 의 upsert 에서
--   그 컬럼을 안 빼서 PostgREST 400 이 났고, 반환값을 안 받아서 **아무 표시 없이** 실패했다.
--   `test_attempts` 쪽(rank_before·rank_after·rank_dir)은 그 뒤 줄에서 따로 써서 멀쩡히 남았고,
--   `user_progress`(rank·skill_score)만 안 올라갔다 — 화면(허브·랭킹)은 후자를 본다.
--
--   실측: 9/4 이후 승급(rank_after > rank_before)인 제출 = 2건, 둘 다 Lv.1 합격 → 등급 2 이어야 하는데 1.
--     73fe7a4d… 2026-09-07 10/10   b97ad04e… 2026-09-09 9/10
--   코드는 20260911 에 고쳤다(upsert 에서 points 제거 + error 를 이제 던진다). 이 파일은 그 사이 2명분이다.
--
--   ⚠️ **응시 기록에 박힌 값을 그대로 옮긴다** — 다시 계산하지 않는다. rank = 그 응시의 rank_after,
--      skill_score = (rank_after − 1) × 1,000(레벨 클리어 1회당 1,000 · 부분점수 없음). 둘 다 Lv.1→2 라 1,000.
--   ⚠️ `season_total` 은 생성열(skill + activity)이라 자동으로 따라오고, `arena_level` 은 이 표의
--      BEFORE UPDATE 트리거(user_progress_arena_level_trg)가 다시 계산한다 — 직접 쓰지 않는다.
--   ⚠️ 이미 맞는 사람은 안 건드린다(`p.rank < a.rank_after` 조건). 다시 돌려도 안전하다.

begin;

update user_progress p
   set rank = a.rank_after,
       skill_score = greatest(p.skill_score, (a.rank_after - 1) * 1000),
       updated_at = now()
  from (
    select distinct on (user_id) user_id, rank_after
      from test_attempts
     where status = 'submitted' and applied = true
       and submitted_at >= '2026-09-04'
       and rank_after > rank_before
     order by user_id, rank_after desc
  ) a
 where p.user_id = a.user_id
   and p.rank < a.rank_after;

-- 검산 — 승급 기록이 있는데 아직 등급이 낮은 사람이 남으면 통째로 롤백.
do $$
declare n int;
begin
  select count(*) into n
    from test_attempts a join user_progress p on p.user_id = a.user_id
   where a.status = 'submitted' and a.applied = true and a.submitted_at >= '2026-09-04'
     and a.rank_after > a.rank_before and p.rank < a.rank_after;
  if n > 0 then
    raise exception '승급이 안 반영된 사람이 %명 남았다', n;
  end if;
end $$;

commit;
