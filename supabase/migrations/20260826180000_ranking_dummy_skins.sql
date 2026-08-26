-- 랭킹 더미 배경 분포 — 초원 50% · 고궁 낮 30% · 고궁 밤 20%, 위에서부터 고궁 (2026-08-26)
--
-- 왜: 옛 시드는 "3분의 1만 밤 배경, 나머지는 기본" 이라 ① 2026-08-25 에 생긴 **고궁 낮**을 입은
--     더미가 한 명도 없었고 ② 배경이 점수와 아무 상관이 없어서, 랭킹 1위 방이 아무것도 안 산
--     기본 배경인 경우가 절반이었다. 오래 한 사람일수록 꾸며져 있는 게 자연스럽다.
--
-- 규칙 — **지역(10명) 안에서 점수 순으로** 자른다.
--   · 위 절반(1~5위) = 고궁, 아래 절반(6~10위) = 초원(null)   → 초원 50%
--   · 고궁 다섯 중 둘이 밤, 셋이 낮                            → 낮 30% · 밤 20%
--   밤·낮 중 어느 자리가 밤이 되는지는 **지역마다 해시로 돌린다** — 안 돌리면 모든 지역의
--   1·2위가 똑같이 밤이라 보드를 몇 개만 넘겨봐도 규칙이 보인다.
--
-- ⚠️ 지역 안 등수로 자르는 것이 곧 "상위권은 고궁" 이다. 전세계·국가 보드의 윗줄은 각 지역 1위들이
--    올라온 것이라 자동으로 고궁이 된다(전세계 상위 100명 = 전원 고궁).
-- ⚠️ 초원은 `skin_meadow` 가 아니라 **null** 이다 — 실회원도 아무것도 장착 안 하면 null 이고,
--    화면은 둘을 같은 것으로 읽는다(`skinByPart(null)` → 초원). 더미만 다른 모양으로 두지 않는다.
-- ⚠️ **재시드하면 이 함수를 한 번 더 부를 것.** `seed_ranking_dummies()` 는 옛 규칙(3분의 1 밤)으로
--    다시 깐다 — arena 시드를 다시 깔면 `seed_ranking_dummies()` 를 한 번 더 도는 것과 같은 짝이다.
create or replace function public.assign_ranking_dummy_skins()
returns int language plpgsql as $$
declare v_n int;
begin
  with pos as (
    select id,
           row_number() over (partition by region_code order by season_total desc, id) as p,
           count(*)     over (partition by region_code)                                as n,
           -- 지역마다 다른 오프셋. 같은 지역 안에서는 같은 값이라 결과가 결정론적이다.
           ranking_dummy_hash('sk' || coalesce(region_code, '')) as h
      from ranking_dummies
  )
  update ranking_dummies d
     set skin = case
                  -- 아래 절반 = 아무것도 안 산 사람.
                  when pos.p > round(pos.n * 0.5) then null
                  -- 위 절반 다섯 중 둘(= (p+h) mod 5 가 0·1 인 자리)이 밤.
                  when (pos.p + pos.h) % 5 < 2 then 'skin_palace_night'
                  else 'skin_palace_day'
                end
    from pos
   where pos.id = d.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.assign_ranking_dummy_skins() from public, anon, authenticated;

select public.assign_ranking_dummy_skins();
