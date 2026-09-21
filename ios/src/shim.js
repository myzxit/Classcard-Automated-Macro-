// ======================================================== 아이폰(사파리) 전용 부분
//
// 확장판은 백그라운드에서 탭을 조종한다(chrome.scripting / chrome.debugger).
// 아이폰 사파리에는 그런 게 없으므로, **스크립트가 페이지 안에서 직접 돈다.**
//
// 그래서 두 가지가 달라진다.
//   1) Driver.eval 이 메시지 왕복 없이 그 자리에서 실행된다 (그래서 더 빠르다).
//   2) 신뢰된 입력(CDP)이 없다. iOS 사파리에는 웹 내용에 진짜 터치·키를
//      꽂아 넣는 공개 방법이 없다. 그래서 사이트가 isTrusted 를 확인하는
//      화면(리콜 정답, 스펠 입력, 문장 계열 낱말 버튼)은 아이폰에서 동작하지
//      않는다. 이건 우리 코드의 한계가 아니라 iOS 의 제약이다.
//      해당 모드는 목록에서 '아이폰 불가'로 표시하고 실행을 막는다.

var StopFlag = __mod.driver.StopFlag;

/** 페이지 안에서 바로 도는 드라이버. 확장판 Driver 와 같은 이름·같은 규칙. */
class IosDriver {
  constructor(logger) {
    this.logger = logger;
    this.tag = '';
    // 확장판과 같은 필드 이름. 아이폰에는 CDP 가 없으므로 항상 '붙지 않음'.
    this.debuggerAttached = false;
    this.debuggerFailed = true;
  }

  log(message, level) {
    this.logger(message, level);
  }

  // ---------------------------------------------------------------- eval
  // 확장판은 executeScript 로 MAIN world 에 넣지만, 여기서는 이미 그 world 다.
  async eval(script) {
    try {
      // eslint-disable-next-line no-new-func
      const v = new Function(script)();
      return v === undefined ? null : v;
    } catch (e) {
      return null;
    }
  }

  async exec(script) { await this.eval(script); }
  async evalBool(script) { return (await this.eval(script)) === true; }

  async evalIntOrNull(script) {
    const v = await this.eval(script);
    if (v === null || v === undefined || v === '') return null;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
  }

  async evalStringOrNull(script) {
    const v = await this.eval(script);
    return v === null || v === undefined ? null : String(v);
  }

  async evalList(script) {
    const v = await this.eval(script);
    return Array.isArray(v) ? v : [];
  }

  // ------------------------------------------------------------ 페이지 상태
  async currentUrl() { return location.href; }
  async title() { return document.title || ''; }

  async loadUrl(url) { location.href = url; }

  async waitForLoad(timeoutMs = 15000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (document.readyState === 'complete') return true;
      await sleep(120);
    }
    return false;
  }

  async waitForSelector(selector, timeoutMs, stop = null) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (stop && stop.isSet) return false;
      if (document.querySelector(selector)) return true;
      await sleep(120);
    }
    return false;
  }

  async waitForVisible(selector, timeoutMs, stop = null) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (stop && stop.isSet) return false;
      const els = document.querySelectorAll(selector);
      for (const el of els) if (el.offsetParent !== null) return true;
      await sleep(120);
    }
    return false;
  }

  // ---------------------------------------------------------------- 클릭
  // 확장판은 '진짜 클릭 먼저, 안 되면 합성 클릭' 이다.
  // 아이폰에는 진짜 클릭 경로가 없으므로 합성 클릭만 남는다.
  async clickSmart(pick) {
    return this.evalBool(`
      var el = null;
      ${pick}
      if (!el) return false;
      try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
      el.click();
      return true;`);
  }

  async clickIndex(selector, index) {
    return this.clickSmart(`
      var e = document.querySelectorAll(${JSON.stringify(selector)});
      el = e[${index}] || null;`);
  }

  async clickFirst(selector) { return this.clickIndex(selector, 0); }

  async clickFirstVisible(selector) {
    return this.clickSmart(`
      var e = document.querySelectorAll(${JSON.stringify(selector)});
      for (var i = 0; i < e.length; i++) {
        if (e[i].offsetParent !== null) { el = e[i]; break; }
      }`);
  }

  // --------------------------------------------------------- 신뢰된 입력(없음)
  async attachDebugger() { return false; }
  async detachDebugger() {}
  async sendCdp() { return false; }

  /** 아이폰에서는 신뢰된 클릭을 만들 수 없다. 확장판과 같은 자리에서 false 를 준다. */
  async trustedClick() { return false; }

  // ---------------------------------------------------------------- 키 입력
  async pressKey(key, { shift = false } = {}) {
    const spec = IOS_KEY_SPECS[key];
    if (!spec) return false;
    return this.evalBool(`
      var opts = {key: ${JSON.stringify(spec.key)}, code: ${JSON.stringify(spec.code)},
                  keyCode: ${spec.keyCode}, which: ${spec.keyCode},
                  shiftKey: ${shift}, bubbles: true, cancelable: true};
      var t = document.activeElement || document.body;
      t.dispatchEvent(new KeyboardEvent('keydown', opts));
      t.dispatchEvent(new KeyboardEvent('keypress', opts));
      t.dispatchEvent(new KeyboardEvent('keyup', opts));
      return true;`);
  }

  async pressSpace() { return this.pressKey('space'); }
  async pressShiftSpace() { return this.pressKey('space', { shift: true }); }
  async pressEnter() { return this.pressKey('enter'); }

  async pressDigit(digit) {
    if (digit < 0 || digit > 9) return false;
    return this.pressKey(String(digit));
  }

  /**
   * 스펠은 입력창의 마지막 keydown 이 진짜인지(isTrusted) 보고 채점한다.
   * 아이폰에서는 진짜 키를 만들 수 없으므로 확장판과 같이 false 를 준다
   * (값만 넣으면 사이트가 "event is not trusted" 로 거부한다).
   */
  async typeText() { return false; }

  async blurActiveElement() {
    await this.exec('if (document.activeElement && document.activeElement.blur) document.activeElement.blur();');
  }
}

const IOS_KEY_SPECS = {
  space: { key: ' ', code: 'Space', keyCode: 32 },
  enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  0: { key: '0', code: 'Digit0', keyCode: 48 },
  1: { key: '1', code: 'Digit1', keyCode: 49 },
  2: { key: '2', code: 'Digit2', keyCode: 50 },
  3: { key: '3', code: 'Digit3', keyCode: 51 },
  4: { key: '4', code: 'Digit4', keyCode: 52 },
  5: { key: '5', code: 'Digit5', keyCode: 53 },
  6: { key: '6', code: 'Digit6', keyCode: 54 },
  7: { key: '7', code: 'Digit7', keyCode: 55 },
  8: { key: '8', code: 'Digit8', keyCode: 56 },
  9: { key: '9', code: 'Digit9', keyCode: 57 },
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------- 모드 목록
//
// needsTrusted: 사이트가 isTrusted 를 확인하는 모드. 아이폰에서는 실행할 수 없다.
const IOS_MODES = [
  { id: 'grammar', label: '📐 문법', fn: () => __mod.grammar.grammar, noDict: true },
  { id: 'matching', label: '🎴 단어 매칭', fn: () => __mod.games.matching, noDict: true },
  { id: 'test', label: '🃏 단어 테스트', fn: () => __mod.games.test },
  { id: 'memorize', label: '🗂 암기', fn: () => __mod.basic.memorize, noDict: true },
  // 스피킹: 낭독·쉐도잉·녹음은 마이크가 필요해 아이폰 사파리에서는 못 돌린다. 나머지 단계만 한다.
  { id: 'speaking', label: '🎤 스피킹 (녹음 빼고)', fn: () => __mod.speaking.speakingNoMic, noDict: true },
  { id: 'fetch', label: '⤵ 단어장 가져오기', special: 'fetch' },
  { id: 'recall', label: '🔁 리콜', needsTrusted: true },
  { id: 'spell', label: '⌨ 스펠', needsTrusted: true },
  { id: 'memorize_sentence', label: '📖 문장 암기', needsTrusted: true },
  { id: 'recall_sentence', label: '📝 문장 리콜', needsTrusted: true },
  // 문장 스펠: 기본 학습설정(어순배열)은 타일 클릭만이라 아이폰에서도 된다. 입력형 설정이면 채점이 거부된다.
  { id: 'spell_sentence', label: '✍ 문장 스펠', fn: () => __mod.sentence.spellSentence, noDict: true },
  { id: 'test_sentence', label: '📕 문장 테스트', needsTrusted: true },
  { id: 'scramble', label: '✳ 문장 스크램블', needsTrusted: true },
];

const DICT_KEY = 'ccIosDict';

function loadDict() {
  try {
    const raw = localStorage.getItem(DICT_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    const m = new Map(Object.entries(obj));
    return m.size ? m : null;
  } catch (e) { return null; }
}

function saveDict(dict) {
  try {
    localStorage.setItem(DICT_KEY, JSON.stringify(Object.fromEntries(dict)));
  } catch (e) { /* 저장 공간이 없으면 이번 실행에만 쓴다 */ }
}

// ---------------------------------------------------------------- 화면(패널)
const panel = document.createElement('div');
panel.id = 'cc-ios-panel';
panel.innerHTML = `
<div class="cc-head">
  <svg class="cc-mascot" viewBox="0 0 120 100" aria-hidden="true"><path d="M12 82q0-58 48-60 48 2 48 60-10 14-48 14-38 0-48-14z" fill="#5fe3d0"/><ellipse cx="44" cy="62" rx="5" ry="7" fill="#1b3d3a"/><ellipse cx="76" cy="62" rx="5" ry="7" fill="#1b3d3a"/><circle cx="42" cy="59" r="1.8" fill="#fff"/><circle cx="74" cy="59" r="1.8" fill="#fff"/><path d="M56 74q4 5 8 0" stroke="#1b3d3a" stroke-width="1.8" fill="none"/><path d="M46 26l6-12 8 10 8-10 6 12z" fill="#ffd86b"/></svg>
  <span class="cc-title">클래스카드 자동화<small>✦ 이세계 학습 길드 · 아이폰</small></span>
  <span class="cc-ver"></span>
  <button class="cc-x" type="button" aria-label="닫기">✕</button>
</div>
<div class="cc-modes"></div>
<details class="cc-more"><summary>아이폰에서 안 되는 모드 보기</summary><div class="cc-locked"></div></details>
<div class="cc-bar">
  <button class="cc-pause" type="button">⏸ 일시정지</button>
  <button class="cc-stop" type="button">■ 정지</button>
  <span class="cc-state">대기 중</span>
</div>
<div class="cc-prog"><div class="cc-prog-txt"></div><div class="cc-prog-bar"><div></div></div></div>
<div class="cc-log" role="log"></div>`;

const style = document.createElement('style');
style.textContent = `
#cc-ios-panel {
  position: fixed; left: 8px; right: 8px; bottom: 8px; z-index: 2147483647;
  background: linear-gradient(160deg, rgba(20,16,56,.96), rgba(59,31,110,.96));
  color: #efe9ff; border-radius: 16px; border: 1px solid rgba(190,160,255,.28);
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif;
  box-shadow: 0 10px 34px rgba(10,5,40,.55); overflow: hidden;
  padding-bottom: env(safe-area-inset-bottom);
}
#cc-ios-panel.cc-min .cc-modes, #cc-ios-panel.cc-min .cc-log, #cc-ios-panel.cc-min .cc-bar,
#cc-ios-panel.cc-min .cc-more { display: none; }
#cc-ios-panel .cc-head {
  display: flex; align-items: center; gap: 8px; padding: 9px 12px;
  background: linear-gradient(90deg, rgba(59,42,138,.9), rgba(139,92,246,.5)); font-weight: 700;
}
#cc-ios-panel .cc-mascot { width: 28px; height: 24px; flex: 0 0 28px; }
#cc-ios-panel .cc-title { flex: 1; }
#cc-ios-panel .cc-title small { display: block; font-weight: 400; font-size: 10px; opacity: .75; }
#cc-ios-panel .cc-ver { opacity: .6; font-weight: 400; font-size: 11px; }
#cc-ios-panel .cc-x {
  background: none; border: 0; color: #efe9ff; font-size: 16px; padding: 2px 4px;
}
#cc-ios-panel .cc-modes {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; padding: 10px;
}
#cc-ios-panel .cc-modes button {
  appearance: none; border: 1px solid rgba(190,160,255,.25); background: rgba(44,36,96,.7); color: #efe9ff;
  border-radius: 11px; padding: 11px 8px; font-size: 13px; text-align: left;
  min-height: 44px;
}
#cc-ios-panel .cc-modes button:disabled { opacity: .38; }
#cc-ios-panel .cc-modes button.cc-on {
  background: linear-gradient(135deg, #8b5cf6, #ec4899); border-color: #a78bfa;
  box-shadow: 0 6px 18px rgba(139,92,246,.5);
}
#cc-ios-panel .cc-bar {
  display: flex; align-items: center; gap: 10px; padding: 0 10px 8px;
}
#cc-ios-panel .cc-stop {
  appearance: none; border: 0; background: linear-gradient(90deg, #e11d48, #f97316); color: #fff;
  border-radius: 9px; padding: 9px 14px; font-size: 13px; min-height: 40px; font-weight: 700;
}
#cc-ios-panel .cc-state { opacity: .8; }
#cc-ios-panel .cc-pause { background: rgba(245,158,11,.25); color: #ffe7b0; border: 1px solid rgba(245,158,11,.5); border-radius: 9px; padding: 5px 10px; font-weight: 700; }
#cc-ios-panel .cc-prog { padding: 0 12px 6px; display: none; }
#cc-ios-panel .cc-prog.on { display: block; }
#cc-ios-panel .cc-prog-txt { font-size: 11px; opacity: .9; }
#cc-ios-panel .cc-prog-bar { height: 7px; border-radius: 5px; background: rgba(255,255,255,.12); overflow: hidden; margin-top: 3px; }
#cc-ios-panel .cc-prog-bar > div { height: 100%; width: 0; background: linear-gradient(90deg, #8b5cf6, #ec4899); transition: width .3s; }
#cc-ios-panel .cc-more { padding: 0 10px 8px; font-size: 12px; opacity: .8; }
#cc-ios-panel .cc-more summary { padding: 6px 2px; cursor: pointer; }
#cc-ios-panel .cc-locked {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; padding-top: 4px;
}
#cc-ios-panel .cc-locked button {
  appearance: none; border: 1px dashed rgba(190,160,255,.35); background: transparent; color: inherit;
  border-radius: 9px; padding: 8px; font-size: 12px; text-align: left; opacity: .5;
}
#cc-ios-panel .cc-log {
  max-height: 22vh; overflow-y: auto; padding: 8px 12px 12px;
  border-top: 1px solid rgba(190,160,255,.2); font-size: 12px; background: rgba(8,6,26,.55);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap; word-break: break-word;
}
#cc-ios-panel .cc-log div.warn { color: #ffcf6b; }
#cc-ios-panel .cc-log div.error { color: #ff8e8a; }
#cc-ios-panel .cc-log div.success { color: #8fe08a; }
@media (prefers-color-scheme: light) {
  #cc-ios-panel {
    background: linear-gradient(160deg, rgba(255,255,255,.97), rgba(233,221,255,.97)); color: #2a1d5e;
    border-color: rgba(124,92,230,.25); box-shadow: 0 8px 28px rgba(60,30,120,.25);
  }
  #cc-ios-panel .cc-head { background: linear-gradient(90deg, rgba(233,221,255,.9), rgba(255,226,236,.9)); }
  #cc-ios-panel .cc-x { color: #2a1d5e; }
  #cc-ios-panel .cc-modes button { background: rgba(255,255,255,.85); border-color: rgba(124,92,230,.22); color: #2a1d5e; }
  #cc-ios-panel .cc-modes button.cc-on { color: #fff; }
  #cc-ios-panel .cc-log { border-top-color: rgba(124,92,230,.2); background: rgba(29,22,80,.92); color: #e5e7eb; }
}`;

document.documentElement.appendChild(style);
document.documentElement.appendChild(panel);

const $log = panel.querySelector('.cc-log');
const $state = panel.querySelector('.cc-state');
const $modes = panel.querySelector('.cc-modes');
const $locked = panel.querySelector('.cc-locked');
panel.querySelector('.cc-ver').textContent = 'iOS';

function addLog(message, level) {
  const row = document.createElement('div');
  if (level) row.className = level;
  const t = new Date().toTimeString().slice(0, 8);
  row.textContent = `[${t}] ${message}`;
  $log.appendChild(row);
  while ($log.childNodes.length > 300) $log.removeChild($log.firstChild);
  $log.scrollTop = $log.scrollHeight;
}

panel.querySelector('.cc-x').addEventListener('click', () => {
  panel.classList.toggle('cc-min');
});
window.__ccIosShow = () => { panel.classList.remove('cc-min'); };

// ---------------------------------------------------------------- 실행
const driver = new IosDriver(addLog);
let current = null;      // 지금 도는 StopFlag
let dict = loadDict();

async function fetchDict() {
  const cards = await __mod.basic.getData(driver);
  const d = __mod.basic.dictFromCards(cards);
  if (d && d.size) {
    dict = d;
    saveDict(d);
    addLog(`단어장 갱신 완료 (${d.size}개)`, 'success');
    return d;
  }
  addLog('단어장 추출 실패 — 학습을 시작해 카드가 보이는 상태에서 다시 눌러 주세요.', 'warn');
  return null;
}

function setRunning(on, label) {
  $state.textContent = on ? `${label} 실행 중…` : '대기 중';
  for (const b of $modes.querySelectorAll('button')) {
    if (b.dataset.trusted === '1') continue;
    b.disabled = on;
    b.classList.toggle('cc-on', on && b.dataset.id === (current && current.__label));
  }
}

async function runMode(mode) {
  if (current) { addLog('이미 실행 중입니다.', 'warn'); return; }
  const stop = new StopFlag();
  stop.__label = mode.id;
  current = stop;
  setRunning(true, mode.label);
  try {
    if (mode.special === 'fetch') {
      await fetchDict();
    } else {
      const fn = mode.fn();
      if (!dict && !mode.noDict) {
        // 카드 데이터는 학습이 시작된 뒤에 채워진다. 시작 화면이면 눌러 보고 다시 읽는다.
        if (await __mod.basic.startStudyIfNeeded(driver, stop)) await stop.await(1200);
        await fetchDict();
      }
      if (!dict && !mode.noDict) {
        addLog('[!] 단어장이 없습니다. 학습을 시작한 뒤 [단어장 가져오기]를 먼저 눌러 주세요.', 'error');
      } else {
        await fn(driver, dict || null, stop);
      }
    }
  } catch (e) {
    addLog(`[오류] ${e && e.message ? e.message : e}`, 'error');
  } finally {
    current = null;
    setRunning(false);
  }
}

for (const mode of IOS_MODES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.id = mode.id;
  if (mode.needsTrusted) {
    // 아이폰에서 안 되는 모드는 접힌 칸에 따로 둔다. 잘못 누를 일이 없다.
    b.dataset.trusted = '1';
    b.disabled = true;
    b.textContent = mode.label;
    b.title = 'iOS 사파리에서는 진짜 터치·키 입력을 만들 수 없어 이 모드는 동작하지 않습니다.';
    $locked.appendChild(b);
  } else {
    b.textContent = mode.label;
    b.addEventListener('click', () => runMode(mode));
    $modes.appendChild(b);
  }
}

panel.querySelector('.cc-stop').addEventListener('click', () => {
  if (current) { current.set(); addLog('정지 요청됨'); }
});
const $pause = panel.querySelector('.cc-pause');
$pause.addEventListener('click', () => {
  if (!current) return;
  if (current.isPaused) { current.resume(); $pause.textContent = '⏸ 일시정지'; addLog('재개합니다.', 'success'); }
  else { current.pause(); $pause.textContent = '▶ 재개'; addLog('일시정지 — 재개를 누를 때까지 멈춥니다.', 'warn'); }
});
// 진행률: 모듈이 driver.progress() 로 알려 준다
const $prog = panel.querySelector('.cc-prog');
driver.onProgress = (p) => {
  const pct = p.total > 0 ? Math.min(100, Math.round((p.current / p.total) * 100)) : 0;
  $prog.classList.add('on');
  $prog.querySelector('.cc-prog-txt').textContent =
    `현재 ${p.current} / ${p.total} · 진행률 ${pct}% · 남은 ${Math.max(0, p.total - p.current)} · 성공 ${p.ok} · 실패 ${p.fail} · 미처리 ${p.skipped}`;
  $prog.querySelector('.cc-prog-bar > div').style.width = `${pct}%`;
};

addLog('아이폰용 자동화 준비 완료. 학습 화면에서 모드를 누르세요.', 'success');
if (dict) addLog(`저장된 단어장 ${dict.size}개를 불러왔습니다.`);
addLog('리콜·스펠·문장 계열은 iOS 제약으로 동작하지 않습니다.', 'warn');
