-- 2026-09-04 · 아레나 버킷 두 표 정리 (2026-09-04 지시)
--
--   ⛔ **두 표를 합치지 않는다.** arena_bucket_scores 는 5분마다 통째로 덮어써지는 계산 결과라
--      집계 함수 끝에 `delete ... where updated_at < t0` 가 있다. 한 표로 합치면 그 delete 가
--      시드까지 지운다 — 시드는 사람이 만들어 넣은 값이라 날아가면 복구가 안 된다.
--
--   ① label 드롭 (양쪽) — 3,676건씩 **전부 비어 있었다.** 지역 이름을 담으려던 칸인데 화면이
--      사전(i18n)에서 이름을 가져와서 안 쓴다. 마지막 소비처였던 학교 버킷은 오늘 없앴다
--      (20260904140000) — 그래서 이제 완전히 죽었다.
--
--   ② participation 드롭 — 순위식 `bayes × participation` 은 **일간(daily) 창에서만** 쓰이는데
--      부르는 곳이 없다. 화면 셋(WorldArena 국가·지역, RankGlobe)이 전부 `window:'season'` 이고
--      시즌 창은 bayes 만 본다. 값은 응답에 실려 나갔지만 순위에도 화면에도 안 쓰였다.
--      ⛔ 일간 랭킹을 되살릴 거면 이 칸을 되살리지 말고 **그때 계산**할 것
--         (active_today / member_count 라 언제든 만든다). 안 쓰는 파생값을 저장해 두면 또 이렇게 남는다.
--
--   ③ has_real 드롭 — `real_members > 0` 인 파생값이다. 화면의 '실데이터' 배지는 2026-08-25 에 뗐고
--      (한국에만 떠서, 나머지 나라는 실데이터가 아니라고 우리가 먼저 광고하는 꼴이었다) 그 뒤로는
--      아무도 안 그린다.
--      ⛔ **숫자(real_members)는 남긴다.** 불린은 숫자에서 언제든 만들지만 반대는 안 되고,
--         운영에서 알고 싶은 건 "있냐 없냐" 가 아니라 "몇 명이냐" 다 — member_count 에는 가짜가
--         섞여 있어서(KR 1,071명 중 진짜 13명) 그 숫자만으로는 실사용자 수를 알 방법이 없다.
--
--   ④ country_code → parent_code 개명 (양쪽) — 한 표에 국가 줄과 지역 줄이 같이 있는데
--      국가 줄에선 이 칸이 무의미했다(자기가 나라다). 값은 그대로고 이름만 사실을 말하게 바꾼다:
--        scope=country  code=KR      parent_code=null
--        scope=region   code=KR-11   parent_code=KR
--      ⚠️ profiles.country_code(그 사람의 국가)와 헷갈리던 것도 같이 해결된다 — 그건 안 건드린다.
--
--   ⑤ 소수점 한 자리로 (2026-09-04 지시 — "지금 소수점 너무 김")
--        avg_level  2536.0952     → 2536.1
--        bayes      2494.459442   → 2494.5
--      ⚠️ 저장·집계·RPC 출력 세 곳을 같이 맞춘다. 한 곳만 고치면 화면과 DB 가 다른 자릿수를 말한다.

begin;

-- ── 컬럼 ──────────────────────────────────────────────────────────
alter table arena_seed_buckets  drop column if exists label;
alter table arena_bucket_scores drop column if exists label;
alter table arena_bucket_scores drop column if exists participation;
alter table arena_bucket_scores drop column if exists has_real;

alter table arena_seed_buckets  rename column country_code to parent_code;
alter table arena_bucket_scores rename column country_code to parent_code;

update arena_bucket_scores set avg_level = round(avg_level, 1), bayes = round(bayes, 1);

-- ── 집계 함수 ─────────────────────────────────────────────────────
create or replace function public.refresh_arena_buckets()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer;
  t0 timestamptz := clock_timestamp();
begin
  -- 두 번이 겹쳐 돌면 안 된다. 아래 청소가 "이번 실행(t0)보다 오래된 행"을 지우는데, 겹치면
  -- 나중 실행이 앞 실행의 결과를 지워 스냅샷이 반쪽이 된다(지구본이 군데군데 캄캄해진다).
  perform pg_advisory_xact_lock(hashtext('refresh_arena_buckets'));

  with active as (
    select user_id from active_today_user_ids() as t(user_id)
  ),
  -- 실집계 — 스코프별로 같은 모양(code·parent_code·members·avg·active)으로 모은다.
  --   2026-09-04 에 'school' 스코프와 label 을 뺐다(학교 기능 제거 · 이름은 사전이 만든다).
  real_rows as (
    select 'country'::text as scope, pr.country_code as code, null::text as parent_code,
           count(*)::int as members, avg(up.season_total)::numeric as avg_level,
           count(*) filter (where a.user_id is not null)::int as active_today
    from profiles pr
    join user_progress up on up.user_id = pr.id
    left join active a on a.user_id = pr.id
    where pr.deactivated_at is null and pr.is_anonymous = false and pr.country_code is not null
    group by pr.country_code
    union all
    select 'region', pr.region_code, pr.country_code,
           count(*)::int, avg(up.season_total)::numeric,
           count(*) filter (where a.user_id is not null)::int
    from profiles pr
    join user_progress up on up.user_id = pr.id
    left join active a on a.user_id = pr.id
    where pr.deactivated_at is null and pr.is_anonymous = false
      and pr.country_code is not null and pr.region_code is not null
    group by pr.region_code, pr.country_code
  ),
  -- 시드 + 실집계 가중평균. full outer join 이라 시드만 있는 나라도, 시드 없는 신규 버킷도 다 남는다.
  merged as (
    select
      coalesce(s.scope, r.scope)                                              as scope,
      coalesce(s.code,  r.code)                                               as code,
      coalesce(r.parent_code, s.parent_code)                                  as parent_code,
      (coalesce(s.member_count,0) + coalesce(r.members,0))                    as member_count,
      case when coalesce(s.member_count,0) + coalesce(r.members,0) = 0 then 0
           else (coalesce(s.member_count,0) * coalesce(s.avg_level,0)
               + coalesce(r.members,0)      * coalesce(r.avg_level,0))
              / (coalesce(s.member_count,0) + coalesce(r.members,0))
      end                                                                     as avg_level,
      (coalesce(s.active_today,0) + coalesce(r.active_today,0))               as active_today,
      coalesce(r.members,0)                                                   as real_members
    from arena_seed_buckets s
    full outer join real_rows r on r.scope = s.scope and r.code = s.code
  ),
  -- 프라이버시 floor. 집계값으로 개인이 드러나지 않게 **합쳐진 인원** 5명 미만 버킷은 뺀다.
  kept as (
    select * from merged where member_count >= 5
  ),
  -- 사전분포(prior) — 스코프 안 전체 평균. **인원 가중**으로 낸다(버킷 단순평균이면 소국이 과대대표된다).
  prior as (
    select scope,
           case when sum(member_count) = 0 then 0
                else sum(member_count * avg_level) / sum(member_count) end as global_avg
    from kept group by scope
  ),
  scored as (
    select k.*,
           -- K=25 베이지안 shrinkage — 인원이 적은 버킷이 운으로 1등 하는 걸 막는다.
           (k.member_count * k.avg_level + 25 * p.global_avg) / (k.member_count + 25) as bayes
    from kept k join prior p on p.scope = k.scope
  ),
  upserted as (
    insert into arena_bucket_scores as t
      (scope, code, parent_code, member_count, avg_level, active_today, bayes, real_members, updated_at)
    -- 소수점 한 자리다(2026-09-04). RPC 출력도 같은 자릿수다 — 한쪽만 고치지 말 것.
    select scope, code, parent_code, member_count, round(avg_level, 1), active_today,
           round(bayes, 1), real_members, t0
    from scored
    on conflict (scope, code) do update set
      parent_code   = excluded.parent_code,
      member_count  = excluded.member_count,
      avg_level     = excluded.avg_level,
      active_today  = excluded.active_today,
      bayes         = excluded.bayes,
      real_members  = excluded.real_members,
      updated_at    = excluded.updated_at
    returning t.scope, t.code
  )
  select count(*)::int into n from upserted;

  -- 이번 갱신에 안 들어온 행 청소(시드를 지웠거나 floor 아래로 내려간 버킷).
  -- now() 가 아니라 t0(이번 실행 시각)로 판별한다 — now() 는 트랜잭션 시작 시각이라 upsert 가
  -- 찍은 값과 같아져서 조건이 한 행도 안 잡거나 전부 잡는다.
  delete from arena_bucket_scores where updated_at < t0;

  return n;
end;
$function$;

-- ── 리더보드 RPC 둘 ───────────────────────────────────────────────
--   2026-09-04 에 participation·has_real 을 응답에서 뺐다(둘 다 안 쓰였다).
--   ⛔ 일간(daily) 창은 `bayes × participation` 이었는데 부르는 곳이 없어 시즌 하나로 접었다.
--      되살릴 거면 여기서 active_today / member_count 로 그때 계산할 것.
--   ⚠️ p_window 인자는 남긴다 — 배포 전 엣지 함수가 그 이름으로 계속 넘긴다(빼면 함수를 못 찾는다).
create or replace function public.region_leaderboard(p_country text default 'KR'::text, p_window text default 'season'::text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
select coalesce(jsonb_agg(jsonb_build_object(
    'code',         code,
    'member_count', member_count,
    'avg_level',    round(avg_level, 1),
    'active_today', active_today,
    'score',        round(bayes, 1)
  ) order by bayes desc), '[]'::jsonb)
from arena_bucket_scores where scope = 'region' and parent_code = p_country;
$function$;

create or replace function public.country_leaderboard(p_window text default 'season'::text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
select coalesce(jsonb_agg(jsonb_build_object(
    'code',         code,
    'member_count', member_count,
    'avg_level',    round(avg_level, 1),
    'active_today', active_today,
    'score',        round(bayes, 1)
  ) order by bayes desc), '[]'::jsonb)
from arena_bucket_scores where scope = 'country';
$function$;


-- ── 더미 재생성 함수도 같은 개명을 탄다 ───────────────────────────
--   arena_seed_buckets 를 읽어 ranking_dummies 를 다시 만든다. CTE 에서 별칭을 country_code 로
--   되돌려 놓아서(parent_code as country_code) 아래 350줄은 한 글자도 안 바뀐다 —
--   그 아래가 쓰는 country_code 는 **ranking_dummies 의 그 사람 국가**라 이름이 맞다.

create or replace function public.seed_ranking_dummies(p_per_region integer DEFAULT 10)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  v_n int;
  v_i int;
  v_fixed int;
  -- 제일 잘하는 나라의 1등이 닿는 점수. ⛔ **7,000 미만이어야 한다** — 레벨테스트를 끝까지 깬
  --    실사용자(skill 7,000)가 무조건 위에 서야 랭킹이 넘을 수 있는 목표가 된다.
  v_peak numeric := 6400;

  -- ── 영문(기본) — 위 권역에 안 걸리는 나라 전부 ──
  -- 상위권용 단독 닉네임 24개. 짧고 세게.
  v_en_top text[] := array['Vortex','Blitz','Rogue','Havoc','Reaper','Phantom','Venom','Cipher',
                           'Rift','Surge','Ronin','Saber','Nomad','Jinx','Onyx','Wraith',
                           'Talon','Zenith','Kaido','Nyx','Volt','Fable','Requiem','Sable',
                           'Ashen','Bane','Crux','Dusk','Ember','Flint','Grim','Hexa',
                           'Ibex','Jolt','Lumen','Mirage','Nova','Orbit','Prism','Quasar',
                           'Raven','Slate','Tempest','Umbra','Vega','Wisp','Zephyr','Echo',
                           'Frost','Ghost','Halo','Iris','Kite','Lyra','Mako','Nero',
                           'Odin','Pyre','Quill','Rune','Solace','Tyr','Vesper','Wren'];
  v_en1 text[] := array['shadow','night','dark','iron','storm','frost','blaze','swift',
                        'silent','ghost','lucky','salty','sleepy','coffee','pixel','rusty',
                        'quiet','feral','solar','hollow','velvet','brisk','murky','tidal'];
  v_en2 text[] := array['fox','wolf','hawk','blade','cat','byte','moon','wave',
                        'star','king','bear','dust','rain','ash','kid','crow',
                        'reef','vine','lark','pine','thorn','dawn','myth','opal'];

  -- ── 한국어 ──
  v_ko_top text[] := array['흑염룡','그믐','무영','청룡','백호','칼바람','은하수','적토마',
                           '야차','초승달','폭풍','검은늑대','새벽비','한손검','무명검객','별똥별',
                           '잠룡','화룡','서리검','낙월','천둥','붉은달','설야','고요',
                           '월광','흑조','파천','검그림자','북두','한서리','비류','청명',
                           '무월','적화','설풍','야행','백야','천화','묵검','한빛',
                           '뇌호','겨울잠','장미검','고독','바람길','흑랑','서리꽃','도현'];
  v_ko1 text[] := array['졸린','배고픈','야근하는','커피중독','오늘도','그냥','지나가던','소심한',
                        '심심한','열심히','대충','노력형','초보','방구석','잠못드는','밤샘하는',
                        '집에가고픈','조용한','떠도는','게으른','수줍은','서툰','달리는','웃는'];
  v_ko2 text[] := array['고양이','너구리','코더','학생','개발자','직장인','집순이','여행자',
                        '검객','마법사','궁수','기사','도적','상인','농부','수달',
                        '토끼','까마귀','늑대','강아지','거북','다람쥐','하마','오리'];

  -- ── 일본어 ──
  v_ja_top text[] := array['無双','雷神','朧','刹那','千鳥','紅蓮','蒼天','黒猫',
                           '月影','陽炎','疾風','夜叉','白狼','影狼','零','雪風',
                           '烈火','霜月','孤月','天狼','蜃気楼','静寂','閃','宵',
                           '風斬','黎明','紺碧','夕凪','雷光','薄氷','紫電','影虎',
                           '氷刃','緋色','空蝉','無明','千夜','雪解','焔','鴉'];
  v_ja1 text[] := array['ゆるふわ','まったり','ねむい','さくら','ゆうき','ほし','かぜ','みどり',
                        'つばさ','ひかり','なつ','あおい','ゆき','そら','つき','うみ',
                        'もり','ゆめ','はな','りん','あき','しろ','こはる','なぎ'];
  v_ja2 text[] := array['猫','丸','風','空','星','犬','雲','海',
                        'の子','さん','屋','鳥','道','音','光','夜'];

  -- ── 중국어(간체·번체 권역) ──
  v_zh_top text[] := array['逐日','孤影','一刀','无名','剑心','夜枭','星陨','破军',
                           '沧海','疾风','白夜','墨影','长夜','千山','归途','断水',
                           '不渡','听雪','半城','孤舟','南山','初雪','拾光','晚风',
                           '青锋','浮生','独钓','山海','折戟','惊蛰','逆水','无归',
                           '寒江','孤鸿','踏雪','云深','点墨','旧梦','霜天','长风'];
  v_zh1 text[] := array['今天也很困','摸鱼中','想睡觉','小白龙','星辰','清风','云海','墨雨',
                        '竹林','飞鸟','明月','苍狼','青山','夜航','白鹭','长歌',
                        '无声','半夏','归鸿','淡墨','疏影','流云','听雨','木子'];

  -- ── 인도 권역 — 실제로 영문 표기 닉네임 + 게임 태그가 흔하다 ──
  v_hi1 text[] := array['Aarav','Rohan','Arjun','Kabir','Ishaan','Vihaan','Dev','Aryan',
                        'Karan','Rudra','Neha','Diya','Riya','Tara','Meera','Ananya',
                        'Saanvi','Aditi','Kiara','Myra','Advait','Reyansh','Veer','Anika'];
  v_hi_tag text[] := array['OP','GG','YT','Pro','X','Z','FF','TT'];

  -- ── 베트남 ──
  v_vi1 text[] := array['Minh','Linh','Huy','Nam','Bao','Duy','Khanh','Phuc',
                        'Quan','Tuan','Ngoc','Thao','Mai','Vy','Son','Anh',
                        'Hieu','Trang','Lan','Chi','Dat','Long','Ha','Thu'];
  v_vi_tag text[] := array['Z','X','Pro','vn','GG','k','OP','TV'];
begin
  if p_per_region < 1 then raise exception 'p_per_region must be >= 1'; end if;

  delete from ranking_dummies;

  insert into ranking_dummies
    (display_name, country_code, region_code, rank, skill_score, activity_score, character_key, skin)
  with pool as (
    select b.code, b.parent_code as country_code, b.avg_level, i,
           b.avg_level
             * (case when p_per_region = 1 then 1
                     else 1 - 0.5 * (i - 1.0) / (p_per_region - 1.0) end)
             * (0.78 + (ranking_dummy_hash('j' || b.code || ':' || i) % 45) / 100.0) as raw
    from arena_seed_buckets b
    cross join generate_series(1, p_per_region) as i
    where b.scope = 'region' and b.parent_code is not null
  ),
  ranked as (
    select p.*,
           row_number() over (partition by p.country_code order by p.raw desc, p.code, p.i) as rnk,
           count(*)     over (partition by p.country_code)                                   as cnt,
           max(p.avg_level) over (partition by p.country_code)                               as country_top
    from pool p
  ),
  scored as (
    select r.*,
           greatest(0, least(6900, round(
             v_peak
             * power(greatest(r.country_top, 1) / greatest((select max(avg_level) from arena_seed_buckets where scope='region'), 1), 0.6)
             * (1 - 0.62 * power((r.rnk - 1.0) / greatest(r.cnt - 1, 1), 0.35))
           )))::numeric as total,
           -- 문자 권역. 우리 서비스 6개국어와 같은 구분이고, 나머지는 전부 영문이다.
           case
             when r.country_code in ('KR','KP')                then 'ko'
             when r.country_code = 'JP'                        then 'ja'
             when r.country_code in ('CN','TW','HK','MO','SG') then 'zh'
             when r.country_code in ('IN','NP')                then 'hi'
             when r.country_code = 'VN'                        then 'vi'
             else 'en'
           end as lang,

           -- ⚠️ **상위권 이름은 나라 안에서 풀을 순회해 배정한다.** 해시로 뽑으면 같은 나라 안에서
           --    겹치고(미국은 상위권이 수십 명이다) 그때마다 숫자가 붙어 `Rift67`·`Crux36` 이 된다.
           --    나라마다 시작 위치를 다르게 두고 등수마다 풀 크기와 서로소인 만큼 건너뛰면, 한 바퀴 도는
           --    동안 **절대 안 겹치면서** 순서도 흩어진다(스텝 1이면 풀에 적은 순서가 그대로 보인다).
           (ranking_dummy_hash('cc' || r.country_code))          as coff,
           (ranking_dummy_hash('p' || r.code || ':' || r.i) % 10) as pat,
           (ranking_dummy_hash('n' || r.code || ':' || r.i))      as h1,
           (ranking_dummy_hash('m' || r.code || ':' || r.i))      as h2,
           (ranking_dummy_hash('d' || r.code || ':' || r.i))      as h3
    from ranked r
  )
  select
    case s.lang
      -- ── 한국어 ──
      when 'ko' then
        case
          when (s.rnk <= 5 or s.total >= 4800) then v_ko_top[1 + ((s.coff + s.rnk * 17) % 48)]
          when s.pat < 4 then v_ko1[1 + (s.h1 % 24)] || v_ko2[1 + (s.h2 % 24)]
          when s.pat < 6 then v_ko2[1 + (s.h2 % 24)] || (10 + s.h3 % 90)::text
          when s.pat < 8 then v_ko_top[1 + (s.h1 % 48)] || v_ko2[1 + (s.h2 % 24)]
          else                v_ko1[1 + (s.h1 % 24)] || v_ko2[1 + (s.h2 % 24)] || (10 + s.h3 % 90)::text
        end
      -- ── 일본어 ──
      when 'ja' then
        case
          when (s.rnk <= 5 or s.total >= 4800) then v_ja_top[1 + ((s.coff + s.rnk * 17) % 40)]
          when s.pat < 4 then v_ja1[1 + (s.h1 % 24)] || v_ja2[1 + (s.h2 % 16)]
          when s.pat < 6 then v_ja1[1 + (s.h1 % 24)] || (10 + s.h3 % 90)::text
          when s.pat < 8 then v_ja1[1 + (s.h1 % 24)]
          else                v_ja_top[1 + (s.h1 % 40)] || v_ja2[1 + (s.h2 % 16)]
        end
      -- ── 중국어 ──
      when 'zh' then
        case
          when (s.rnk <= 5 or s.total >= 4800) then v_zh_top[1 + ((s.coff + s.rnk * 17) % 40)]
          when s.pat < 5 then v_zh1[1 + (s.h1 % 24)]
          when s.pat < 8 then v_zh1[1 + (s.h1 % 24)] || (10 + s.h3 % 90)::text
          else                v_zh_top[1 + (s.h1 % 40)] || v_zh_top[1 + (s.h2 % 40)]
        end
      -- ── 인도 권역 ──
      when 'hi' then
        case
          when (s.rnk <= 5 or s.total >= 4800) and s.pat < 5 then v_hi1[1 + ((s.coff + s.rnk * 7) % 24)] || v_hi_tag[1 + (s.h2 % 8)]
          when (s.rnk <= 5 or s.total >= 4800)               then v_hi1[1 + ((s.coff + s.rnk * 7) % 24)]
          when s.pat < 3 then v_hi1[1 + (s.h1 % 24)] || (10 + s.h3 % 90)::text
          when s.pat < 5 then v_hi1[1 + (s.h1 % 24)] || '_' || v_hi_tag[1 + (s.h2 % 8)]
          when s.pat < 7 then lower(v_hi1[1 + (s.h1 % 24)]) || v_en2[1 + (s.h2 % 24)]
          else                v_hi1[1 + (s.h1 % 24)] || v_hi_tag[1 + (s.h2 % 8)]
        end
      -- ── 베트남 ──
      when 'vi' then
        case
          when (s.rnk <= 5 or s.total >= 4800) and s.pat < 5 then v_vi1[1 + ((s.coff + s.rnk * 7) % 24)] || v_vi_tag[1 + (s.h2 % 8)]
          when (s.rnk <= 5 or s.total >= 4800)               then v_vi1[1 + ((s.coff + s.rnk * 7) % 24)] || v_vi1[1 + (s.h2 % 24)]
          when s.pat < 3 then v_vi1[1 + (s.h1 % 24)] || (10 + s.h3 % 90)::text
          when s.pat < 6 then v_vi1[1 + (s.h1 % 24)] || v_vi1[1 + (s.h2 % 24)]
          when s.pat < 8 then lower(v_vi1[1 + (s.h1 % 24)]) || '_' || lower(v_vi1[1 + (s.h2 % 24)])
          else                v_vi1[1 + (s.h1 % 24)] || v_vi_tag[1 + (s.h2 % 8)]
        end
      -- ── 영문(기본) ──
      else
        case
          when (s.rnk <= 5 or s.total >= 4800) then v_en_top[1 + ((s.coff + s.rnk * 23) % 64)]
          when s.pat < 3 then v_en1[1 + (s.h1 % 24)] || v_en2[1 + (s.h2 % 24)]
          when s.pat = 3 then initcap(v_en1[1 + (s.h1 % 24)]) || initcap(v_en2[1 + (s.h2 % 24)])
          when s.pat = 4 then v_en1[1 + (s.h1 % 24)] || (10 + s.h3 % 90)::text
          when s.pat = 5 then v_en1[1 + (s.h1 % 24)] || '_' || v_en2[1 + (s.h2 % 24)]
          when s.pat = 6 then v_en2[1 + (s.h2 % 24)] || (10 + s.h3 % 90)::text
          when s.pat = 7 then v_en1[1 + (s.h1 % 24)] || '.' || v_en2[1 + (s.h2 % 24)]
          when s.pat = 8 then v_en1[1 + (s.h1 % 24)] || 'x' || v_en2[1 + (s.h2 % 24)]
          else                v_en_top[1 + (s.h1 % 64)] || v_en2[1 + (s.h2 % 24)]
        end
    end,
    s.country_code,
    s.code,
    least(7, (least(6000, floor(s.total / 1000) * 1000) / 1000)::int + 1),
    least(6000, floor(s.total / 1000) * 1000),
    s.total - least(6000, floor(s.total / 1000) * 1000),
    -- 캐릭터는 **전원 갖는다.**
    --   ⚠️ 실회원 중에는 캐릭터 미선택이 실제로 있다(캐릭터 선택은 /hub 첫 진입에서만 강제되는데,
    --      레벨테스트만 응시해도 점수가 생겨 랭킹에 서기 때문이다 — 실측 8명 중 3명이 그랬다).
    --      그래서 처음엔 5분의 1을 비워 실제와 닮게 뒀는데, 비워두면 그 자리가 **전부 같은 기본 그림**이라
    --      랭킹·남의 방에서 그것만 눈에 띈다. 더미는 "이미 자리 잡은 사람들" 이라 다 꾸민 게 자연스럽다.
    (array['char_a_m','char_a_f','char_b_m','char_b_f','char_c_m','char_c_f'])
      [1 + (ranking_dummy_hash('c' || s.code || ':' || s.i) % 6)],
    case when ranking_dummy_hash('s' || s.code || ':' || s.i) % 3 = 0
         then 'skin_palace_night' else null end
  from scored s;

  get diagnostics v_n = row_count;

  -- ⚠️ **같은 이름이 랭킹에 두 번 뜨는 것만은 막는다.** 상위권 풀을 키워도 해시가 겹치면
  --    `Rift` 가 4위와 17위에 나란히 서는데, 한 화면에 같은 이름이 둘이면 그것만으로 생성물이 된다.
  --    점수가 높은 쪽이 원래 이름을 갖고, 아래쪽에만 숫자를 붙인다(12자 제한 때문에 앞을 자른다).
  --   ⚠️ 숫자를 붙인 결과가 **또** 다른 이름과 겹칠 수 있어(1차만 돌리면 1,099종이 남았다)
  --      더 안 줄어들 때까지 돌린다. 회차를 해시 씨앗에 넣어야 같은 값이 반복되지 않는다.
  for v_i in 1..8 loop
    --   ⚠️ 누가 원래 이름을 지키냐는 **나라 안 등수**가 먼저다. 전세계 점수로만 정하면
    --      작은 나라 1등이 큰 나라 30등에게 이름을 뺏겨, 그 나라 랭킹 맨 윗줄에 숫자가 붙는다
    --      (실제로 211개국 중 168개국 1등이 그랬다). 나라 1등은 어느 나라든 깨끗한 이름을 갖는다.
    --   ⚠️ **겹쳐 보이는 자리에서만 고친다.** 나라가 다르면 서로 다른 보드라 같은 이름이어도
    --      한 화면에 같이 서지 않는다. 전역 유니크를 강제하면 그 대가로 작은 나라 1등이
    --      숫자를 달게 되는데(211개국 중 125개국이 그랬다), 그건 그 나라 랭킹 맨 윗줄이다.
    --      그래서 고치는 대상은 ① 같은 나라 안에서 뒤에 선 사람 ② 전세계 상위 300 안 둘뿐이다.
    with r as (
      select id, display_name, season_total, country_code,
             row_number() over (partition by country_code order by season_total desc, id) as crank,
             row_number() over (order by season_total desc, id)                           as grank
      from ranking_dummies
    ),
    --      두 규칙은 **누가 이름을 지키는지가 다르다.**
    --        · 전세계 상위 300 안 → **전세계 순위**가 높은 쪽이 지킨다. 여기가 화면에 뜨는 자리라서다.
    --          ⚠️ 나라 안 등수를 우선하면 미국 3위가 아무 소국 1등에게 이름을 뺏겨
    --            `Nova70`·`Orbit51` 처럼 TOP 10 이 통째로 숫자를 달게 된다(실제로 그랬다).
    --        · 같은 나라 안 → **나라 안 등수**가 높은 쪽이 지킨다. 그 보드의 윗줄을 지키는 것이다.
    dup_global as (
      select id, row_number() over (partition by display_name order by grank) as k
      from r where grank <= 300
    ),
    dup_country as (
      select id, row_number() over (partition by country_code, display_name order by crank) as k
      from r
    )
    update ranking_dummies d
       set display_name = left(d.display_name, 9)
                          || (10 + (ranking_dummy_hash('u' || v_i || ':' || d.id::text) % 90))::text
      from dup_country dc left join dup_global dg on dg.id = dc.id
     where dc.id = d.id
       and (dc.k > 1 or coalesce(dg.k, 1) > 1);
    get diagnostics v_fixed = row_count;
    exit when v_fixed = 0;
  end loop;

  return v_n;
end $function$
;

commit;
