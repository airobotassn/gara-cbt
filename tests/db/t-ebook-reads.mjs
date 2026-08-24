// T-Ebook-Reads — 마이그레이션 20260821120000_ebook_reads.sql 을 pglite 에 적용해
// **이북 열람 기록**을 검증한다. 용도는 환불 판단 하나이고, 그래서 여기서 보는 것도 두 가지뿐이다:
//
//  · ⭐ **환불해도 기록이 남는다** — 이 표를 ebook_purchases 와 따로 둔 이유 전부다.
//    (환불이 나면 revokeForRefund 가 열람권 행을 지운다. 거기에 컬럼으로 붙였으면 증거가 같이 증발한다.)
//  · **횟수가 부풀지 않는다** — 새로고침·언어 전환마다 read 가 다시 불리는데 그걸 다 세면
//    한 번 앉아서 읽은 것이 "12번 열람"이 되어, 판단에 쓰려던 숫자가 판단을 망친다(10분 창).
//
// 나머지(RLS·CHECK·cascade)는 "코드가 실수해도 DB 가 막아주나" 쪽이다.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const raw = readFileSync('supabase/migrations/20260821120000_ebook_reads.sql', 'utf8');
// pglite 엔 auth 스키마가 없다 — FK 만 떼고 나머지 DDL 은 원본 그대로 적용한다.
const strip = (sql) => sql.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');

const db = await PGlite.create();

// 선행 테이블(실제 스키마의 해당 부분과 같은 모양). ebook_purchases 는 "환불하면 지워지는 쪽" 대조군이다.
await db.exec(`
  create table ebooks (id uuid primary key default gen_random_uuid(), title text not null default '책');
  create table ebook_purchases (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    ebook_id uuid not null references ebooks(id) on delete cascade,
    payment_id uuid,
    created_at timestamptz not null default now(),
    unique (user_id, ebook_id)
  );
`);
await db.exec(strip(raw));

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const book = (await db.query(`insert into ebooks (title) values ('CARIS 교재') returning id`)).rows[0].id;
const book2 = (await db.query(`insert into ebooks (title) values ('다른 책') returning id`)).rows[0].id;
const readRow = async (u = U1, b = book) => (await db.query(
  `select first_read_at, last_read_at, read_count from ebook_reads where user_id=$1 and ebook_id=$2`, [u, b])).rows[0];

// --- (1) 표 모양 ---
{
  const pk = (await db.query(`
    select string_agg(a.attname, ',' order by k.ord) as cols
    from pg_index i
    join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
    where i.indrelid = 'ebook_reads'::regclass and i.indisprimary`)).rows[0];
  rec('PK = (user_id, ebook_id)', pk?.cols, 'user_id,ebook_id');

  const rls = (await db.query(`select relrowsecurity from pg_class where relname='ebook_reads'`)).rows[0];
  rec('RLS 켜짐', rls?.relrowsecurity, true);
  // 사용자가 직접 쓸 수 있으면 "안 읽었다"로 고칠 수 있어 환불 근거로서 값이 죽는다.
  const pol = (await db.query(`select count(*)::int as n from pg_policies where tablename='ebook_reads'`)).rows[0];
  rec('정책 0개(= service role 전용)', pol.n, 0);

  const idx = (await db.query(
    `select count(*)::int as n from pg_indexes where tablename='ebook_reads' and indexname='ebook_reads_book_idx'`)).rows[0];
  rec('책 단위 조회 색인 있음(구매자 목록)', idx.n, 1);
}

// --- (2) 첫 열람 ---
{
  await db.query(`select ebook_mark_read($1, $2)`, [U1, book]);
  const r = await readRow();
  rec('첫 열람이 기록된다', r?.read_count, 1);
  rec('첫 열람 = 마지막 열람', new Date(r.first_read_at).getTime() === new Date(r.last_read_at).getTime(), true);
}

// --- (3) 횟수가 부풀지 않는다(10분 창) ---
{
  // 5분 전에 열었던 것으로 되돌린다 → 새로고침·언어 전환에 해당.
  await db.query(`update ebook_reads set first_read_at = now() - interval '5 min', last_read_at = now() - interval '5 min'
                  where user_id=$1 and ebook_id=$2`, [U1, book]);
  await db.query(`select ebook_mark_read($1, $2)`, [U1, book]);
  const r = await readRow();
  rec('⭐ 10분 안의 재호출은 횟수를 안 올린다', r.read_count, 1);
  // 그래도 마지막 열람 시각은 갱신된다 — 환불 문의 시점과 대조하는 값이다.
  const fresh = Date.now() - new Date(r.last_read_at).getTime() < 60_000;
  rec('마지막 열람 시각은 갱신된다', fresh, true);
  const firstKept = Date.now() - new Date(r.first_read_at).getTime() > 4 * 60_000;
  rec('첫 열람 시각은 안 밀린다', firstKept, true);

  // 11분 전으로 밀면 '다시 와서 읽은 것'이다.
  await db.query(`update ebook_reads set last_read_at = now() - interval '11 min'
                  where user_id=$1 and ebook_id=$2`, [U1, book]);
  await db.query(`select ebook_mark_read($1, $2)`, [U1, book]);
  rec('10분 뒤 재열람은 횟수가 오른다', (await readRow()).read_count, 2);
}

// --- (4) ⭐ 환불해도 남는다 (이 표를 따로 둔 이유) ---
{
  await db.query(`insert into ebook_purchases (user_id, ebook_id) values ($1, $2)`, [U1, book]);
  // revokeForRefund 가 하는 일 그대로 — 이 결제로 나간 열람권을 지운다.
  await db.query(`delete from ebook_purchases where user_id=$1 and ebook_id=$2`, [U1, book]);
  const gone = (await db.query(
    `select count(*)::int as n from ebook_purchases where user_id=$1 and ebook_id=$2`, [U1, book])).rows[0];
  rec('환불로 열람권은 사라진다(대조군)', gone.n, 0);
  const left = await readRow();
  rec('⭐ 환불해도 열람 기록은 남는다', left?.read_count, 2);

  // 다시 사도 기록이 이어진다 → 사서 읽고 환불하기를 반복하는 사람이 드러난다.
  await db.query(`insert into ebook_purchases (user_id, ebook_id) values ($1, $2)`, [U1, book]);
  await db.query(`update ebook_reads set last_read_at = now() - interval '30 min'
                  where user_id=$1 and ebook_id=$2`, [U1, book]);
  await db.query(`select ebook_mark_read($1, $2)`, [U1, book]);
  rec('⭐ 재구매해도 횟수가 이어진다(0으로 안 돌아간다)', (await readRow()).read_count, 3);
}

// --- (5) 남의 기록이 안 섞인다 ---
{
  await db.query(`select ebook_mark_read($1, $2)`, [U2, book]);
  await db.query(`select ebook_mark_read($1, $2)`, [U1, book2]);
  rec('다른 사람은 별개 행', (await readRow(U2, book)).read_count, 1);
  rec('다른 책도 별개 행', (await readRow(U1, book2)).read_count, 1);
  rec('원래 행은 그대로', (await readRow()).read_count, 3);
}

// --- (6) 제약 ---
{
  let err = '';
  try { await db.query(`insert into ebook_reads (user_id, ebook_id, read_count) values ($1, $2, 0)`, [U2, book2]); }
  catch (e) { err = e.message; }
  rec('0회 열람 행은 못 들어온다', /read_count|check/i.test(err), true);

  err = '';
  try { await db.query(`insert into ebook_reads (user_id, ebook_id) values ($1, $2)`, [U1, book]); }
  catch (e) { err = e.message; }
  rec('같은 (사람×책) 두 행 불가', /duplicate|unique/i.test(err), true);

  err = '';
  try {
    await db.query(`insert into ebook_reads (user_id, ebook_id) values ($1, '33333333-3333-3333-3333-333333333333')`, [U1]);
  } catch (e) { err = e.message; }
  rec('없는 책 id 는 못 들어온다(FK)', /foreign key|violates/i.test(err), true);

  // 이북을 지우면 구매 기록이 같이 지워지는 게 기존 동작이라 열람 기록도 같은 취급이다.
  await db.query(`delete from ebooks where id=$1`, [book2]);
  const c = (await db.query(`select count(*)::int as n from ebook_reads where ebook_id=$1`, [book2])).rows[0];
  rec('이북 삭제 시 열람 기록도 딸려 삭제(cascade)', c.n, 0);
}

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-EBOOK-READS: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-ebook-reads', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
