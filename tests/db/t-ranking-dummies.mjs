// T-Ranking-Dummies — 마이그레이션 20260821130000(표+scoped_top) · 20260821140000(시드)을
// pglite 에 적용해 **랭킹 더미**를 검증한다.
//
// 이 기능이 지키려는 약속은 둘이다:
//  · ⭐ **진짜 사용자가 이길 수 있다** — 더미 천장이 6,900점이라 레벨테스트를 끝까지 깬 사람(7,000)이
//    무조건 위에 선다. 더미가 그 위에 있으면 랭킹은 목표가 아니라 넘을 수 없는 장식이 된다.
//  · ⭐ **profiles 를 오염시키지 않는다** — 회원 목록·회원 수·시즌 리셋·arena 실집계가 전부
//    profiles/user_progress 만 보므로, 더미가 거기 안 들어가면 그 화면들은 손댈 필요가 없다.
//
// 나머지는 "코드가 실수해도 DB 가 막아주나" 쪽이다(지역 FK·등급 범위·RLS).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const strip = (sql) => sql.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');
const db = await PGlite.create();

// Supabase 에는 있는 롤(마이그레이션의 revoke 대상). 없으면 revoke 가 42704 로 죽는다.
await db.exec(`create role anon; create role authenticated; create role service_role;`);

// 선행 테이블 — 실제 스키마의 해당 부분과 같은 모양으로 최소한만.
await db.exec(`
  create table regions (code text primary key, country_code text);
  create table profiles (
    id uuid primary key, display_name text, avatar_url text,
    is_anonymous boolean default false, deactivated_at timestamptz,
    country_code text, region_code text
  );
  create table user_progress (
    user_id uuid primary key, rank int not null default 1,
    skill_score numeric not null default 0, activity_score numeric not null default 0,
    season_total numeric generated always as (skill_score + activity_score) stored,
    updated_at timestamptz default now()
  );
  create table arena_seed_buckets (
    scope text, code text, country_code text, member_count int, avg_level numeric,
    active_today int, label text, note text, primary key (scope, code)
  );
  create or replace function public.ranking_tier(p_pct numeric) returns text language sql immutable as $fn$
    select case when p_pct <= 0.05 then 'diamond' when p_pct <= 0.20 then 'platinum'
                when p_pct <= 0.45 then 'gold'    when p_pct <= 0.75 then 'silver' else 'bronze' end $fn$;
`);

// arena 시드를 줄여서 재현(실제 값과 같은 규칙 — 지역 점수 = 나라 점수의 75~125%).
await db.exec(`
  insert into regions (code, country_code) values ('US-CA','US'),('US-NY','US'),('KR-11','KR'),('KR-26','KR');
  insert into arena_seed_buckets (scope, code, country_code, member_count, avg_level, active_today) values
    ('region','US-CA','US',160,4000,12),
    ('region','US-NY','US',160,3000,12),
    ('region','KR-11','KR', 60,3100, 5),
    ('region','KR-26','KR', 60,1900, 5),
    ('country','US',null,1530,3200,120),
    ('country','KR',null,1270,2550,123);
`);

await db.exec(strip(readFileSync('supabase/migrations/20260821130000_ranking_dummies.sql', 'utf8')));
await db.exec(readFileSync('supabase/migrations/20260821140000_ranking_dummies_seed.sql', 'utf8'));
// 닉네임 개편(나라별 문자 + 순위별 결). 함수를 통째로 갈아끼우고 다시 깐다.
await db.exec(readFileSync('supabase/migrations/20260821150000_ranking_dummy_names.sql', 'utf8'));
// 무한 스크롤(커서 페이징 + 티어 컷 캐시). pg_cron 은 pglite 에 없으니 크론 등록만 걷어낸다.
await db.exec(
  readFileSync('supabase/migrations/20260821160000_scoped_page.sql', 'utf8')
    .replace(/select cron\.[\s\S]*?;\n/g, ''),
);
// 허브가 쓰는 전세계 순위. 더미를 안 세던 것을 고친 판 — 아래 (8b) 가 scoped_top 과 대조한다.
await db.exec(readFileSync('supabase/migrations/20260825150000_my_rank_context_dummies.sql', 'utf8'));
// 배경 분포(초원 50 · 고궁 낮 30 · 고궁 밤 20, 위에서부터 고궁). 시드 뒤에 한 번 더 덮어쓰는 짝이다.
await db.exec(readFileSync('supabase/migrations/20260826180000_ranking_dummy_skins.sql', 'utf8'));
// 캐릭터를 그림이 있는 계열(a)로. 이것도 시드 뒤에 덮어쓰는 짝이다.
await db.exec(readFileSync('supabase/migrations/20260826190000_ranking_dummy_chars_a.sql', 'utf8'));

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

// --- (1) 표 모양 ---
{
  const rls = await one(`select relrowsecurity from pg_class where relname='ranking_dummies'`);
  rec('RLS 켜짐', rls?.relrowsecurity, true);
  // 사용자가 직접 읽고 쓸 수 있으면 더미가 진짜인 척 조작될 수 있다.
  const pol = await one(`select count(*)::int n from pg_policies where tablename='ranking_dummies'`);
  rec('정책 0개(= service role 전용)', pol.n, 0);

  let err = '';
  try { await db.query(`insert into ranking_dummies (display_name, country_code, region_code) values ('x','US','ZZ-99')`); }
  catch (e) { err = e.message; }
  rec('없는 지역 코드는 못 들어온다(FK)', /foreign key|violates/i.test(err), true);

  err = '';
  try { await db.query(`insert into ranking_dummies (display_name, country_code, region_code, rank) values ('x','US','US-CA', 9)`); }
  catch (e) { err = e.message; }
  rec('등급은 1~7 만(CHECK)', /check|rank/i.test(err), true);
}

// --- (2) 시드 ---
{
  const n = await one(`select count(*)::int n from ranking_dummies`);
  rec('지역 4개 × 10명', n.n, 40);
  // 국가 버킷까지 넣으면 사람이 두 배가 된다(국가 = 그 나라 지역들의 합).
  const byRegion = await one(`select count(distinct region_code)::int n from ranking_dummies`);
  rec('국가 버킷은 안 섞인다', byRegion.n, 4);

  const rules = await one(`
    select count(*)::int n from ranking_dummies
    where skill_score::numeric % 1000 <> 0
       or rank <> least(7, (skill_score/1000)::int + 1)`);
  rec('⭐ skill 은 1,000 배수 · 등급은 그 파생', rules.n, 0);

  // ⭐ 닉네임 — 랭킹은 열 줄이 세로로 붙는 화면이라 이름이 어긋나면 바로 보인다.
  const long = await one(`select count(*)::int n from ranking_dummies where length(display_name) > 12`);
  rec('⭐ 닉네임 12자 제한을 안 넘는다', long.n, 0);
  // ⭐ 겹쳐 보이는 자리에서만 유니크하면 된다 — 나라가 다르면 서로 다른 보드라 한 화면에 안 선다.
  //    전역 유니크를 강제하면 작은 나라 1등이 숫자를 달게 된다(그 나라 랭킹 맨 윗줄이다).
  const dupn = await one(`select count(*)::int n from
    (select country_code, display_name from ranking_dummies group by 1,2 having count(*) > 1) t`);
  rec('⭐ 한 나라 안에 같은 이름이 없다', dupn.n, 0);
  const dupTop = await one(`select count(*)::int n from
    (select display_name from (select display_name from ranking_dummies order by season_total desc limit 300) z
     group by 1 having count(*) > 1) t`);
  rec('⭐ 전세계 상위권에도 같은 이름이 없다', dupTop.n, 0);
  const blank = await one(`select count(*)::int n from ranking_dummies
                           where display_name is null or btrim(display_name) = ''`);
  rec('빈 이름이 없다', blank.n, 0);
  // 나라별 문자 — 한국은 한글, 일본은 가나·한자, 중국은 한자.
  const ko = await one(`select count(*)::int n from ranking_dummies
                        where country_code='KR' and display_name !~ '[가-힣]'`);
  rec('⭐ 한국 계정은 한글 닉네임', ko.n, 0);
  const en = await one(`select count(*)::int n from ranking_dummies
                        where country_code not in ('KR','KP','JP','CN','TW','HK','MO','SG','IN','NP','VN')
                          and display_name !~ '^[A-Za-z]'`);
  rec('그 밖의 나라는 영문으로 시작', en.n, 0);
  // 상위권은 숫자 없는 단독 이름 위주 — 랭킹 화면에 실제로 뜨는 얼굴이다.


  // ⭐ 캐릭터는 전원 갖는다 — 비워두면 그 자리가 전부 같은 기본 그림이라 랭킹·방에서 그것만 눈에 띈다.
  const noChar = await one(`select count(*)::int n from ranking_dummies where character_key is null`);
  rec('⭐ 모든 더미가 캐릭터를 갖는다', noChar.n, 0);
  const badChar = await one(`select count(*)::int n from ranking_dummies
    where character_key not in ('char_a_m','char_a_f','char_b_m','char_b_f','char_c_m','char_c_f')`);
  rec('캐릭터 키가 실제 상품 키와 같다', badChar.n, 0);
  // ⭐ 그림이 있는 계열만 쓴다(20260826190000). b·c 는 그림이 없어 폴백 한 장으로 떨어지는데,
  //    그러면 성별도 레벨도 무시된 같은 얼굴이 랭킹·남의 방을 덮는다.
  const noArt = await one(`select count(*)::int n from ranking_dummies
    where character_key not in ('char_a_m','char_a_f')`);
  rec('⭐ 그림이 있는 캐릭터만 쓴다', noArt.n, 0);
  // 성별은 지킨다 — 남녀가 한쪽으로 쏠리면 갈아입힌 티가 난다.
  const gender = await one(`select
      (count(*) filter (where character_key = 'char_a_m'))::int as m,
      (count(*) filter (where character_key = 'char_a_f'))::int as f from ranking_dummies`);
  rec('남녀가 한쪽으로 쏠리지 않는다', gender.m > 0 && gender.f > 0, true);
  // 배경은 초원 50% · 고궁 낮 30% · 고궁 밤 20%(20260826180000). 스킨은 코인 상품이라
  // 전원이 가지면 이상하고, 아무도 안 가지면 랭킹 방이 전부 같은 그림이 된다.
  const sk = await one(`select
      (count(*) filter (where skin is null))::int                     as meadow,
      (count(*) filter (where skin = 'skin_palace_day'))::int         as day,
      (count(*) filter (where skin = 'skin_palace_night'))::int       as night,
      count(*)::int                                                   as all_n
    from ranking_dummies`);
  rec('초원이 절반', sk.meadow, Math.round(sk.all_n * 0.5));
  rec('고궁 낮이 30%', sk.day, Math.round(sk.all_n * 0.3));
  rec('고궁 밤이 20%', sk.night, Math.round(sk.all_n * 0.2));
  // ⭐ 상위권은 고궁 — 지역 안 등수로 자르므로 전세계·국가 보드 윗줄도 자동으로 고궁이 된다.
  const topPlain = await one(`with p as (
      select skin, row_number() over (partition by region_code order by season_total desc, id) as r
        from ranking_dummies)
    select count(*)::int n from p where r <= 3 and skin is null`);
  rec('⭐ 지역 상위 3명은 초원이 아니다', topPlain.n, 0);
  const worldPlain = await one(`select count(*)::int n from (
      select skin from ranking_dummies order by season_total desc limit 10) t where skin is null`);
  rec('⭐ 전세계 상위 10명도 고궁', worldPlain.n, 0);
  // 밤이 어느 자리에 오는지는 지역마다 달라야 한다 — 안 돌리면 모든 보드의 1·2위가 똑같이 밤이다.
  const nightSpots = await one(`with p as (
      select region_code, skin, row_number() over (partition by region_code order by season_total desc, id) as r
        from ranking_dummies)
    select count(distinct r)::int n from p where skin = 'skin_palace_night'`);
  rec('밤 자리가 지역마다 다르다', nightSpots.n > 1, true);

  // 아바타는 비운다 — 프론트가 id 시드로 젬 색을 만든다(실회원과 같은 규칙).
  const av = await one(`select count(*)::int n from ranking_dummies where avatar_url is not null`);
  rec('아바타는 비어 있다', av.n, 0);
}

// --- (3) ⭐ 천장 — 진짜 사용자가 이길 수 있는가 ---
{
  const mx = await one(`select max(season_total) mx, min(season_total) mn from ranking_dummies`);
  rec('⭐ 더미 최고점이 7,000 미만', Number(mx.mx) < 7000, true);
  rec('더미 최고점이 6,900 이하', Number(mx.mx) <= 6900, true);
  rec('음수 점수 없음', Number(mx.mn) >= 0, true);
  // 지역 점수(4000)의 1.6배 = 6400 — 클램프에 걸리지 않는 값이어야 상위권이 한 점수에 뭉치지 않는다.
  const top = await one(`select count(*)::int n from ranking_dummies
                         where season_total = (select max(season_total) from ranking_dummies)`);
  rec('최고점 동점자가 뭉치지 않는다', top.n, 1);
}

// --- (4) ⭐ scoped_top — 실회원과 한 줄에 선다 ---
const U = '11111111-1111-1111-1111-111111111111';
{
  await db.query(`insert into profiles (id, display_name, country_code, region_code) values ($1,'진짜사람','US','US-CA')`, [U]);
  // 레벨테스트 7단계를 다 깬 사람 = skill 7,000.
  await db.query(`insert into user_progress (user_id, rank, skill_score) values ($1, 7, 7000)`, [U]);

  const g = (await db.query(`select scoped_top($1, 10, null, null) as j`, [U])).rows[0].j;
  rec('⭐ 레벨 7 클리어한 실사용자가 1위', g.top[0].name, '진짜사람');
  rec('1위 행이 me 로 표시된다', g.top[0].me, true);
  rec('총원 = 더미 40 + 실회원 1', g.total, 41);
  rec('2위부터는 더미가 채운다', g.top.length, 10);
  rec('더미 행에도 uid 가 실린다(방 보기용)', typeof g.top[1].uid === 'string', true);
  rec('더미 행에 이름이 있다', typeof g.top[1].name === 'string' && g.top[1].name.length > 0, true);
  rec('더미 행에 국가가 실린다(국기용)', ['US', 'KR'].includes(g.top[1].country), true);
  rec('티어가 백분위에서 나온다', g.top[0].tier, 'diamond');

  // 국가·지역 탭
  const kr = (await db.query(`select scoped_top($1, 10, 'KR', null) as j`, [U])).rows[0].j;
  rec('국가 탭은 그 나라만', kr.total, 20);
  rec('국가 탭에 남의 나라가 안 섞인다', kr.top.every((r) => r.country === 'KR'), true);
  const seoul = (await db.query(`select scoped_top($1, 10, 'KR', 'KR-11') as j`, [U])).rows[0].j;
  rec('⭐ 지역 탭 TOP 10 이 꽉 찬다', seoul.top.length, 10);
  rec('지역 탭 총원 = 그 지역 10명', seoul.total, 10);

  // 내 순위 — 남의 지역 보드에는 내가 없다.
  rec('남의 지역 보드에는 내 순위가 없다', seoul.me, null);
  const mine = (await db.query(`select scoped_top($1, 3, 'US', 'US-CA') as j`, [U])).rows[0].j;
  rec('내 지역 보드에는 내 순위가 있다', mine.me?.rank, 1);
}

// --- (5) ⭐ profiles 오염 없음 ---
{
  const p = await one(`select count(*)::int n from profiles`);
  rec('⭐ profiles 는 실회원 1명 그대로', p.n, 1);
  const up = await one(`select count(*)::int n from user_progress`);
  rec('⭐ user_progress 도 1행 그대로', up.n, 1);
  // → 회원 수 통계·reset_season()·refresh_arena_buckets() 의 실집계가 전부 그대로다.
}

// --- (6) 다시 깔기 ---
{
  const before = await one(`select display_name, season_total from ranking_dummies
                            where region_code='KR-11' order by season_total desc limit 1`);
  const n2 = await one(`select seed_ranking_dummies(10) as n`);
  rec('다시 깔면 같은 수', n2.n, 40);
  const after = await one(`select display_name, season_total from ranking_dummies
                           where region_code='KR-11' order by season_total desc limit 1`);
  rec('⭐ 결정론적 — 같은 지역·같은 자리는 같은 사람', after.display_name, before.display_name);
  rec('점수도 같다', String(after.season_total), String(before.season_total));

  const n5 = await one(`select seed_ranking_dummies(5) as n`);
  rec('인원을 바꾸면 통째로 갈린다', n5.n, 20);
  const tot = await one(`select count(*)::int n from ranking_dummies`);
  rec('옛 행이 남지 않는다', tot.n, 20);

  // 1명이면 가중치 분모가 0이 된다 — case 로 막아 둔 자리다.
  const n1 = await one(`select seed_ranking_dummies(1) as n`);
  rec('지역당 1명도 동작(0 나누기 방지)', n1.n, 4);
  // 지역당 1명이면 그 사람이 곧 그 나라 1등 → 나라 대역의 꼭대기에 선다.
  // (US 는 최고 지역이라 압축비가 1 → v_peak 그대로 6,400.)
  const solo = await one(`select max(season_total) t from ranking_dummies where country_code='US'`);
  rec('1명이면 나라 1등이 대역 꼭대기', Number(solo.t), 6400);
  // 나라 대역은 순서를 지킨다 — 미국 1등 > 한국 1등 > (지역 점수가 더 낮은 나라).
  const bands = await one(`select
      (select max(season_total) from ranking_dummies where country_code='US') us,
      (select max(season_total) from ranking_dummies where country_code='KR') kr`);
  rec('⭐ 나라 대역 순서는 지역 점수 순서를 따른다', Number(bands.us) > Number(bands.kr), true);

  let err = '';
  try { await db.query(`select seed_ranking_dummies(0)`); } catch (e) { err = e.message; }
  rec('0명은 거절', /p_per_region/.test(err), true);

  await db.query(`select seed_ranking_dummies(10)`);
}

// --- (7) ⭐ 상위권이 한 나라로 안 채워진다 ---
// 이 기능의 목적 ① 이 "월드 랭킹이 다 한국인" 을 고치는 것인데, 지역 점수로 바로 점수를 매기면
// **지역이 많은 나라가 상위를 독식**해서 "다 미국인" 이 된다(실제로 TOP 10 중 9명이 미국이었다).
// 그래서 지역 수를 크게 벌린 판을 만들어 놓고 본다.
{
  await db.query(`delete from ranking_dummies`);
  await db.query(`delete from arena_seed_buckets`);
  // 미국은 지역 20개(사람 200명), 나머지는 3개(30명)씩 — 표본 차이를 6배 이상으로 벌린다.
  for (let k = 1; k <= 20; k++) {
    await db.query(`insert into regions (code, country_code) values ($1,'US') on conflict do nothing`, [`US-X${k}`]);
    await db.query(`insert into arena_seed_buckets (scope, code, country_code, member_count, avg_level, active_today)
                    values ('region', $1, 'US', 100, $2, 8)`, [`US-X${k}`, 4000 - k * 40]);
  }
  const others = [['CN', 3625], ['IN', 3250], ['KR', 3187], ['GB', 2625]];
  for (const [cc, sc] of others) {
    for (let k = 1; k <= 3; k++) {
      await db.query(`insert into regions (code, country_code) values ($1,$2) on conflict do nothing`, [`${cc}-X${k}`, cc]);
      await db.query(`insert into arena_seed_buckets (scope, code, country_code, member_count, avg_level, active_today)
                      values ('region', $1, $2, 100, $3, 8)`, [`${cc}-X${k}`, cc, sc - k * 40]);
    }
  }
  await db.query(`select seed_ranking_dummies(10)`);
  const g = (await db.query(`select scoped_top($1, 10, null, null) as j`, [U])).rows[0].j;
  const countries = [...new Set(g.top.filter((r) => !r.me).map((r) => r.country))];
  rec('⭐ TOP 10 에 3개국 이상이 섞인다', countries.length >= 3, true);
  rec('⭐ 한 나라가 TOP 10 을 독식하지 않는다', g.top.filter((r) => r.country === 'US').length <= 7, true);
  // 나라 대역 순서 자체는 지켜진다 — 섞이라고 순서를 지운 게 아니다.
  const bands = await one(`select country_code, max(season_total) mx from ranking_dummies
                           group by 1 order by mx desc limit 2`);
  rec('그래도 1등 나라는 지역 점수가 제일 높은 나라', bands.country_code, 'US');

  // 상위권은 짧고 강한 단독 닉네임이 주류여야 한다(실제 랭킹이 그렇게 생겼다).
  //   ⚠️ 전부는 아니다 — `Player99` 같은 이름도 실제로 1등을 한다. 주류인지만 본다.
  //   ⚠️ 나라가 몇 개뿐인 판에서는 표본이 너무 작아 무의미하다 → 나라를 벌린 이 블록에서 잰다.
  const clean = await one(`select
      count(*) filter (where display_name !~ '[0-9]')::numeric / greatest(count(*),1) as r
    from (select display_name from ranking_dummies order by season_total desc limit 30) t`);
  rec('⭐ 상위 30명은 대부분 숫자 없는 단독 이름', Number(clean.r) >= 0.6, true);
}

// --- (8) ⭐ 무한 스크롤 — 커서로 끝까지 걸어도 한 명도 안 빠진다 ---
// 이게 실제로 났던 버그다. 커서를 (점수·시각)만으로 잡으면 **동점자가 통째로 건너뛰어진다** —
// 더미는 한 번에 insert 되어 시각이 같고 낮은 점수대에 동점이 많아서, 실측 3만5천 명 중
// 27,629명에서 멈춰 7,419명이 사라졌다. id 를 커서에 넣어야 순서가 유일해진다.
{
  await db.query(`select seed_ranking_dummies(10)`);
  await db.query(`select refresh_ranking_tier_cuts()`);
  const cuts = await one(`select cut_dia, cut_silver, total from ranking_tier_cuts`);
  rec('티어 컷이 채워진다', Number(cuts.total) > 0 && Number(cuts.cut_dia) >= Number(cuts.cut_silver), true);

  // 동점을 일부러 많이 만든다 — 이 판에서 커서가 새면 바로 드러난다.
  await db.query(`update ranking_dummies set skill_score = 0, activity_score = 7
                  where region_code = 'US-NY'`);

  const total = Number((await one(`select
    (select count(*) from ranking_dummies)
    + (select count(*) from user_progress p join profiles pr on pr.id=p.user_id
        and pr.deactivated_at is null and pr.is_anonymous=false) as n`)).n);

  const seen = new Set(); const ranks = [];
  let cur = null, start = 1, guard = 0;
  while (guard++ < 200) {
    const r = (await db.query(
      `select scoped_page($1, $2, $3, $4, $5, 7, null, null) as j`,
      [U, cur?.score ?? null, cur?.at ?? null, cur?.id ?? null, start],
    )).rows[0].j;
    for (const x of r.rows) { seen.add(x.uid); ranks.push(x.rank) }
    if (!r.cursor || !r.rows.length) break;
    cur = r.cursor; start = r.cursor.rank + 1;
  }
  rec('⭐ 커서로 끝까지 걸으면 전원을 받는다', seen.size, total);
  rec('⭐ 순위 번호가 1부터 연속이다', ranks.every((v, i) => v === i + 1), true);
  rec('⭐ 같은 사람을 두 번 주지 않는다', seen.size, ranks.length);

  // 국가 보드도 같은 경로를 쓴다 — "인원이 적어 한 번에 받으면 된다" 는 틀린 전제였다
  // (지역 수가 많은 나라가 더 크다: 우간다 1,110명 · 러시아 860명 · 미국 510명).
  const kr = (await db.query(`select scoped_page($1, null, null, null, 1, 5, 'KR', null) as j`, [U])).rows[0].j;
  rec('국가 보드도 커서 페이징이 된다', kr.rows.length, 5);
  rec('국가 보드에 남의 나라가 안 섞인다', kr.rows.every((r) => r.country === 'KR'), true);
  const kr2 = (await db.query(
    `select scoped_page($1, $2, $3, $4, 6, 5, 'KR', null) as j`,
    [U, kr.cursor.score, kr.cursor.at, kr.cursor.id])).rows[0].j;
  rec('국가 보드 2페이지가 이어진다', kr2.rows[0].rank, 6);
  rec('1·2페이지가 겹치지 않는다', kr.rows.some((a) => kr2.rows.some((b) => a.uid === b.uid)), false);

  // 첫 화면(scoped_top)과 맞물리는가 — 두 함수의 정렬 기준이 같아야 경계에서 안 겹친다.
  const top = (await db.query(`select scoped_top($1, 10, null, null) as j`, [U])).rows[0].j;
  rec('⭐ 첫 화면이 이어보기 커서를 내려준다', top.cursor?.rank, 10);
  const next = (await db.query(
    `select scoped_page($1, $2, $3, $4, 11, 5, null, null) as j`,
    [U, top.cursor.score, top.cursor.at, top.cursor.id])).rows[0].j;
  rec('⭐ 첫 화면 다음이 11위부터 이어진다', next.rows[0].rank, 11);
  const overlap = top.top.some((a) => next.rows.some((b) => a.uid === b.uid));
  rec('⭐ 첫 화면과 이어보기가 겹치지 않는다', overlap, false);

  await db.query(`select seed_ranking_dummies(10)`);
}

// --- (8b) ⭐ my_rank_context 가 scoped_top 과 같은 답을 낸다 ---
//     허브(HUD 의 '상위 N%' · 공유 카드의 World 순위)와 /ranking 월드 탭이 서로 다른 순위를 말하면 안 된다.
//     2026-08-25 에 실제로 갈렸다 — 더미를 넣을 때 이 함수만 안 열어서 허브가 "실회원 8명 중 4위" 를
//     찍고 있었고, 같은 계정이 랭킹 화면에선 8,591위였다.
//     ⚠️ 두 구현은 속도 때문에 일부러 따로 산다(하나는 윈도 함수, 하나는 세기) — **이 대조가 그 대가다.**
{
  const picks = (await db.query(`
    select id from (
      (select id, season_total from ranking_dummies order by season_total desc limit 3)
      union all
      (select id, season_total from ranking_dummies order by season_total asc limit 3)
    ) x
  `)).rows.map((r) => r.id);

  const keys = ['rank', 'total', 'season_total', 'tier', 'percentile', 'points_to_pass'];
  let same = 0;
  for (const id of [U, ...picks]) {
    const r = await one(`select scoped_top($1, 0, null, null) as j, my_rank_context($1) as f`, [id]);
    const a = {
      rank: r.j.me?.rank ?? null, total: r.j.total, season_total: r.j.me?.rating ?? null,
      tier: r.j.me?.tier ?? null, percentile: r.j.me?.percentile ?? null,
      points_to_pass: r.j.me?.points_to_pass ?? null,
    };
    const b = Object.fromEntries(keys.map((k) => [k, r.f[k] ?? null]));
    if (JSON.stringify(a) === JSON.stringify(b)) same++;
  }
  rec('⭐ 두 구현이 같은 순위·백분위·티어를 낸다(상위·하위·실회원)', same, 1 + picks.length);

  // 회귀 그 자체 — 더미를 안 세면 total 이 실회원 수(1)로 떨어진다.
  const me = await one(`select my_rank_context($1) as f`, [U]);
  const n = await one(`select count(*)::int c from ranking_dummies`);
  rec('⭐ 전세계 모수에 더미가 들어 있다', me.f.total, n.c + 1);
  rec('레벨 7 클리어한 실사용자는 여전히 1위', me.f.rank, 1);
  rec('1위는 따라잡을 사람이 없다', me.f.points_to_pass, null);

  // 아직 집계 전인 사람(내 행이 없다) — 옛 판과 같은 모양으로 총원만 나간다.
  const ghost = '99999999-9999-9999-9999-999999999999';
  const g = await one(`select my_rank_context($1) as f`, [ghost]);
  rec('집계 전인 사람은 순위가 null', g.f.rank, null);
  rec('집계 전이어도 총원은 같다', g.f.total, n.c + 1);
}

// --- (9) 걷어내기 ---
{
  await db.query(`delete from ranking_dummies`);
  const g = (await db.query(`select scoped_top($1, 10, null, null) as j`, [U])).rows[0].j;
  rec('⭐ 지우면 실회원만 남는다', g.total, 1);
  rec('지운 뒤에도 보드가 정상', g.top[0].name, '진짜사람');
}

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-RANKING-DUMMIES: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-ranking-dummies', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
