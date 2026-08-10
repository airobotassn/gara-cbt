/* 미니게임 공용 사전 — 인트로·아웃트로·HUD 등 **게임 껍데기 문구**만 담는다.
 *
 * 왜 별도 파일인가:
 *   게임 본체는 자립형 정적 HTML(iframe)이라 앱의 i18n(src/lib/i18n.tsx)을 못 쓴다. 그렇다고 게임마다
 *   사전을 따로 두면 6벌이 되고, '랭킹' 같은 공통 문구가 파일마다 갈린다. 그래서 여기 하나로 모은다.
 *
 * 언어는 어떻게 오나:
 *   부모(src/pages/MiniGame.tsx)가 iframe src 에 `?lang=xx` 를 붙인다. 단독으로 HTML 을 열면
 *   쿼리가 없으므로 한국어로 뜬다(개발 중 직접 열어보는 경우).
 *
 * ⚠️ **문항(POOL)은 여기 없다.** 문제·보기·해설은 각 게임 HTML 의 POOL 과 src/lib/terms.ts 에
 *    한국어로 복제돼 있고, 레벨테스트처럼 콘텐츠 파이프라인을 붙여야 언어를 따라간다(별도 과제).
 *    여기 있는 건 "버티기 시작"·"신기록" 처럼 문항과 무관한 화면 글자뿐이다.
 *
 * 쓰는 법:
 *   1) HTML 요소에 data-i18n="키"  → 그 요소의 innerHTML 을 사전값으로 바꾼다(<b> 같은 태그 허용).
 *      속성에 넣으려면 data-i18n-attr="aria-label:키" 형식.
 *   2) JS 안에서는 MGI18N.t('키', { n: 3 }) — {n} 자리표시자 보간.
 *   3) 문서 끝에서 MGI18N.apply() 한 번. (DOM 이 다 그려진 뒤여야 한다)
 */
(function () {
  var LANGS = ['ko', 'en', 'ja', 'zh', 'hi', 'vi']

  function detect() {
    try {
      var q = new URLSearchParams(window.location.search).get('lang')
      if (q && LANGS.indexOf(q) >= 0) return q
    } catch (e) { /* 구형 브라우저 — 한국어로 떨어진다 */ }
    return 'ko'
  }

  var LANG = detect()

  // ── 공통(앱 브리지) ──────────────────────────────────────────────────────
  // 각 게임 HTML 끝의 '앱 브리지' 블록이 만드는 랭킹 버튼. 6개 게임이 같은 코드를 복제하고 있어
  // 문구도 같이 복제돼 있었다 — 여기 한 곳에서만 관리한다.
  var D = {
    'mg.rank': { ko: '랭킹', en: 'Ranking', ja: 'ランキング', zh: '排行榜', hi: 'रैंकिंग', vi: 'Xếp hạng' },
    'mg.rank_aria': { ko: '이 게임 랭킹 보기', en: 'View ranking for this game', ja: 'このゲームのランキングを見る', zh: '查看本游戏排行榜', hi: 'इस गेम की रैंकिंग देखें', vi: 'Xem xếp hạng trò chơi này' },
    'mg.best': { ko: '최고', en: 'Best', ja: '最高', zh: '最佳', hi: 'सर्वश्रेष्ठ', vi: 'Tốt nhất' },
    'mg.score': { ko: '점수', en: 'Score', ja: 'スコア', zh: '分数', hi: 'स्कोर', vi: 'Điểm' },
    'mg.newbest': { ko: '🏆 신기록!', en: '🏆 New best!', ja: '🏆 新記録！', zh: '🏆 新纪录！', hi: '🏆 नया रिकॉर्ड!', vi: '🏆 Kỷ lục mới!' },
    'mg.retry': { ko: '다시 도전', en: 'Play again', ja: 'もう一度', zh: '再来一局', hi: 'फिर से खेलें', vi: 'Chơi lại' },
    'mg.paused': { ko: '잠깐 멈춤', en: 'Paused', ja: '一時停止', zh: '已暂停', hi: 'रुका हुआ', vi: 'Tạm dừng' },
    'mg.resume': { ko: '계속하기', en: 'Resume', ja: '再開する', zh: '继续', hi: 'जारी रखें', vi: 'Tiếp tục' },
    'mg.ready': { ko: '준비되면 시작하세요', en: 'Start when you’re ready', ja: '準備ができたら開始', zh: '准备好就开始吧', hi: 'तैयार हों तो शुरू करें', vi: 'Sẵn sàng thì bắt đầu' },
    'mg.reset': { ko: '초기화', en: 'Reset', ja: 'リセット', zh: '重置', hi: 'रीसेट', vi: 'Đặt lại' },
    'mg.level_n': { ko: '레벨 {n}', en: 'Level {n}', ja: 'レベル {n}', zh: '第 {n} 关', hi: 'लेवल {n}', vi: 'Cấp {n}' },

    // ── 버텨라 CARI (beat-cari) ────────────────────────────────────────────
    'beat.title': { ko: '버텨라', en: 'Hold On', ja: '耐えろ', zh: '撑住吧', hi: 'डटे रहो', vi: 'Trụ vững' },
    'beat.tagline': { ko: '쏟아지는 돌, 문제로 버텨라!', en: 'Rocks are falling — answer to survive!', ja: '降り注ぐ岩を、問題で耐えろ！', zh: '落石不断，用答题撑下去！', hi: 'पत्थर बरस रहे हैं — जवाब देकर टिको!', vi: 'Đá rơi ào ạt — trả lời để trụ lại!' },
    'beat.rule1': { ko: '문제 <b>맞히면</b> 천장이 올라가요', en: 'Answer <b>correctly</b> and the ceiling rises', ja: '正解すると<b>天井が上がります</b>', zh: '答对了<b>天花板就会上升</b>', hi: '<b>सही जवाब</b> पर छत ऊपर जाती है', vi: 'Trả lời <b>đúng</b> thì trần nâng lên' },
    'beat.rule2': { ko: '틀리거나 못 풀면 <b>내려와요</b>', en: 'Miss it and the ceiling <b>drops</b>', ja: '間違えたり解けないと<b>下がります</b>', zh: '答错或没答出<b>就会下降</b>', hi: 'गलत या छूट जाए तो <b>नीचे आती है</b>', vi: 'Sai hoặc bỏ qua thì <b>hạ xuống</b>' },
    'beat.rule3': { ko: '깔리기 전까지 버텨 <b>점수</b>를 쌓아요', en: 'Survive and stack up your <b>score</b>', ja: '潰される前に耐えて<b>スコア</b>を稼ごう', zh: '在被压扁前坚持，累积<b>分数</b>', hi: 'दबने से पहले टिको और <b>स्कोर</b> बढ़ाओ', vi: 'Trụ đến cùng để tích <b>điểm</b>' },
    'beat.start': { ko: '버티기 시작', en: 'Start holding on', ja: '耐え始める', zh: '开始坚持', hi: 'डटना शुरू करें', vi: 'Bắt đầu trụ' },
    'beat.over': { ko: '여기까지 버텼어요!', en: 'You held on this long!', ja: 'ここまで耐えました！', zh: '你坚持到了这里！', hi: 'आप यहाँ तक टिके!', vi: 'Bạn đã trụ đến đây!' },
    'beat.solved': { ko: '푼 문제', en: 'Solved', ja: '解いた問題', zh: '已答题数', hi: 'हल किए', vi: 'Đã giải' },
    'beat.accuracy': { ko: '정답률', en: 'Accuracy', ja: '正答率', zh: '正确率', hi: 'सटीकता', vi: 'Độ chính xác' },
    'beat.streak': { ko: '🔥 {n} 연속', en: '🔥 {n} streak', ja: '🔥 {n} 連続', zh: '🔥 连续 {n}', hi: '🔥 {n} लगातार', vi: '🔥 {n} liên tiếp' },
    'beat.correct': { ko: '+정답!', en: '+Correct!', ja: '+正解！', zh: '+答对！', hi: '+सही!', vi: '+Đúng!' },
    'beat.combo': { ko: '+정답! x{n}', en: '+Correct! x{n}', ja: '+正解！x{n}', zh: '+答对！x{n}', hi: '+सही! x{n}', vi: '+Đúng! x{n}' },
    'beat.wrong': { ko: '오답', en: 'Wrong', ja: '不正解', zh: '答错', hi: 'गलत', vi: 'Sai' },
    'beat.pass': { ko: '패스', en: 'Skipped', ja: 'パス', zh: '跳过', hi: 'छोड़ा', vi: 'Bỏ qua' },
    'beat.bust': { ko: '꽝!', en: 'Bust!', ja: 'はずれ！', zh: '没中！', hi: 'चूक!', vi: 'Hụt!' },

    // ── 쏴라 CARI (shoot-cari) ────────────────────────────────────────────
    'shoot.title': { ko: '쏴라', en: 'Shoot', ja: '撃て', zh: '射击吧', hi: 'मारो', vi: 'Bắn đi' },
    'shoot.tagline': { ko: '쏟아지는 적 기체를 정답으로 격추하라!', en: 'Shoot down the incoming ships with the right answer!', ja: '押し寄せる敵機を正解で撃ち落とせ！', zh: '用正确答案击落来袭敌机！', hi: 'सही जवाब से आते हुए विमान गिराओ!', vi: 'Bắn hạ phi thuyền địch bằng đáp án đúng!' },
    'shoot.start': { ko: '게임 시작', en: 'Start game', ja: 'ゲーム開始', zh: '开始游戏', hi: 'गेम शुरू करें', vi: 'Bắt đầu' },
    'shoot.over': { ko: '요격 종료!', en: 'Interception over!', ja: '迎撃終了！', zh: '拦截结束！', hi: 'रोकथाम समाप्त!', vi: 'Kết thúc đánh chặn!' },
    'shoot.newbest': { ko: '🎉 신기록!', en: '🎉 New best!', ja: '🎉 新記録！', zh: '🎉 新纪录！', hi: '🎉 नया रिकॉर्ड!', vi: '🎉 Kỷ lục mới!' },
    'shoot.hits': { ko: '요격', en: 'Hits', ja: '迎撃', zh: '拦截', hi: 'हिट', vi: 'Bắn trúng' },
    'shoot.combo': { ko: '최대 콤보', en: 'Best combo', ja: '最大コンボ', zh: '最高连击', hi: 'सर्वाधिक कॉम्बो', vi: 'Combo cao nhất' },
    'shoot.aiming': { ko: '다음 적 기체 조준 중…', en: 'Locking on to the next ship…', ja: '次の敵機を照準中…', zh: '正在瞄准下一架敌机…', hi: 'अगले विमान पर निशाना…', vi: 'Đang ngắm phi thuyền tiếp theo…' },
    'shoot.answer': { ko: '정답', en: 'Answer', ja: '正解', zh: '正确答案', hi: 'उत्तर', vi: 'Đáp án' },
    'shoot.miss': { ko: '틀렸어!', en: 'Missed!', ja: '外れ！', zh: '打偏了！', hi: 'चूक गए!', vi: 'Trượt rồi!' },

    // ── 골라라 CARI (pick-cari) ───────────────────────────────────────────
    'pick.title': { ko: '골라라', en: 'Choose', ja: '選べ', zh: '快选吧', hi: 'चुनो', vi: 'Chọn đi' },
    'pick.tagline': { ko: '발판이 무너지기 전에 O·X 를 골라라!', en: 'Pick O or X before the platform gives way!', ja: '足場が崩れる前に ○×を選べ！', zh: '在踏板塌陷前选出 O 或 X！', hi: 'प्लेटफ़ॉर्म गिरने से पहले O या X चुनो!', vi: 'Chọn O hoặc X trước khi bệ sập!' },
    'pick.rule1': { ko: '뜻이 <b>맞으면 O</b>, 틀리면 <b>X 발판</b>으로', en: 'If the meaning is right go to <b>O</b>, if wrong go to <b>X</b>', ja: '意味が<b>合っていれば O</b>、違えば <b>X の足場</b>へ', zh: '释义正确走 <b>O</b>，错误走 <b>X</b> 踏板', hi: 'अर्थ सही हो तो <b>O</b>, गलत हो तो <b>X</b> पर जाएँ', vi: 'Nghĩa đúng thì sang <b>O</b>, sai thì sang <b>X</b>' },
    'pick.rule2': { ko: '10초 뒤 <b>틀린 발판이 무너져요</b>', en: 'After 10 seconds <b>the wrong platform collapses</b>', ja: '10秒後に<b>間違った足場が崩れます</b>', zh: '10 秒后<b>错误的踏板会塌陷</b>', hi: '10 सेकंड बाद <b>गलत प्लेटफ़ॉर्म गिर जाता है</b>', vi: 'Sau 10 giây <b>bệ sai sẽ sập</b>' },
    'pick.start': { ko: '골라보기', en: 'Start choosing', ja: '選んでみる', zh: '开始选择', hi: 'चुनना शुरू करें', vi: 'Bắt đầu chọn' },
    'pick.stage': { ko: '스테이지', en: 'Stage', ja: 'ステージ', zh: '关卡', hi: 'स्टेज', vi: 'Màn' },
    'pick.alive': { ko: '생존', en: 'Alive', ja: '生存', zh: '存活', hi: 'ज़िंदा', vi: 'Còn sống' },
    'pick.wait': { ko: '대기', en: 'Waiting', ja: '待機', zh: '等待', hi: 'प्रतीक्षा', vi: 'Chờ' },
    'pick.answer': { ko: '정답', en: 'Answer', ja: '正解', zh: '正确答案', hi: 'उत्तर', vi: 'Đáp án' },
    'pick.desc_true': { ko: '맞는 설명', en: 'The description is correct', ja: '正しい説明です', zh: '这个说法是对的', hi: 'यह विवरण सही है', vi: 'Mô tả này đúng' },
    'pick.desc_false': { ko: '틀린 설명', en: 'The description is wrong', ja: '誤った説明です', zh: '这个说法是错的', hi: 'यह विवरण गलत है', vi: 'Mô tả này sai' },
    'pick.yes': { ko: '맞다', en: 'True', ja: '正しい', zh: '正确', hi: 'सही', vi: 'Đúng' },
    'pick.no': { ko: '아니다', en: 'False', ja: '違う', zh: '错误', hi: 'गलत', vi: 'Sai' },
    'pick.people': { ko: '{n}명', en: '{n}', ja: '{n}人', zh: '{n} 人', hi: '{n}', vi: '{n} người' },
    'pick.over': { ko: '여기서 발판이 무너졌어요!', en: 'The platform gave way here!', ja: 'ここで足場が崩れました！', zh: '踏板在这里塌了！', hi: 'यहाँ प्लेटफ़ॉर्म गिर गया!', vi: 'Bệ đã sập ở đây!' },
    'pick.cleared': { ko: '끝까지 살아남았어요!', en: 'You survived to the end!', ja: '最後まで生き残りました！', zh: '你坚持到了最后！', hi: 'आप अंत तक बचे रहे!', vi: 'Bạn sống sót đến cuối!' },
    'pick.last': { ko: '마지막 생존자!', en: 'Last one standing!', ja: '最後の生存者！', zh: '最后的幸存者！', hi: 'आख़िरी बचे हुए!', vi: 'Người sống sót cuối cùng!' },
    'pick.stage_reached': { ko: '생존 스테이지', en: 'Stages survived', ja: '生存ステージ', zh: '存活关卡', hi: 'बचे स्टेज', vi: 'Màn sống sót' },
    'pick.newbest': { ko: '신기록!', en: 'New best!', ja: '新記録！', zh: '新纪录！', hi: 'नया रिकॉर्ड!', vi: 'Kỷ lục mới!' },
    'pick.final_rank': { ko: '최종 순위', en: 'Final rank', ja: '最終順位', zh: '最终名次', hi: 'अंतिम रैंक', vi: 'Hạng chung cuộc' },
    'pick.remaining': { ko: '남은 인원', en: 'Remaining', ja: '残り人数', zh: '剩余人数', hi: 'बचे लोग', vi: 'Còn lại' },
    'pick.best_record': { ko: '최고 기록', en: 'Best record', ja: '最高記録', zh: '最佳纪录', hi: 'सर्वश्रेष्ठ रिकॉर्ड', vi: 'Kỷ lục tốt nhất' },
    'pick.me': { ko: '나', en: 'Me', ja: '私', zh: '我', hi: 'मैं', vi: 'Tôi' },
    'pick.rank_n': { ko: '{n}위', en: '#{n}', ja: '{n}位', zh: '第 {n} 名', hi: '#{n}', vi: 'Hạng {n}' },
  }

  function t(key, vars) {
    var e = D[key]
    var s = e ? (e[LANG] || e.ko) : key
    if (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          s = s.split('{' + k + '}').join(String(vars[k]))
        }
      }
    }
    return s
  }

  /** data-i18n / data-i18n-attr 이 붙은 요소를 사전값으로 갈아끼운다.
   *  ⚠️ 사전값에 <b> 같은 태그가 들어 있어 innerHTML 을 쓴다 — **우리가 쓴 문자열만** 들어오는
   *     자리이고 사용자 입력이 닿지 않는다(문항도 여기로 안 온다). */
  function apply(root) {
    var scope = root || document
    var nodes = scope.querySelectorAll('[data-i18n]')
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i]
      var key = el.getAttribute('data-i18n')
      if (D[key]) el.innerHTML = t(key)
    }
    var attrs = scope.querySelectorAll('[data-i18n-attr]')
    for (var j = 0; j < attrs.length; j++) {
      var el2 = attrs[j]
      var spec = el2.getAttribute('data-i18n-attr') || ''
      var parts = spec.split(':')
      if (parts.length === 2 && D[parts[1]]) el2.setAttribute(parts[0], t(parts[1]))
    }
    // <html lang> 도 맞춰준다 — 폰트·줄바꿈 규칙이 언어별로 달라진다.
    try { document.documentElement.setAttribute('lang', LANG) } catch (e) { /* 무시 */ }
  }

  window.MGI18N = { lang: LANG, t: t, apply: apply }
})()
