/*
 * main.py 의 CDP `Page.addScriptToEvaluateOnNewDocument` 로 넣던 두 스크립트를
 * 확장프로그램에서는 document_start 콘텐츠 스크립트(world: MAIN)로 넣는다.
 * (둘 다 "페이지 스크립트보다 먼저" 실행되어야 의미가 있다.)
 *
 *  1) ANTI_BLUR_JS      — 테스트/매칭/스크램블의 '이탈 감지' 우회
 *  2) ANSWER_CAPTURE_JS — 문장 리콜 정답(console.log('arr_front', ...)) 캡처
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
