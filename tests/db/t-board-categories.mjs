// T-Board-Categories — 마이그레이션 20260819150000_board_categories.sql 을 pglite 에 적용해
// **공지·FAQ 분류 표의 방어선**을 검증한다.
//
// 여기서 보는 건 "화면이 예쁜가"가 아니라 **관리자가 실수해도 DB 가 막아주나**다.
//  · 같은 게시판에 같은 키를 두 번 못 만든다 (unique(kind, key))
//  · 키 모양이 강제된다 (영문 소문자로 시작 · 영문/숫자/밑줄) — 주소·조회에 그대로 쓰이는 값이라
//  · kind 는 notice|faq 만 (오타 종류가 조용히 저장되면 그 분류는 어느 화면에도 안 뜬다)
//  · ⭐ **분류를 지워도 글은 안 지워진다** — 이 기능의 핵심 약속이다(FK 를 안 건 이유)
//  · 시드가 옛 하드코딩 값과 **글자까지 같다** — 다르면 기존 공지·FAQ 가 통째로 미분류가 된다
//  · RLS 는 켜져 있고 읽기 정책만 있다(쓰기는 admin 함수 = service role 전용)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const raw = readFileSync('supabase/migrations/20260819150000_board_categories.sql', 'utf8');

const db = await PGlite.create();
await db.exec(raw);

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });

// 마이그레이션이 만드는 표와 무관하게, 글 표를 최소 형태로 세워 "지워도 안 딸려간다"를 실제로 본다.
await db.exec(`
  create table notices (id uuid primary key default gen_random_uuid(), category text not null default 'guide');
  create table faqs (id uuid primary key default gen_random_uuid(), category text not null default 'schedule');
`);

// --- (1) 시드 ---
{
  const n = (await db.query(`select count(*)::int as n from board_categories where kind='notice'`)).rows[0];
  const q = (await db.query(`select count(*)::int as n from board_categories where kind='faq'`)).rows[0];
  rec('공지 분류 4종 시드', n.n, 4);
  rec('FAQ 분류 5종 시드', q.n, 5);

  // ⭐ 키가 옛 하드코딩 값과 같아야 기존 글이 그대로 이어진다.
  const keys = (await db.query(
    `select key from board_categories where kind='notice' order by sort`)).rows.map((r) => r.key);
  rec('⭐ 공지 키가 옛 값 그대로', keys.join(','), 'guide,schedule,maintenance,event');
  const fkeys = (await db.query(
    `select key from board_categories where kind='faq' order by sort`)).rows.map((r) => r.key);
  rec('⭐ FAQ 키가 옛 값 그대로', fkeys.join(','), 'schedule,system,payment,grading,corporate');

  // 이름은 6개국어가 다 있어야 한다 — 하나라도 비면 그 언어 사용자에게 분류가 키로 보인다.
  const langs = (await db.query(
    `select count(*)::int as n from board_categories
     where not (label_i18n ?& array['ko','en','ja','zh','hi','vi'])`)).rows[0];
  rec('모든 시드에 6개국어 이름', langs.n, 0);

  const ko = (await db.query(
    `select label_i18n->>'ko' as ko from board_categories where kind='notice' and key='schedule'`)).rows[0];
  rec('시드 이름이 화면 문구 그대로', ko.ko, 'CARIS 일정');

  // 다시 돌려도 안 터진다(on conflict do nothing) — 마이그레이션 재실행은 흔한 일이다.
  await db.exec(raw);
  const again = (await db.query(`select count(*)::int as n from board_categories`)).rows[0];
  rec('재실행해도 중복 시드 안 생김', again.n, 9);
}

// --- (2) 제약 ---
{
  let dup = false;
  try {
    await db.query(`insert into board_categories (kind, key, label_i18n) values ('notice','guide','{}')`);
  } catch (e) { dup = /duplicate key|board_categories_kind_key/i.test(String(e?.message ?? '')); }
  rec('같은 게시판에 같은 키 두 번은 거부', dup, true);

  // 다른 게시판이면 같은 키를 써도 된다(공지 schedule / FAQ schedule 이 실제로 그렇다).
  const both = (await db.query(`select count(*)::int as n from board_categories where key='schedule'`)).rows[0];
  rec('게시판이 다르면 같은 키 허용', both.n, 2);

  for (const [name, bad] of [
    ['대문자', 'Guide'],
    ['하이픈', 'my-cat'],
    ['숫자로 시작', '1cat'],
    ['공백', 'my cat'],
    ['빈 값', ''],
  ]) {
    let blocked = false;
    try {
      await db.query(`insert into board_categories (kind, key, label_i18n) values ('notice',$1,'{}')`, [bad]);
    } catch (e) { blocked = /check|board_categories_key_check/i.test(String(e?.message ?? '')); }
    rec(`키 모양 거부 — ${name}`, blocked, true);
  }

  let badKind = false;
  try {
    await db.query(`insert into board_categories (kind, key, label_i18n) values ('qna','x','{}')`);
  } catch (e) { badKind = /check/i.test(String(e?.message ?? '')); }
  rec('kind 는 notice|faq 만', badKind, true);
}

// --- (3) ⭐ 분류를 지워도 글은 남는다 ---
{
  await db.query(`insert into notices (category) values ('maintenance'),('maintenance'),('guide')`);
  await db.query(`insert into faqs (category) values ('payment')`);

  await db.query(`delete from board_categories where kind='notice' and key='maintenance'`);
  const left = (await db.query(`select count(*)::int as n from notices where category='maintenance'`)).rows[0];
  rec('⭐ 분류를 지워도 공지는 그대로 남는다', left.n, 2);

  // 공개 화면이 쓰는 조회 = "지금 있는 분류에 속한 글만". 지운 분류의 글은 여기서 빠진다.
  const visible = (await db.query(
    `select count(*)::int as n from notices
     where category in (select key from board_categories where kind='notice')`)).rows[0];
  rec('공개 목록에서는 내려간다', visible.n, 1);

  // 같은 키로 다시 만들면 그대로 돌아온다 — 실수로 지웠을 때의 되돌리기다.
  await db.query(
    `insert into board_categories (kind, key, label_i18n, sort) values ('notice','maintenance','{"ko":"점검"}',30)`);
  const back = (await db.query(
    `select count(*)::int as n from notices
     where category in (select key from board_categories where kind='notice')`)).rows[0];
  rec('⭐ 같은 키로 되살리면 글도 돌아온다', back.n, 3);

  // FAQ 도 같은 규칙(표 하나를 kind 로 가른다).
  await db.query(`delete from board_categories where kind='faq' and key='payment'`);
  const faqLeft = (await db.query(`select count(*)::int as n from faqs where category='payment'`)).rows[0];
  rec('FAQ 도 지운 분류의 글이 남는다', faqLeft.n, 1);
}

// --- (4) RLS ---
{
  const rls = (await db.query(`select relrowsecurity from pg_class where relname='board_categories'`)).rows[0];
  rec('RLS 켜짐', rls?.relrowsecurity, true);
  const pol = (await db.query(
    `select cmd from pg_policies where tablename='board_categories'`)).rows.map((r) => r.cmd);
  rec('읽기 정책 하나뿐(쓰기는 service role 전용)', pol.join(','), 'SELECT');
}

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-BOARD-CATEGORIES: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-board-categories', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
