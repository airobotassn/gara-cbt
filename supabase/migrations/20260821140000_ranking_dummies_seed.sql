-- 랭킹 더미 시드 — 표(20260821130000)를 실제로 채운다.
--
-- ⛔ **행을 파일에 박지 않는다.** 지역 3,504개 × 10명이면 INSERT 가 3만5천 줄(4MB)이 되는데,
--    그 값의 근거는 전부 `arena_seed_buckets` 안에 이미 있다(지역 코드·소속 국가·그 지역 점수).
--    그래서 **SQL 이 그 표를 읽어 만들어낸다** — 파일은 짧고, arena 시드를 다시 깔면
--    `select seed_ranking_dummies();` 한 줄로 랭킹 더미도 그 값에 다시 맞출 수 있다.
--
-- 점수를 어떻게 정하나 — **나라마다 점수 대역을 주고, 그 안에서 등수로 갈린다.**
--   1) 나라 대역의 꼭대기 = 그 나라 최고 지역 점수를 **0.6 제곱으로 압축**한 값 × 천장(v_peak).
--      압축하는 이유는 순서는 지키되 간격을 좁히려는 것이다(미국:한국 = 1.26배 → 1.15배).
--   2) 그 나라 안에서 등수를 매기고, 위에서부터 `1 - 0.62 × r^0.35` 로 떨어뜨린다(r = 등수 비율).
--      **1~3등이 급하게 벌어지고 그 아래는 완만한** 곡선이다.
--
--   ⛔ **이 두 단계를 건너뛰고 "지역 점수 × 자리 가중치" 로 바로 매기면 전세계 TOP 10 이
--      한 나라로 채워진다.** 실제로 그렇게 만들어봤더니 10명 중 9명이 미국이었다 —
--      미국은 주가 51개라 사람이 510명이고, 인원이 많으면 상위가 촘촘해서 다른 나라 1등이
--      비집고 들어갈 자리가 없다(압축을 0.6까지 걸어도 마찬가지였다).
--      나라 안 등수로 대역을 배분하면 인원이 몇이든 그 나라 1등이 자기 대역 꼭대기에 서고,
--      상위권은 **나라 대역 순서대로 섞인다.** "월드 랭킹이 다 한국인" 을 고치려다
--      "다 미국인" 으로 바꾸면 같은 문제가 그대로다.
--
--   · ⚠️ 그 결과 **랭킹의 나라 순서는 지도(나라 평균)와 완전히 같지 않다** — 그게 맞다.
--     지도는 그 나라 평균을 말하고 랭킹은 그 나라 최고수를 말하는, 서로 다른 축이다.
--   · ⛔ **천장은 6,900점이다.** 진짜 사용자가 레벨테스트를 끝까지 깨면 skill 만 7,000 이라
--     **더미를 무조건 넘는다.** 더미가 7,000 이상을 들고 있으면 만점을 받아도 못 이기는 벽이 되고,
--     그러면 랭킹이 목표가 아니라 장식이 된다.
--   · skill 은 1,000 의 배수만 나온다 — 레벨 클리어당 +1,000 이고 부분점수가 없기 때문이다.
--     나머지는 활동 트랙이 메운다. rank(사다리 등급)도 그 규칙에서 파생한다(클리어 수 + 1, 최대 7).
--     ⚠️ 이 구조를 지켜야 카드의 ARENA Lv. 밴드와 등급 표시가 어긋나지 않는다.
--
-- ⚠️ 이름은 조합어다(형용사 32 × 명사 32 × 두 자리). 실존 인물로 읽히는 이름을 쓰지 않는다.
-- ⚠️ 아바타는 비워 둔다 — 실회원과 같은 규칙으로 프론트가 id 시드 젬 색을 만든다(avatar.ts).

-- 결정론적 해시. 같은 지역·같은 자리는 몇 번을 다시 깔아도 같은 사람이 된다.
create or replace function public.ranking_dummy_hash(p text)
returns bigint language sql immutable as $$
  select ('x' || substr(md5(p), 1, 8))::bit(32)::bigint
$$;

create or replace function public.seed_ranking_dummies(p_per_region int default 10)
returns int language plpgsql as $$
declare
  v_n int;
  -- 제일 잘하는 나라의 1등이 닿는 점수. ⛔ **7,000 미만이어야 한다** — 레벨테스트를 끝까지 깬
  --    실사용자(skill 7,000)가 무조건 위에 서야 랭킹이 넘을 수 있는 목표가 된다.
  v_peak numeric := 6400;
  v_adj text[] := array[
    'Neo','Zen','Ace','Sky','Ion','Lux','Vex','Nova','Echo','Onyx','Pyro','Aero',
    'Rune','Halo','Flux','Jade','Volt','Zeta','Iris','Sage','Vega','Wave','Xeno','Yuki',
    'Astra','Cobalt','Delta','Ember','Frost','Gale','Helix','Indigo'];
  v_noun text[] := array[
    'Fox','Owl','Ray','Ark','Bit','Cog','Elk','Fin','Gem','Hawk','Jet','Koi',
    'Lynx','Moth','Node','Orca','Pike','Quill','Reef','Sable','Tide','Vale','Wisp','Yak',
    'Comet','Drift','Falcon','Glide','Hazel','Ivory','Jolt','Kite'];
begin
  if p_per_region < 1 then raise exception 'p_per_region must be >= 1'; end if;

  -- 다시 깔 때는 통째로 갈아엎는다 — 부분 갱신을 하면 옛 값과 새 값이 섞여 어느 규칙으로 만든 건지 모른다.
  delete from ranking_dummies;

  insert into ranking_dummies
    (display_name, country_code, region_code, rank, skill_score, activity_score, character_key, skin)
  with pool as (
    -- 지역 버킷만 쓴다(국가 버킷은 그 나라 지역들의 합이라 같이 넣으면 사람이 두 배가 된다).
    -- country_code 가 없는 행은 어느 나라 탭에도 못 서므로 제외한다.
    select b.code, b.country_code, b.avg_level, i,
           -- 나라 안 줄 세우기용 예비 점수 — 좋은 지역일수록·앞자리일수록 위, 흔들기로 지역끼리 섞는다.
           -- ⚠️ 흔들기가 없으면 지역마다 똑같은 계단이 반복돼 보드가 기계처럼 보인다.
           b.avg_level
             * (case when p_per_region = 1 then 1
                     else 1 - 0.5 * (i - 1.0) / (p_per_region - 1.0) end)
             * (0.78 + (ranking_dummy_hash('j' || b.code || ':' || i) % 45) / 100.0) as raw
    from arena_seed_buckets b
    cross join generate_series(1, p_per_region) as i
    where b.scope = 'region' and b.country_code is not null
  ),
  ranked as (
    select p.*,
           row_number() over (partition by p.country_code order by p.raw desc, p.code, p.i) as rnk,
           count(*)     over (partition by p.country_code)                                   as cnt,
           -- 그 나라 대역의 꼭대기는 **그 나라에서 제일 좋은 지역**이 정한다.
           max(p.avg_level) over (partition by p.country_code)                               as country_top
    from pool p
  ),
  scored as (
    select r.*,
           greatest(0, least(6900, round(
             v_peak
             -- ① 나라 대역: 최고 지역 점수를 0.6제곱으로 압축(순서 유지, 간격 축소).
             * power(greatest(r.country_top, 1) / greatest((select max(avg_level) from arena_seed_buckets where scope='region'), 1), 0.6)
             -- ② 나라 안 하강: 위에서 급하고 아래로 완만. 꼴찌는 대역 꼭대기의 38%.
             * (1 - 0.62 * power((r.rnk - 1.0) / greatest(r.cnt - 1, 1), 0.35))
           )))::numeric as total
    from ranked r
  )
  select
    v_adj[1 + (ranking_dummy_hash('n' || s.code || ':' || s.i) % 32)]
      || v_noun[1 + (ranking_dummy_hash('m' || s.code || ':' || s.i) % 32)]
      || (10 + ranking_dummy_hash('d' || s.code || ':' || s.i) % 90)::text,
    s.country_code,
    s.code,
    least(7, (least(6000, floor(s.total / 1000) * 1000) / 1000)::int + 1),
    least(6000, floor(s.total / 1000) * 1000),
    s.total - least(6000, floor(s.total / 1000) * 1000),
    -- 캐릭터는 6종 중 하나. 5분의 1은 비워 둔다 — 아직 안 고른 사람이 섞여 있는 게 실제 모습이다.
    case when ranking_dummy_hash('c' || s.code || ':' || s.i) % 5 = 0 then null
         else (array['char_a_m','char_a_f','char_b_m','char_b_f','char_c_m','char_c_f'])
                [1 + (ranking_dummy_hash('c' || s.code || ':' || s.i) % 6)] end,
    -- 스킨은 산 사람만 갈아입는다 → 대부분 기본(null)이고 3분의 1만 밤 배경이다.
    case when ranking_dummy_hash('s' || s.code || ':' || s.i) % 3 = 0
         then 'skin_palace_night' else null end
  from scored s;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.seed_ranking_dummies(int) from public, anon, authenticated;

-- 지역당 10명 = /ranking '내 지역' 탭의 TOP 10 이 딱 찬다. 5명이면 보드가 반만 찬다.
select public.seed_ranking_dummies(10);
