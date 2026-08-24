-- 랭킹 더미 닉네임 — 나라별 문자 + 순위별 결 (2026-08-21)
--
-- 왜 다시 만드나
--   첫 판은 `ZenHawk36` 처럼 **형용사 + 명사 + 두 자리 숫자**가 100% 였다. 조합 수는 많았지만,
--   랭킹은 열 줄이 세로로 붙어 서는 화면이라 **패턴이 하나면 그게 그대로 보인다** —
--   열 명이 같은 모양의 이름을 달고 있으면 사람이 아니라 생성물로 읽힌다.
--
-- 세 가지를 바꾼다.
--   ① **나라별 문자** — 한국은 한글, 일본은 일본어, 중국·대만은 중국어, 인도·베트남은 그쪽 이름,
--      나머지는 영문. 국제 서비스 랭킹은 실제로 문자가 섞여 있고, 전부 영문이면
--      "미국 서비스에 외국인이 좀 있는" 그림이 된다.
--   ② **게임·SNS 닉네임 어휘** — 시적인 조합(별빛나그네)이 아니라 사람들이 실제로 쓰는 말이다.
--      짧고 센 것(흑염룡·Vortex·夜叉), 자조적인 것(야근하는코더·摸鱼中·sleepykid),
--      이름+태그(ArjunOP·MinhZ) 를 섞는다.
--   ③ **순위별로 결이 다르다** — ⚠️ 이게 제일 중요하다. 상위권은 **랭킹 화면에 실제로 뜨는 얼굴**이라
--      나라 안 5등까지는 짧고 강한 단독 닉네임을 주고, 그 아래는 조합·숫자·자조형을 준다.
--      실제 랭킹이 그렇게 생겼다 — 위로 갈수록 이름이 정제돼 있다.
--
-- ⚠️ 닉네임 12자 제한(실회원 규칙)을 넘지 않게 골랐다. 넘으면 화면에서 말줄임된다.
-- ⚠️ 실존 인물로 읽히는 이름을 쓰지 않는다 — 인도·베트남 칸은 그 나라에서 흔한 **이름 형태**일 뿐
--    특정인을 가리키지 않고, 성(姓)을 붙이지 않는다.
-- ⚠️ 결정론은 그대로다 — 같은 지역·같은 자리는 몇 번을 다시 깔아도 같은 사람이 된다.

create or replace function public.seed_ranking_dummies(p_per_region int default 10)
returns int language plpgsql as $$
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
    select b.code, b.country_code, b.avg_level, i,
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
end $$;

revoke all on function public.seed_ranking_dummies(int) from public, anon, authenticated;

select public.seed_ranking_dummies(10);
