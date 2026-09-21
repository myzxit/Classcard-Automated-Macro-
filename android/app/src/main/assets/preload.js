/*
 * main.py 의 CDP `Page.addScriptToEvaluateOnNewDocument` 로 넣던 두 스크립트를
 * 안드로이드에서는 WebViewCompat.addDocumentStartJavaScript 로 넣는다.
 * (둘 다 "페이지 스크립트보다 먼저" 실행되어야 의미가 있다.)
 *
 *  1) ANTI_BLUR_JS      — 테스트/매칭/스크램블의 '이탈 감지' 우회
 *  2) ANSWER_CAPTURE_JS — 문장 리콜 정답(console.log('arr_front', ...)) 캡처
 *  3) 데스크톱 뷰포트 강제 — 폰 화면에서도 클래스카드가 모바일 레이아웃으로
 *     바뀌지 않게 한다(모바일 레이아웃이면 스크램블 타일이 잘려 자동화가 깨진다).
 */

/* ---------------------------------------------------------------- 1) 이탈 감지 우회 */
(function () {
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return false; } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'visible'; } });
    Object.defineProperty(document, 'webkitHidden', { configurable: true, get: function () { return false; } });
    Object.defineProperty(document, 'webkitVisibilityState', { configurable: true, get: function () { return 'visible'; } });
  } catch (e) {}
  try { document.hasFocus = function () { return true; }; } catch (e) {}

  function blocker(e) {
    var t = e.type;
    if (t === 'visibilitychange' || t === 'webkitvisibilitychange' ||
        t === 'mozvisibilitychange' || t === 'msvisibilitychange' || t === 'pagehide') {
      e.stopImmediatePropagation();
      return;
    }
    if ((t === 'blur' || t === 'focusout') && (e.target === window || e.target === document)) {
      e.stopImmediatePropagation();
    }
  }

  var evts = ['visibilitychange', 'webkitvisibilitychange', 'mozvisibilitychange',
              'msvisibilitychange', 'pagehide', 'blur', 'focusout'];
  evts.forEach(function (ev) {
    window.addEventListener(ev, blocker, true);
    document.addEventListener(ev, blocker, true);
  });
  try { window.onblur = null; } catch (e) {}
})();

/* ------------------------------------------------------- 2) 문장 리콜 정답 캡처 */
(function () {
  try {
    if (window.__ccAnswerHook) return;
    window.__ccAnswerHook = true;
    window.__cc_answers = [];
    var orig = console.log;
    console.log = function () {
      try {
        if (arguments[0] === 'arr_front') {
          var s = null;
          for (var i = 1; i < arguments.length; i++) {
            if (typeof arguments[i] === 'string' && arguments[i].trim()) {
              s = arguments[i].trim();
              break;
            }
          }
          if (!s && Array.isArray(arguments[1])) s = arguments[1].join(' ');
          if (s) window.__cc_answers.push(s);
        }
      } catch (e) {}
      return orig.apply(console, arguments);
    };
  } catch (e) {}
})();

/* --------------------------------------------------- 3) 데스크톱 뷰포트 강제 */
(function () {
  var WIDTH = 1280;

  function forceViewport() {
    try {
      var metas = document.querySelectorAll('meta[name="viewport"]');
      for (var i = 0; i < metas.length; i++) {
        metas[i].setAttribute('content', 'width=' + WIDTH);
      }
      if (!metas.length && document.head) {
        var m = document.createElement('meta');
        m.setAttribute('name', 'viewport');
        m.setAttribute('content', 'width=' + WIDTH);
        document.head.appendChild(m);
      }
    } catch (e) {}
  }

  forceViewport();
  document.addEventListener('DOMContentLoaded', forceViewport, true);

  // 페이지가 나중에 viewport 를 바꿔 끼우는 경우까지 막는다.
  try {
    var mo = new MutationObserver(function () { forceViewport(); });
    var start = function () {
      if (document.head) mo.observe(document.head, { childList: true, subtree: true });
    };
    if (document.head) start();
    else document.addEventListener('DOMContentLoaded', start, true);
  } catch (e) {}

  // 자가 진단용 — Kotlin 쪽에서 읽어 좁은 뷰포트를 경고한다.
  window.__ccViewportInfo = function () {
    return {
      innerWidth: window.innerWidth,
      pageSmall: !!(document.body && document.body.classList.contains('page-small'))
    };
  };
})();

/* ------------------------------------------------- 3) 카드 데이터(study-data-payload) 보관 */
// 지금 사이트(v3 학습 화면)는 카드 목록을 <script id="study-data-payload"> JSON 으로 싣고,
// 페이지 스크립트가 읽자마자 지워 버린다(그 뒤로는 closure 안에만 있다). 그래서 지워지기 전에
// 우리가 먼저 읽어 window.__cc_study_data 에 둔다 — 시작 화면에서도 단어장을 만들 수 있다.
(function () {
  try {
    if (window.__ccStudyDataHook) return;
    window.__ccStudyDataHook = true;
    function grab() {
      try {
        var el = document.getElementById('study-data-payload');
        if (!el) return false;
        var arr = JSON.parse(el.textContent || 'null');
        if (Array.isArray(arr) && arr.length) { window.__cc_study_data = arr; return true; }
      } catch (e) {}
      return false;
    }
    // 페이지의 jQuery(ready) 보다 먼저 등록되므로 DOMContentLoaded 에서 먼저 읽는다
    document.addEventListener('DOMContentLoaded', grab, true);
    // 혹시 그 전에 보이면 그때 바로
    var mo = new MutationObserver(function () { if (grab()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', function () { setTimeout(function () { mo.disconnect(); }, 3000); });
  } catch (e) {}
})();

/* ------------------------------------------- 4) 클래스 테스트 정답(.answer.hidden) 보관 */
// 클래스 테스트(문장 테스트) 화면(/ClassTest/…, scripts/v2/class_test_sentence.js)은 문제마다
// `.answer.hidden` 에 정답을 싣고, 페이지 스크립트가 읽자마자 지운 뒤 closure 안 obj_answer 로만 쓴다.
// 그래서 지워지기 전에 우리가 먼저 읽어 window.__cc_test_answers 에 둔다 (문제 id 별).
(function () {
  try {
    if (window.__ccTestAnswerHook) return;
    window.__ccTestAnswerHook = true;
    window.__cc_test_answers = {};
    function txt(el) { return el ? (el.textContent || '').replace(/[ \t\r\n]+/g, ' ').trim() : ''; }
    function grab() {
      var cards = document.querySelectorAll('.flip-card');
      var got = 0;
      for (var i = 0; i < cards.length; i++) {
        var qi = cards[i].querySelector('[name="test_question[]"]');
        if (!qi || !qi.value) continue;
        var key = 'q' + qi.value;
        if (window.__cc_test_answers[key]) { got++; continue; }
        var a = txt(cards[i].querySelector('.answer.hidden')) || txt(cards[i].querySelector('.answer_dp.hidden'));
        if (a) { window.__cc_test_answers[key] = a; got++; }
      }
      return got > 0 && got === cards.length;
    }
    document.addEventListener('DOMContentLoaded', grab, true);
    var mo = new MutationObserver(function () { if (grab()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', function () { setTimeout(function () { grab(); mo.disconnect(); }, 3000); });
  } catch (e) {}
})();
