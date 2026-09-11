package com.classcard.automation.core

/**
 * main.py 의 `ANTI_BLUR_JS` 이식.
 *
 * 테스트/매칭/스크램블의 '이탈 감지'를 우회한다. 탭/창 포커스를 잃어도 페이지가 항상
 * '보이고 포커스된' 상태로 보이게 위장한다(Page Visibility API 고정 +
 * visibilitychange/blur 이벤트를 캡처 단계에서 차단).
 *
 * 페이지 로드 시점 주입은 assets/preload.js 가 담당하고(문서 시작),
 * 이 객체는 모드 진입 직후 한 번 더 덮어씌우는 용도다
 * (Test.py / Matching.py / Scramble.py 의 `suppress_leave_detection` 대응).
 */
object AntiBlur {

    const val SCRIPT = """
(function(){
  try {
    Object.defineProperty(document, 'hidden', {configurable:true, get:function(){return false;}});
    Object.defineProperty(document, 'visibilityState', {configurable:true, get:function(){return 'visible';}});
    Object.defineProperty(document, 'webkitHidden', {configurable:true, get:function(){return false;}});
    Object.defineProperty(document, 'webkitVisibilityState', {configurable:true, get:function(){return 'visible';}});
  } catch(e){}
  try { document.hasFocus = function(){ return true; }; } catch(e){}
  function blocker(e){
    var t = e.type;
    if (t === 'visibilitychange' || t === 'webkitvisibilitychange' ||
        t === 'mozvisibilitychange' || t === 'msvisibilitychange' || t === 'pagehide') {
      e.stopImmediatePropagation(); return;
    }
    if ((t === 'blur' || t === 'focusout') && (e.target === window || e.target === document)) {
      e.stopImmediatePropagation();
    }
  }
  var evts = ['visibilitychange','webkitvisibilitychange','mozvisibilitychange',
              'msvisibilitychange','pagehide','blur','focusout'];
  evts.forEach(function(ev){
    window.addEventListener(ev, blocker, true);
    document.addEventListener(ev, blocker, true);
  });
  try { window.onblur = null; } catch(e){}
})();
"""

    suspend fun inject(d: Driver) {
        d.exec(SCRIPT)
    }
}
