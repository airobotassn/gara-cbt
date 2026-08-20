// 채팅 번역 — 판정 함수 단위 테스트(DB 없이 순수 로직만).
//
// 여기 있는 셋이 번역 비용과 정확성을 직접 정한다.
//  · isTranslatable  — 번역해봐야 소용없는 줄을 걸러 실사용량을 대략 절반으로 줄인다
//  · sameLang        — 원문 == 독자 언어면 번역 안 함. 잘못 판정하면 헛돈 or 안 읽히는 글
//  · langForCountry  — 대상 언어의 유일한 출처. 계정에 언어 컬럼을 안 두는 이유가 여기 있다
//
// ⚠️ Deno 함수 파일을 bun 이 직접 import 한다. 두 파일 다 Deno 전역을 안 쓰므로 그냥 로드된다
//    (서버 번역 엔진을 걷어낸 뒤로 translate.ts 에는 판정 함수 하나만 남았다).
import { isTranslatable } from '../supabase/functions/_shared/translate.ts';
import { langForCountry, sameLang } from '../supabase/functions/_shared/country-lang.ts';

const results = [];
const rec = (name, got, want) => results.push({ name, got, want, pass: got === want });

// --- isTranslatable — 짧은 글이 절반인 채팅에서 이 필터가 비용을 가른다 ---
rec('정상 문장은 번역한다', isTranslatable('오늘 게임 재밌었어요'), true);
rec('영문 문장도 번역한다', isTranslatable('nice game'), true);
rec('2자 이하는 안 한다(ㅋㅋ)', isTranslatable('ㅋㅋ'), false);
rec('2자 이하는 안 한다(ok)', isTranslatable('ok'), false);
rec('공백 트림 후 2자면 안 한다', isTranslatable('  gg  '), false);
rec('이모지만 있으면 안 한다', isTranslatable('🎉🎉🎉🎉'), false);
rec('숫자만 있으면 안 한다', isTranslatable('12345'), false);
rec('기호만 있으면 안 한다', isTranslatable('!!!???'), false);
rec('글자가 섞여 있으면 한다', isTranslatable('축하해요 🎉'), true);
rec('빈 문자열은 안 한다', isTranslatable(''), false);
rec('null 은 안 한다', isTranslatable(null), false);

// --- sameLang — 지역 변종 처리가 핵심 ---
rec('같은 코드', sameLang('ko', 'ko'), true);
rec('다른 코드', sameLang('ko', 'ja'), false);
rec('대소문자 무시', sameLang('KO', 'ko'), true);
// ⛔ 간체 ↔ 번체는 **번역해야 읽힌다** — 같다고 보면 대만 사용자가 간체를 그대로 받는다.
rec('간체 ↔ 번체는 다르다', sameLang('zh-Hans', 'zh-Hant'), false);
// 감지가 'zh' 처럼 뭉뚱그려 오면 어느 쪽인지 모른다 → 번역해도 절반은 헛돈이라 안 한다.
rec('지역 없는 zh 는 zh-Hans 와 같게 본다', sameLang('zh', 'zh-Hans'), true);
rec('pt 와 pt-pt 도 같게 본다', sameLang('pt', 'pt-pt'), true);
rec('빈 값은 같지 않다', sameLang('', 'ko'), false);
rec('null 은 같지 않다(원문 언어 미판정 = 번역 후보)', sameLang(null, 'ko'), false);

// --- langForCountry — 대상 언어의 유일한 출처 ---
rec('KR → ko', langForCountry('KR'), 'ko');
rec('JP → ja', langForCountry('JP'), 'ja');
rec('CN → zh-Hans', langForCountry('CN'), 'zh-Hans');
rec('TW → zh-Hant', langForCountry('TW'), 'zh-Hant');
rec('VN → vi', langForCountry('VN'), 'vi');
rec('IN → hi', langForCountry('IN'), 'hi');
rec('BR → pt', langForCountry('BR'), 'pt');
rec('SA → ar', langForCountry('SA'), 'ar');
rec('소문자도 받는다', langForCountry('kr'), 'ko');
rec('모르는 나라는 en 으로 떨어진다', langForCountry('ZZ'), 'en');
rec('미국은 en', langForCountry('US'), 'en');
// ⚠️ null 은 'en' 이 아니라 null 이다 — 국가 미설정은 온보딩으로 보내야 할 상태이지
//    임의 언어로 확정해도 되는 상태가 아니다.
rec('국가 없음 → null(온보딩 유도)', langForCountry(null), null);
rec('빈 문자열 → null', langForCountry(''), null);
rec('세 글자 코드 → null', langForCountry('KOR'), null);

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nCHAT-TRANSLATE-FILTERS: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
