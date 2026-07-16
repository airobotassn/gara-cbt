// T4 set-region 락 가드 검증 — set-region 엣지함수가 의존하는 UPDATE 가드:
//   update profiles set ... where id=uid AND region_locked_at IS NULL
// UNLOCKED 행 → 1행 갱신(200+lock), 이미 LOCKED 행 → 0행(409). 경합 시 정확히 1개만 성공.
import { PGlite } from '@electric-sql/pglite';

const db = await PGlite.create();
const q = (s, p) => db.query(s, p);
await db.exec(`
  create table profiles (id uuid primary key, country_code text, region_code text, region_locked_at timestamptz);
  create table regions (code text primary key);
  insert into regions (code) values ('KR-11'),('KR-26');
  alter table profiles add constraint fk_region foreign key (region_code) references regions(code);
`);
const U = '11111111-1111-1111-1111-111111111111';
await q(`insert into profiles (id) values ($1)`, [U]);

const results = [];
const rec = (name, got, want) => results.push({ name, got, want, pass: got === want });

// (1) UNLOCKED → 1행 갱신 (최초 락 = 200)
let r = await q(`update profiles set country_code='KR', region_code='KR-11', region_locked_at=now() where id=$1 and region_locked_at is null returning id`, [U]);
rec('unlocked update affects exactly 1 row (=200 lock)', r.rows.length, 1);

// (2) 이미 LOCKED → 0행 (재설정 = 409)
r = await q(`update profiles set country_code='US', region_code='KR-26', region_locked_at=now() where id=$1 and region_locked_at is null returning id`, [U]);
rec('locked update affects 0 rows (=409 already_locked)', r.rows.length, 0);

// (3) 값 불변 확인 — 2회차 시도가 아무것도 못 바꿨는지
const row = (await q(`select country_code, region_code from profiles where id=$1`, [U])).rows[0];
rec('country_code unchanged after 409 attempt', row.country_code, 'KR');
rec('region_code unchanged after 409 attempt', row.region_code, 'KR-11');

// (4) 경합 모형 — 두 update 를 순차로 날려 정확히 하나만 1행(먼저), 하나는 0행.
await q(`insert into profiles (id) values ('22222222-2222-2222-2222-222222222222')`);
const U2 = '22222222-2222-2222-2222-222222222222';
const a = await q(`update profiles set region_code='KR-11', region_locked_at=now() where id=$1 and region_locked_at is null returning id`, [U2]);
const b = await q(`update profiles set region_code='KR-26', region_locked_at=now() where id=$1 and region_locked_at is null returning id`, [U2]);
rec('race: first update wins (1 row)', a.rows.length, 1);
rec('race: second update loses (0 rows)', b.rows.length, 0);

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got} want=${x.want})`);
const failed = results.filter(x => !x.pass).length;
console.log(`\nT4-SETREGION-GUARD: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't4-setregion-guard', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
