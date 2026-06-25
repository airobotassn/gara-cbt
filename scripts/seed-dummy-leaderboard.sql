-- ============================================================
-- GARA · 더미 리더보드 시드 (생성 + 6개국어 닉네임 현지화) — 통합본
-- ------------------------------------------------------------
-- PART A) 더미 1000명 생성 (이상적 종형 분포)
--         분포: L1=80 L2=170 L3=240 L4=230 L5=150 L6=90 L7=40 (합계 1000)
-- PART B) 그 더미들의 닉네임을 6개국어 현지화 실명풍으로 교체
--
-- 사용법: Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run.
--         (SQL Editor 는 service role 권한이라 RLS·auth.users 직접 쓰기 가능)
-- ⚠️ 한 번만 실행할 것. 재실행하면 또 1000명이 추가된다.
-- ⚠️ 롤백(전부 삭제)은 파일 맨 아래 주석의 DELETE 한 줄.
--
-- 동작: auth.users 를 만들면 on_auth_user_created 트리거가 profiles 를 자동 생성
--       (full_name→display_name, avatar_url→'gem:색'). 그 위에 user_progress(등급)
--       와 user_level_skill(레벨별 6축 레이팅)을 얹어 리더보드가 채워진다.
--       PART B 가 display_name 을 현지화 실명으로 덮어쓴다.
-- ============================================================


-- ============================================================
-- PART A · 더미 1000명 생성
-- ============================================================

-- A1) 더미 명세를 임시 테이블에 펼친다 (id 를 단계 간 재사용하기 위함)
create temporary table _dummy as
with
  dist(level, n) as (
    values (1,80),(2,170),(3,240),(4,230),(5,150),(6,90),(7,40)
  ),
  axes(level, keys) as (
    values
      (1, array['l1_principle','l1_security','l1_ethics','l1_responsibility','l1_llm_eco','l1_prompt']),
      (2, array['l2_genai','l2_api','l2_algo','l2_sensor','l2_block','l2_python']),
      (3, array['l3_rag','l3_llm_ctrl','l3_vision_eval','l3_vision_data','l3_c_basic','l3_c_adv']),
      (4, array['l4_preproc','l4_stm32','l4_ros2','l4_plc','l4_sim','l4_smartfactory']),
      (5, array['l5_reasoning','l5_edge','l5_iiot','l5_dtwin','l5_sysopt','l5_ros2']),
      (6, array['l6_swarm','l6_hrc','l6_dtwin','l6_orchestration','l6_process_opt','l6_robosec']),
      (7, array['l7_semicon','l7_qsecnet','l7_agi','l7_dynamics','l7_perception','l7_tmp'])
  ),
  lit(adj, noun, gem) as (
    values (
      array['빛나는','용감한','조용한','날쌘','전설의','수상한','배고픈','행복한','게으른','똑똑한','우주의','무적의','잠자는','번개','강철','황금','은하수','심야','폭풍','새벽'],
      array['AI마스터','프롬프트','로봇','코더','뉴런','알고리즘','젬','파이썬','토큰','에이전트','센서','벡터','회로','드론','커널','픽셀'],
      array['#7cc6ff','#ffb0c4','#9be5b3','#ffd36e','#c3b1ff','#7fded0','#ff9d8a','#b8c2ff']
    )
  ),
  slots as (
    select d.level, gs as seq, gen_random_uuid() as uid
    from dist d cross join generate_series(1, d.n) gs
  )
select
  s.uid,
  s.level,
  -- 닉네임: 형용사 + 명사 + 번호 (PART B 에서 현지화 실명으로 덮어씀)
  ( (l.adj)[1 + floor(random()*cardinality(l.adj))::int] || ' '
    || (l.noun)[1 + floor(random()*cardinality(l.noun))::int]
    || lpad((1 + floor(random()*999))::int::text, 3, '0') ) as name,
  -- 젬 색
  (l.gem)[1 + floor(random()*cardinality(l.gem))::int] as color,
  -- 6축 레이팅: 행마다 기준점(base) ±15 흔들어 5~100 클램프 → 리더보드 줄세움에 스프레드
  ( select jsonb_object_agg(
             k,
             greatest(5, least(100, round(b.base + (random()*30 - 15))))::int
           )
      from unnest(a.keys) k ) as ratings,
  (1 + floor(random()*40))::int as attempts,
  (now() - (random()*180 || ' days')::interval) as joined_at
from slots s
join axes a on a.level = s.level
cross join lit l
cross join lateral (select 40 + random()*50 as base) b;

-- A2) auth.users 생성 → 트리거가 profiles 자동 생성
--     raw_app_meta_data 에 dummy:true 마킹(나중에 일괄 삭제용)
insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000',
  d.uid, 'authenticated', 'authenticated',
  'dummy+' || d.uid || '@gara.local',
  crypt('gara-dummy', gen_salt('bf')),
  d.joined_at,
  '{"provider":"email","providers":["email"],"dummy":true}'::jsonb,
  jsonb_build_object('full_name', d.name, 'avatar_url', 'gem:' || d.color),
  d.joined_at, now(),
  '', '', '', ''
from _dummy d;

-- A3) 현재 등급(= 레벨)
insert into user_progress (user_id, rank, updated_at)
select d.uid, d.level, now() from _dummy d
on conflict (user_id) do update set rank = excluded.rank, updated_at = now();

-- A4) 레벨별 누적 6축 레이팅
insert into user_level_skill (user_id, level, ratings, attempts_count, placed, updated_at)
select d.uid, d.level, d.ratings, d.attempts, true, now() from _dummy d
on conflict (user_id, level) do update
  set ratings = excluded.ratings, attempts_count = excluded.attempts_count, placed = true, updated_at = now();

drop table _dummy;


-- ============================================================
-- PART B · 더미 닉네임을 6개국어 현지화 실명풍으로 교체
--  - 각 더미에 ko/en/ja/zh/hi/vi 중 하나를 무작위 배정
--  - 성+이름 풀을 조합 (숫자 꼬리표 없음)
--  - 동/서 어순 처리: ko·ja·zh = 성+이름(붙임), en·hi = 이름 성, vi = 성 이름
--  - profiles.display_name 만 갱신(리더보드가 읽는 값). auth.users 는 건드리지 않음.
-- ============================================================
with locales(loc, surnames, givens, mode) as (
  values
  -- 0) 한국어
  (0,
   array['김','이','박','최','정','강','조','윤','장','임','한','오','서','신','권','황','안','송','류','홍'],
   array['민준','서연','도윤','하은','지후','예은','시우','지아','주원','수아','지호','하준','서윤','예준','지유','건우','수빈','현우','다은','우진','채원','민서','준서','지민'],
   'east'),
  -- 1) 영어
  (1,
   array['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Wilson','Anderson','Taylor','Thomas','Moore','Martin','Lee','Clark','Walker','Hall','Young','King'],
   array['James','Emma','Liam','Olivia','Noah','Ava','William','Sophia','Benjamin','Isabella','Lucas','Mia','Henry','Charlotte','Jack','Amelia','Owen','Harper','Leo','Ella'],
   'given_first'),
  -- 2) 일본어
  (2,
   array['佐藤','鈴木','高橋','田中','伊藤','渡辺','山本','中村','小林','加藤','吉田','山田','佐々木','松本','井上','木村','林','清水','森','池田'],
   array['翔太','陽菜','大翔','結衣','蓮','葵','悠斗','凛','颯太','美咲','樹','さくら','健','七海','拓海','美羽','悠真','莉子','陽斗','花'],
   'east'),
  -- 3) 중국어
  (3,
   array['王','李','张','刘','陈','杨','黄','赵','周','吴','徐','孙','马','朱','胡','郭','何','高','林','罗'],
   array['伟','娜','敏','静','磊','洋','艳','勇','杰','涛','明','超','霞','强','磊','秀英','文','丽','军','平'],
   'east'),
  -- 4) 힌디어
  (4,
   array['Sharma','Patel','Gupta','Singh','Kumar','Verma','Reddy','Nair','Iyer','Joshi','Mehta','Shah','Das','Rao','Chopra','Malhotra','Bose','Kapoor','Bhat','Menon'],
   array['Aarav','Priya','Rohan','Ananya','Vivaan','Diya','Arjun','Saanvi','Aditya','Isha','Kabir','Riya','Vihaan','Aisha','Dev','Anika','Reyansh','Myra','Ishaan','Tara'],
   'given_first'),
  -- 5) 베트남어
  (5,
   array['Nguyễn','Trần','Lê','Phạm','Hoàng','Huỳnh','Phan','Vũ','Đặng','Bùi','Đỗ','Hồ','Ngô','Dương','Lý'],
   array['Văn An','Thị Hương','Minh Quân','Thị Lan','Hữu Phúc','Thị Mai','Đức Anh','Thị Hà','Quang Huy','Thị Thu','Văn Nam','Thị Linh','Minh Tuấn','Thị Ngọc','Hoàng Long','Thị Trang'],
   'viet')
),
pick as (
  select p.id, (floor(random()*6))::int as loc
  from profiles p
  join auth.users u on u.id = p.id
  where u.raw_app_meta_data->>'dummy' = 'true'
)
update profiles p
set display_name = case l.mode
    when 'east'        then g.sn || g.gn
    when 'given_first' then g.gn || ' ' || g.sn
    when 'viet'        then g.sn || ' ' || g.gn
  end
from pick x
join locales l on l.loc = x.loc
cross join lateral (
  select (l.surnames)[1 + floor(random()*cardinality(l.surnames))::int] as sn,
         (l.givens)[1 + floor(random()*cardinality(l.givens))::int]   as gn
) g
where p.id = x.id;


-- ============================================================
-- 확인
-- ============================================================
-- 레벨별 분포
select rank as level, count(*) as cnt,
       round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from user_progress
group by rank order by rank;

-- 언어권 섞인 닉네임 상위 샘플
select display_name from profiles p
join auth.users u on u.id=p.id
where u.raw_app_meta_data->>'dummy'='true'
order by random() limit 20;

-- ============================================================
-- 롤백(더미 전부 삭제): auth.users 삭제 시 cascade 로 profiles/progress/skill 동반 삭제
--   delete from auth.users where raw_app_meta_data->>'dummy' = 'true';
-- ============================================================
