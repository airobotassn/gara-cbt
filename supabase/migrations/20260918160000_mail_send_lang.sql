-- 메일 실제 발송 붙임 (2026-09-18 결정 · Resend)
--
-- `mail_recipients` 에 **받은 언어**(lang) 칸을 더한다 — 번역 발송이 사람마다 다른 언어로 나가므로
-- "이 사람에게 일본어로 갔다" 를 이력에서 볼 수 있어야 한다(관리자가 한국어 본문만 보고 있으면 뭐가 나갔는지 모른다).
-- status 는 이제 서버가 언제나 sent/failed 를 명시한다. 기본값 'logged' 는 옛 행(발송 수단 없던 때) 호환용으로 남긴다.

alter table public.mail_recipients add column if not exists lang text;
alter table public.mail_recipients drop constraint if exists mail_recipients_lang_chk;
alter table public.mail_recipients add constraint mail_recipients_lang_chk
  check (lang is null or lang in ('ko', 'en', 'ja', 'zh', 'hi', 'vi'));

comment on column public.mail_recipients.lang is '그 사람에게 나간 본문의 언어(번역 발송). null = 옛 행.';
