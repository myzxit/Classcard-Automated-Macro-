/* 클래스카드 자동화 — 아이폰(사파리)용 한 파일 빌드
 * 원본: extension/engine/**  (ios/build.mjs 로 자동 생성 — 직접 고치지 마세요)
 */
(function () {
'use strict';
if (window.__ccIosLoaded) { window.__ccIosShow(); return; }
window.__ccIosLoaded = true;
var __mod = {};
// ======================================================== extension/engine/norm.js
__mod.norm = (function () {

/**
 * 파이썬 모듈들에 흩어져 있던 정규화/토큰화 함수를 한곳에 모아 1:1 이식한 것.
 * (안드로이드판 core/Norm.kt 와 같은 내용 — 두 버전이 같은 결과를 내야 한다.)
 */

/** `unicodedata.normalize('NFKC', s)` */
function nfkc(text) {
  if (!text) return '';
  return String(text).normalize('NFKC');
}

// Test.py / Matching.py 의 `_NON_MATCH`, Scramble.py 의 `_NON_KO`
const NON_MATCH = /[^가-힣a-zA-Z]/g;
// Scramble.py 의 `_NON_WORD`
const NON_WORD = /[^a-zA-Z0-9]/g;
// Matching.py / Scramble.py 의 `_TAG`
const TAG = /<[^>]+>/g;
// MemorizeSentence.py 의 제로폭 문자 + TestSentence.py 의 `_WS`
const WS_ZERO_WIDTH = /[\s​‌‍‎‏﻿]/g;
const ZERO_WIDTH = /[​‌‍‎‏﻿]/g;

/** `html.unescape` 의 실사용 범위 대응. */
function unescapeHtml(text) {
  if (!text.includes('&')) return text;
  let out = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
  out = out.replace(/&#(x?)([0-9a-fA-F]+);/g, (m, hex, code) => {
    const n = parseInt(code, hex ? 16 : 10);
    return Number.isNaN(n) ? m : String.fromCodePoint(n);
  });
  return out;
}

/** Matching.py / Scramble.py 의 `_strip_tags` */
function stripTags(text) {
  return unescapeHtml(String(text || '').replace(TAG, ' '));
}

/**
 * Test.py 의 `mnorm` — NFKC + 한글/영문만.
 * 주의: Test.py 는 HTML 태그를 제거하지 **않는다**(Matching.py 와 다른 점).
 */
function mnorm(text) {
  return nfkc(text).replace(NON_MATCH, '');
}

/** Matching.py 의 `mnorm` — 태그 제거까지 한다. */
function mnormHtml(text) {
  return nfkc(stripTags(text)).replace(NON_MATCH, '');
}

/** Scramble.py 의 `knorm` */
function knorm(text) {
  return nfkc(stripTags(text)).replace(NON_MATCH, '');
}

/** Scramble.py 의 `wnorm` */
function wnorm(word) {
  return nfkc(word).replace(NON_WORD, '').toLowerCase();
}

/** TestSentence.py 의 `norm_en` */
function normEn(token) {
  return String(token || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** TestSentence.py 의 `normalize_kor` */
function normalizeKor(text) {
  return nfkc(text).replace(WS_ZERO_WIDTH, '');
}

/** MemorizeSentence.py 의 `normalize_text` */
function normalizeText(text) {
  return nfkc(text).replace(ZERO_WIDTH, '').split(/\s+/).filter(Boolean).join('');
}

/** TestSentence.py / RecallSentence.py 의 `strip_parens` (괄호만 제거) */
function stripParensSimple(text) {
  return String(text || '').replace(/\([^)]*\)/g, '');
}

/** RecallSentence.py 의 `strip_parens` (괄호 제거 + 공백 정리) */
function stripParens(text) {
  return String(text || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

/** RecallSentence.py 의 `_UNICODE_NORMALIZE` / `normalize_unicode` */
const UNICODE_MAP = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
  '–': '-', '—': '-', '−': '-',
  '…': '...',
};

function normalizeUnicode(text) {
  let out = String(text);
  for (const [from, to] of Object.entries(UNICODE_MAP)) out = out.split(from).join(to);
  return out;
}

/** RecallSentence.py 의 `_wkey` */
function wkey(token) {
  return normalizeUnicode(token).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Scramble.py 의 `_mnorm` — 구두점은 유지하고 따옴표/대시만 통일 */
function scrambleNorm(s) {
  let out = nfkc(s);
  const map = {
    '’': "'", '‘': "'", '‚': "'",
    '“': '"', '”': '"',
    '–': '-', '—': '-', '−': '-',
  };
  for (const [from, to] of Object.entries(map)) out = out.split(from).join(to);
  return out.replace(/\s+/g, '').toLowerCase();
}

// ------------------------------------------------------------------ 토큰화

/** 파이썬 `re.split(r'(?<=\S)(?=\()', word)` 대응 */
function splitBeforeParen(word) {
  const parts = [];
  let start = 0;
  for (let i = 1; i < word.length; i++) {
    if (word[i] === '(' && !/\s/.test(word[i - 1])) {
      parts.push(word.slice(start, i));
      start = i;
    }
  }
  parts.push(word.slice(start));
  return parts;
}

/** RecallSentence.py 의 `tokenize` */
function tokenize(text) {
  const tokens = [];
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    tokens.push(...splitBeforeParen(word).filter(Boolean));
  }
  return tokens;
}

/** 파이썬 `re.split(r"(...)", s)` 처럼 구분자를 결과에 남기는 분리 */
function splitKeepingDelimiters(text, delimiter) {
  const out = [];
  let last = 0;
  const re = new RegExp(delimiter.source, delimiter.flags.includes('g') ? delimiter.flags : delimiter.flags + 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(text.slice(last, m.index));
    out.push(m[0]);
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  out.push(text.slice(last));
  return out;
}

/** RecallSentence.py 의 `tokenize_loose` */
function tokenizeLoose(text) {
  const result = [];
  for (const t of tokenize(text)) {
    for (const piece of splitKeepingDelimiters(t, /[-–—'"]/g)) {
      if (!piece) continue;
      const m = /^(.+?)([,.!?;:]+)$/.exec(piece);
      if (m && /\w/.test(m[1])) {
        result.push(m[1]);
        result.push(m[2]);
      } else {
        result.push(piece);
      }
    }
  }
  return result;
}

/** MemorizeSentence.py / TestSentence.py 의 `parse_english_words` */
function parseEnglishWords(sentence) {
  return String(sentence || '').match(/\([^)]*\)|\S+/g) || [];
}

/** RecallSentence.py 의 `is_prefix_punct_split` */
function isPrefixPunctSplit(prefixTokens) {
  return prefixTokens.some((t) => isPunctOnly(t));
}

/** 단독 구두점/하이픈/따옴표 토큰인지 */
function isPunctOnly(token) {
  return /^[,.!?;:\-–—'"]+$/.test(token);
}

/** Scramble.py 의 순수 문장부호 판별 `re.fullmatch(r'[^\w]+', tok)` */
function isNonWordOnly(token) {
  return /^[^\w]+$/.test(token);
}

/** Scramble.py 의 `split_target_words` */
function splitTargetWords(target) {
  const words = [];
  for (const w of String(target || '').split(/\s+/).filter(Boolean)) {
    const m = /^(.+?)([^\w]+)$/.exec(w);
    if (m) {
      words.push(m[1]);
      words.push(m[2]);
    } else {
      words.push(w);
    }
  }
  return words;
}

/** TestSentence.py 의 `_split_subtokens` */
function splitSubtokens(token) {
  if (token.includes('(') && token.includes(')')) {
    const subs = [];
    for (const part of splitKeepingDelimiters(token, /\([^)]*\)/g)) {
      const cleaned = part.replace(/^[()]+|[()]+$/g, '');
      subs.push(...cleaned.split(/\s+/).filter(Boolean));
    }
    return subs;
  }
  if (/[-–—]/.test(token)) {
    return token.split(/[-–—]/).filter(Boolean);
  }
  return [];
}

/** MemorizeSentence.py 의 하이픈 분리 폴백 */
function splitByDash(token) {
  return splitKeepingDelimiters(token, /[-–—]/g).filter(Boolean);
}

/** MemorizeSentence.py 의 괄호 분리 폴백 */
function splitByParenGroup(token) {
  return splitKeepingDelimiters(token, /\([^)]*\)/g).filter(Boolean);
}

/** 공백 전부 제거 (`''.join(text.split())`) */
function squeeze(text) {
  return String(text).split(/\s+/).filter(Boolean).join('');
}

  return { nfkc, stripTags, mnorm, mnormHtml, knorm, wnorm, normEn, normalizeKor, normalizeText, stripParensSimple, stripParens, normalizeUnicode, wkey, scrambleNorm, tokenize, tokenizeLoose, parseEnglishWords, isPrefixPunctSplit, isPunctOnly, isNonWordOnly, splitTargetWords, splitSubtokens, splitByDash, splitByParenGroup, squeeze };
})();

// ======================================================== extension/engine/similarity.js
__mod.similarity = (function () {

/**
 * 파이썬 `difflib.SequenceMatcher(None, a, b).ratio()` 이식.
 *
 * Test.py / Matching.py 의 `_ratio` 가 0.6 임계값으로 유사도 폴백을 판단하므로,
 * 값이 원본과 같아야 동작이 같아진다. difflib 과 동일하게
 * "재귀적 최장 일치 블록의 총 길이 M" 으로 `2M / (len(a)+len(b))` 를 계산한다.
 */

function ratio(a, b) {
  if (!a || !b) return 0.0;
  const matches = matchCount(a, b, 0, a.length, 0, b.length);
  return (2.0 * matches) / (a.length + b.length);
}

/** difflib 의 get_matching_blocks 와 같은 재귀 분할로 일치 문자 수를 센다. */
function matchCount(a, b, alo, ahi, blo, bhi) {
  const [i, j, k] = findLongestMatch(a, b, alo, ahi, blo, bhi);
  if (k === 0) return 0;
  let total = k;
  if (alo < i && blo < j) total += matchCount(a, b, alo, i, blo, j);
  if (i + k < ahi && j + k < bhi) total += matchCount(a, b, i + k, ahi, j + k, bhi);
  return total;
}

/** difflib.SequenceMatcher.find_longest_match 이식. 반환: [i, j, size] */
function findLongestMatch(a, b, alo, ahi, blo, bhi) {
  const b2j = new Map();
  for (let idx = blo; idx < bhi; idx++) {
    const ch = b[idx];
    if (!b2j.has(ch)) b2j.set(ch, []);
    b2j.get(ch).push(idx);
  }

  let bestI = alo;
  let bestJ = blo;
  let bestSize = 0;
  let j2len = new Map();

  for (let i = alo; i < ahi; i++) {
    const newJ2Len = new Map();
    const positions = b2j.get(a[i]) || [];
    for (const j of positions) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) || 0) + 1;
      newJ2Len.set(j, k);
      if (k > bestSize) {
        bestI = i - k + 1;
        bestJ = j - k + 1;
        bestSize = k;
      }
    }
    j2len = newJ2Len;
  }

  return [bestI, bestJ, bestSize];
}

  return { ratio };
})();

// ======================================================== extension/engine/driver.js
__mod.driver = (function () {

/**
 * Selenium WebDriver 를 대신하는 탭 조종기.
 *
 * 파이썬 원본의 두 축을 그대로 옮겼다.
 *  - `driver.execute_script(...)`            -> eval()  (chrome.scripting, world: MAIN)
 *  - CDP `Input.dispatchMouseEvent` / 키 입력 -> chrome.debugger (원본과 '같은' CDP다)
 *
 * 페이지가 이동해도 이 객체는 백그라운드에 살아 있으므로, AutoAll 처럼
 * 여러 페이지를 오가는 흐름도 그대로 동작한다.
 */

/** 파이썬 `threading.Event` 대응. await(ms) 는 "중지되었으면 true". */
class StopFlag {
  constructor(parent = null) {
    this.parent = parent;
    this.stopped = false;
  }

  get isSet() {
    return this.stopped || (this.parent ? this.parent.isSet : false);
  }

  set() {
    this.stopped = true;
  }

  async await(ms) {
    if (this.isSet) return true;
    const tick = 50;
    let left = ms;
    while (left > 0) {
      await new Promise((r) => setTimeout(r, Math.min(tick, left)));
      left -= tick;
      if (this.isSet) return true;
    }
    return this.isSet;
  }

  async sleep(ms) {
    await this.await(ms);
  }
}

class Driver {
  /**
   * @param {number} tabId 조종할 탭
   * @param {string} tag 로그 앞에 붙일 표시 (계정 아이디)
   * @param {(msg: string, level?: string) => void} logger
   */
  constructor(tabId, tag, logger) {
    this.tabId = tabId;
    this.tag = tag;
    this.logger = logger;
    this.debuggerAttached = false;
    this.debuggerFailed = false;
  }

  log(message, level) {
    this.logger(`${this.tag} ${message}`, level);
  }

  // ---------------------------------------------------------------- eval

  /**
   * 파이썬 `driver.execute_script(script)` 대응.
   * Selenium 과 동일하게 스크립트는 함수 본문으로 감싸지므로 `return` 을 그대로 쓴다.
   * 페이지 전역(study_data, card_list, window.__cc_answers)에 닿아야 하므로 MAIN world.
   */
  async eval(script) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: this.tabId },
        world: 'MAIN',
        args: [script],
        func: (src) => {
          try {
            // eslint-disable-next-line no-new-func
            return new Function(src)();
          } catch (e) {
            return null;
          }
        },
      });
      const value = results && results[0] ? results[0].result : null;
      return value === undefined ? null : value;
    } catch (e) {
      // 탭이 닫혔거나 이동 중이면 null (원본의 except 분기와 같은 취급)
      return null;
    }
  }

  async exec(script) {
    await this.eval(script);
  }

  async evalBool(script) {
    return (await this.eval(script)) === true;
  }

  async evalIntOrNull(script) {
    const value = await this.eval(script);
    if (value === null || value === undefined || value === '') return null;
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? null : n;
  }

  async evalStringOrNull(script) {
    const value = await this.eval(script);
    if (value === null || value === undefined) return null;
    return String(value);
  }

  async evalList(script) {
    const value = await this.eval(script);
    return Array.isArray(value) ? value : [];
  }

  // ------------------------------------------------------------ 페이지 상태

  async currentUrl() {
    try {
      const tab = await chrome.tabs.get(this.tabId);
      return tab.url || '';
    } catch (e) {
      return '';
    }
  }

  async title() {
    try {
      const tab = await chrome.tabs.get(this.tabId);
      return tab.title || '';
    } catch (e) {
      return '';
    }
  }

  async loadUrl(url) {
    await chrome.tabs.update(this.tabId, { url });
    await this.waitForLoad();
  }

  /** 탭 로딩이 끝날 때까지 대기. */
  async waitForLoad(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const tab = await chrome.tabs.get(this.tabId);
        if (tab.status === 'complete') {
          await new Promise((r) => setTimeout(r, 250));
          return true;
        }
      } catch (e) {
        return false;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  /** 파이썬 `WebDriverWait(...).until(presence_of_element_located(...))` 대응. */
  async waitForSelector(selector, timeoutMs, stop = null) {
    const script = `return document.querySelectorAll(${JSON.stringify(selector)}).length > 0;`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (stop && stop.isSet) return false;
      if (await this.evalBool(script)) return true;
      if (stop) {
        if (await stop.await(200)) return false;
      } else {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    return this.evalBool(script);
  }

  /** 보이는(offsetParent 존재) 요소가 나타날 때까지 대기. */
  async waitForVisible(selector, timeoutMs, stop = null) {
    const script = `
      var els = document.querySelectorAll(${JSON.stringify(selector)});
      for (var i = 0; i < els.length; i++) {
        if (els[i].offsetParent !== null) return true;
      }
      return false;`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (stop && stop.isSet) return false;
      if (await this.evalBool(script)) return true;
      if (stop) {
        if (await stop.await(200)) return false;
      } else {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    return this.evalBool(script);
  }

  // --------------------------------------------------------------- 클릭

  /**
   * 클릭 — 원본(Selenium)과 같은 순서로 누른다: **진짜 클릭 먼저, 안 되면 합성 클릭**.
   *
   * 클래스카드의 여러 화면(리콜 정답, 문장 암기·문장 리콜·문장 테스트의 낱말 버튼 등)은
   * 합성 click 을 무시하고 신뢰된 입력에만 반응한다. 파이썬 원본이 `element.click()`
   * (=진짜 입력)을 먼저 쓰고 실패할 때만 JS 클릭으로 폴백한 것과 같은 규칙이다.
   *
   * 좌표 클릭이 엉뚱한 요소(모달·오버레이)를 누르지 않도록, 그 좌표에 실제로 그 요소가
   * 있는지(elementFromPoint) 확인한 뒤에만 신뢰된 클릭을 보낸다.
   *
   * @param {string} pick 요소를 `el` 변수에 담는 JS 조각
   */
  async clickSmart(pick) {
    const trusted = await this.trustedClick(`
      var el = null;
      ${pick}
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return null;
      var at = document.elementFromPoint(x, y);
      if (!at || !(at === el || el.contains(at) || at.contains(el))) return null;
      return { x: x, y: y, w: window.innerWidth };`);
    if (trusted) return true;

    return this.evalBool(`
      var el = null;
      ${pick}
      if (!el) return false;
      el.click();
      return true;`);
  }

  /** selector 의 index 번째 요소를 클릭. */
  async clickIndex(selector, index) {
    return this.clickSmart(`
      var e = document.querySelectorAll(${JSON.stringify(selector)});
      el = e[${index}] || null;`);
  }

  async clickFirst(selector) {
    return this.clickIndex(selector, 0);
  }

  async clickFirstVisible(selector) {
    return this.clickSmart(`
      var e = document.querySelectorAll(${JSON.stringify(selector)});
      for (var i = 0; i < e.length; i++) {
        if (e[i].offsetParent !== null) { el = e[i]; break; }
      }`);
  }

  // ------------------------------------------------------- CDP (신뢰된 입력)

  /** 자동화 시작 시 한 번 붙인다. 실패해도 합성 이벤트로 계속 진행한다. */
  async attachDebugger() {
    if (this.debuggerAttached || this.debuggerFailed) return this.debuggerAttached;
    try {
      await chrome.debugger.attach({ tabId: this.tabId }, '1.3');
      this.debuggerAttached = true;
    } catch (e) {
      const message = String(e && e.message ? e.message : e);
      // 이미 붙어 있으면 그대로 쓴다.
      if (message.includes('already attached')) {
        this.debuggerAttached = true;
      } else {
        this.debuggerFailed = true;
        this.log(
          `[!] 신뢰된 입력(CDP) 연결 실패: ${message} — 합성 이벤트로 진행합니다.`,
          'warn',
        );
        this.log(
          '[!] 클래스카드는 합성 클릭을 무시하는 화면이 많습니다(리콜의 정답 보기, ' +
            '문장 암기·문장 리콜·문장 테스트의 낱말 버튼). 브라우저 위쪽의 디버깅 안내를 ' +
            "'취소'하지 말고 그대로 두셔야 정상 동작합니다.",
          'warn',
        );
      }
    }
    return this.debuggerAttached;
  }

  async detachDebugger() {
    if (!this.debuggerAttached) return;
    try {
      await chrome.debugger.detach({ tabId: this.tabId });
    } catch (e) {
      // 이미 떨어졌으면 무시
    }
    this.debuggerAttached = false;
  }

  async sendCdp(method, params) {
    if (!this.debuggerAttached) return false;
    try {
      await chrome.debugger.sendCommand({ tabId: this.tabId }, method, params);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * CDP `Input.dispatchMouseEvent` — 원본 `_cdp_click` 과 완전히 동일한 경로.
   * @param {string} locatorJs `{x, y}` (뷰포트 기준 CSS 좌표)를 반환하는 스크립트
   */
  async trustedClick(locatorJs) {
    const pos = await this.eval(locatorJs);
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return false;
    if (!this.debuggerAttached) return false;

    const { x, y } = pos;
    const ok1 = await this.sendCdp('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, buttons: 0,
    });
    const ok2 = await this.sendCdp('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
    });
    const ok3 = await this.sendCdp('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1,
    });
    return ok1 && ok2 && ok3;
  }

  // ----------------------------------------------------------------- 키

  /**
   * 파이썬 `body.send_keys(...)` 대응.
   * CDP 가 붙어 있으면 신뢰된 키 이벤트, 아니면 합성 KeyboardEvent 로 폴백.
   */
  async pressKey(key, { shift = false } = {}) {
    const spec = KEY_SPECS[key];
    if (!spec) return false;

    if (this.debuggerAttached) {
      const modifiers = shift ? 8 : 0;
      const base = {
        modifiers,
        key: spec.key,
        code: spec.code,
        windowsVirtualKeyCode: spec.keyCode,
        nativeVirtualKeyCode: spec.keyCode,
      };
      const down = await this.sendCdp('Input.dispatchKeyEvent', {
        ...base,
        type: spec.text ? 'keyDown' : 'rawKeyDown',
        text: spec.text || '',
      });
      const up = await this.sendCdp('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
      if (down && up) return true;
    }

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

  async pressSpace() {
    return this.pressKey('space');
  }

  /** 파이썬 `ActionChains(...).key_down(SHIFT).send_keys(SPACE)` 대응. */
  async pressShiftSpace() {
    return this.pressKey('space', { shift: true });
  }

  /**
   * 글자를 **진짜 키 입력으로** 한 자씩 쳐 넣는다.
   *
   * 스펠은 입력창의 마지막 keydown 이벤트를 저장해 두고 채점할 때
   * `isTrusted` 를 확인한다(사이트 스크립트 scripts/v2/spell.js). 그래서 값을 직접
   * 넣는 방식(value 설정 + input 이벤트)은 "event is not trusted" 로 거부된다.
   * CDP 가 없으면 마지막 수단으로 값만 넣는다(그 경우 제출은 실패할 수 있다).
   */
  async typeText(text) {
    const str = String(text == null ? '' : text);
    if (!str) return true;

    if (this.debuggerAttached) {
      for (const ch of str) {
        const code = ch.charCodeAt(0);
        const base = {
          modifiers: 0,
          key: ch,
          text: ch,
          unmodifiedText: ch,
          windowsVirtualKeyCode: code,
          nativeVirtualKeyCode: code,
        };
        // keyDown 에 text 가 있으면 그 자체로 글자가 입력된다.
        // ('char' 를 따로 보내면 같은 글자가 두 번 들어간다)
        const ok = await this.sendCdp('Input.dispatchKeyEvent', { ...base, type: 'keyDown' });
        await this.sendCdp('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
        if (!ok) return false;
      }
      return true;
    }
    return false;
  }

  async pressEnter() {
    return this.pressKey('enter');
  }

  async pressDigit(digit) {
    if (digit < 0 || digit > 9) return false;
    return this.pressKey(String(digit));
  }

  async blurActiveElement() {
    await this.exec('if (document.activeElement && document.activeElement.blur) document.activeElement.blur();');
  }
}

const KEY_SPECS = {
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  0: { key: '0', code: 'Digit0', keyCode: 48, text: '0' },
  1: { key: '1', code: 'Digit1', keyCode: 49, text: '1' },
  2: { key: '2', code: 'Digit2', keyCode: 50, text: '2' },
  3: { key: '3', code: 'Digit3', keyCode: 51, text: '3' },
  4: { key: '4', code: 'Digit4', keyCode: 52, text: '4' },
  5: { key: '5', code: 'Digit5', keyCode: 53, text: '5' },
  6: { key: '6', code: 'Digit6', keyCode: 54, text: '6' },
  7: { key: '7', code: 'Digit7', keyCode: 55, text: '7' },
  8: { key: '8', code: 'Digit8', keyCode: 56, text: '8' },
  9: { key: '9', code: 'Digit9', keyCode: 57, text: '9' },
};

  return { StopFlag, Driver };
})();

// ======================================================== extension/engine/modules/basic.js
__mod.basic = (function () {
  const N = __mod.norm;
/**
 * HtmlParser.py / Memorize.py / Recall.py / Spell.py 이식.
 * (파이썬 원본의 JS 스니펫과 CSS 셀렉터는 문자 그대로 재사용한다)
 */


// ============================================================ HtmlParser.py

const STUDY_DATA_RE = /var\s+study_data\s*=\s*(\[[\s\S]*?\]);/;

/** 현재 페이지에서 카드 목록([{front, back}, ...])을 뽑는다. */
async function getData(d) {
  const direct = await d.eval(
    "return (typeof study_data !== 'undefined' && study_data) ? study_data : null;",
  );
  if (Array.isArray(direct) && direct.length) {
    const cards = toCards(direct);
    if (cards.length) {
      d.log(`데이터 추출 완료! 총 ${cards.length}개 카드`);
      return cards;
    }
  }

  const html = await d.evalStringOrNull('return document.documentElement.outerHTML;');
  if (!html) {
    d.log('[!] 페이지 HTML을 읽지 못했습니다.', 'error');
    return null;
  }
  const match = STUDY_DATA_RE.exec(html);
  if (!match) {
    // 지금 사이트의 학습 페이지에는 study_data 가 없다(실제 페이지에서 확인).
    // 카드는 학습이 시작된 뒤 화면에 그려지므로, 그려진 카드에서 직접 읽는다.
    const fromDom = await getDataFromCards(d);
    if (fromDom && fromDom.length) {
      d.log(`데이터 추출 완료! 총 ${fromDom.length}개 카드 (화면에서 읽음)`);
      return fromDom;
    }
    d.log(
      '[!] 단어 데이터를 찾지 못했습니다. 학습을 시작해 카드가 보이는 상태에서 다시 눌러 주세요.',
      'error',
    );
    return null;
  }
  try {
    const cards = toCards(JSON.parse(match[1]));
    d.log(`데이터 추출 완료! 총 ${cards.length}개 카드`);
    return cards;
  } catch (e) {
    d.log(`[오류] JSON 파싱 실패: ${e.message}`, 'error');
    return null;
  }
}

/**
 * 화면에 그려진 카드에서 단어/뜻을 읽는다 (study_data 가 없는 페이지용).
 *
 * 실제 리콜 페이지에서 확인한 구조 — 클래스 이름이 페이지마다 난수로 바뀌므로
 * 바뀌지 않는 것만 쓴다:
 *   단어  : .CardItem 안의 .text-normal
 *   정답 뜻: 보기 줄 중 .answer 가 붙은 줄의 .cc-ellipsis 글자
 */
async function getDataFromCards(d) {
  const rows = await d.eval(`
    function txt(el) { return ((el && el.textContent) || '').replace(/\\s+/g, ' ').trim(); }
    var out = [];
    var seen = {};
    var items = document.querySelectorAll('.CardItem');
    for (var i = 0; i < items.length; i++) {
        var c = items[i];
        var w = c.querySelector('.card-top .text-normal') || c.querySelector('.text-normal');
        var front = txt(w);
        if (!front) continue;
        var back = '';
        var ans = c.querySelector('.answer');
        if (ans) back = txt(ans.querySelector('.cc-ellipsis') || ans);
        if (!back) continue;
        var key = front + '\\u0001' + back;
        if (seen[key]) continue;
        seen[key] = 1;
        out.push({ front: front, back: back });
    }
    return out;`);
  return Array.isArray(rows) ? rows.filter((r) => r && r.front && r.back) : [];
}

function toCards(arr) {
  const out = [];
  for (const card of arr) {
    if (!card) continue;
    out.push({
      front: String(card.front || '').trim(),
      back: String(card.back || '').trim(),
    });
  }
  return out;
}

/** Spell.py 의 `dict_from_cards` — {back: front} 맵. */
function dictFromCards(cards) {
  if (!cards || !cards.length) return null;
  const dict = new Map();
  for (const c of cards) dict.set(c.back, c.front);
  return dict;
}

// ============================================================ 학습 시작 화면

/**
 * 학습 페이지는 **시작 화면**으로 열린다 (실제 페이지에서 확인:
 * `<a class="btn btn-primary btn-block btn-opt-start">리콜 학습 시작 (1구간)</a>`).
 * 이 버튼을 누르기 전에는 `.CardItem.current` 가 없어서 어떤 모드도 아무것도 할 수 없다.
 * 시작 화면이면 눌러 주고 true, 이미 학습 중이면 false.
 */
async function startStudyIfNeeded(d, stop) {
  const need = await d.evalBool(`
    function vis(el) { return el && el.offsetParent !== null; }
    if (vis(document.querySelector('.CardItem.current'))) return false;
    var btns = document.querySelectorAll('.btn-opt-start, .start-opt-body a.btn, .btn-quiz-start');
    for (var i = 0; i < btns.length; i++) if (vis(btns[i])) return true;
    return false;`);
  if (!need) return false;

  d.log('학습 시작 화면입니다 — 시작 버튼을 누릅니다.');
  await d.clickSmart(`
    function vis(el) { return el && el.offsetParent !== null; }
    var btns = document.querySelectorAll('.btn-opt-start, .start-opt-body a.btn, .btn-quiz-start');
    for (var i = 0; i < btns.length; i++) if (vis(btns[i])) { el = btns[i]; break; }`);
  await stop.await(1500);
  return true;
}

// ============================================================ Memorize.py

/**
 * 완료 종료 판단: `.btn-study-end-repeat` visible / `.next-repeat-percent` >= 100 /
 * `#study_end.active` 중 하나.
 */
async function checkStep2SuccessAndStop(d, stop) {
  const done = await d.evalBool(`
    // 주의: 학습 페이지는 결과 패널(#study_end)을 처음부터 DOM 에 넣어 둔다.
    // 그 안에 '<span class="next-repeat-percent">200</span>% 도전' 버튼이 들어 있어서,
    // 그냥 찾으면 **학습을 시작하자마자 '끝났다'고 판단해 버린다**(실제 페이지에서 확인).
    // 그래서 결과 패널 안의 것은 패널이 active 일 때만 인정한다.
    function shown(el) {
        if (!el) return false;
        var r = el.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return false;
        var s = window.getComputedStyle(el);
        return s.display !== "none" && s.visibility !== "hidden";
    }
    function endReady(el) {
        var p = el.closest ? el.closest("#study_end") : null;
        if (!p) return true;                       // 결과 패널 밖이면 화면 그대로 본다
        return (" " + p.className + " ").indexOf(" active ") >= 0;
    }
    var btns = document.querySelectorAll(".btn-study-end-repeat");
    for (var i = 0; i < btns.length; i++) {
        if (shown(btns[i]) && endReady(btns[i])) return true;
    }
    var ps = document.querySelectorAll(".next-repeat-percent");
    for (var i = 0; i < ps.length; i++) {
        if (shown(ps[i]) && endReady(ps[i]) && parseInt(ps[i].textContent) >= 100) return true;
    }
    return document.querySelectorAll("#study_end.active").length > 0;`);
  if (!done) return false;
  await d.exec('var a = document.querySelectorAll("#study_end.active .study-header a"); if (a.length) a[0].click();');
  await d.exec('var a = document.querySelectorAll(".btn-top-menu a"); if (a.length) a[0].click();');
  await stop.sleep(500);
  await d.exec('var a = document.querySelectorAll(".close_o"); if (a.length) a[0].click();');
  stop.set();
  return true;
}

/** total 밀리초 동안 interval 간격으로 종료 체크하며 대기. */
async function waitWithCheck(d, stop, total, interval = 200) {
  let elapsed = 0;
  while (elapsed < total) {
    const slice = Math.min(interval, total - elapsed);
    if (await stop.await(slice)) return true;
    elapsed += slice;
    if (await checkStep2SuccessAndStop(d, stop)) return true;
  }
  return false;
}

/** 현재 보이는 카드의 식별자(전환 감지용). data-idx 만 사용한다. */
async function getCardKey(d) {
  return d.evalStringOrNull(`
    var c = document.querySelector('.CardItem.current')
         || document.querySelector('.CardItem.active')
         || document.querySelector('.showing');
    if (!c) return null;
    return c.getAttribute('data-idx') || c.getAttribute('data-card-idx') || null;`);
}

async function waitChangeOrStop(d, stop, prevKey, total, interval = 200) {
  let elapsed = 0;
  while (elapsed < total) {
    const slice = Math.min(interval, total - elapsed);
    if (await stop.await(slice)) return true;
    elapsed += slice;
    if (await checkStep2SuccessAndStop(d, stop)) return true;
    const cur = await getCardKey(d);
    if (cur !== null && cur !== prevKey) return true;
  }
  return false;
}

/** Memorize.py — 단어 암기 자동화 */
async function memorize(d, answerDict, stop) {
  d.log('[암기] 시작');
  try {
    while (!stop.isSet) {
      if (await checkStep2SuccessAndStop(d, stop)) break;
      if (await startStudyIfNeeded(d, stop)) continue;

      const prev = await getCardKey(d);

      if (prev === null) {
        // 카드 식별 불가(페이지 구조 차이) -> 기존 타이머 방식
        await d.pressSpace();
        if (await waitWithCheck(d, stop, 600)) break;
        await d.pressShiftSpace();
        if (await waitWithCheck(d, stop, 1300)) break;
        continue;
      }

      // 카드가 실제로 넘어갈 때까지 SPACE -> SHIFT+SPACE 재시도 (씹힘 대비, 최대 8회)
      for (let i = 0; i < 8; i++) {
        await d.pressSpace();
        if (await waitChangeOrStop(d, stop, prev, 600)) break;
        await d.pressShiftSpace();
        if (await waitChangeOrStop(d, stop, prev, 1300)) break;
      }
      if (stop.isSet) break;
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[암기] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[암기] 종료');
  }
}

// ============================================================ Recall.py

/**
 * 리콜 화면의 실제 동작 (사이트 스크립트 scripts/v2/recall.js 확인 결과):
 *
 *  - 카드가 바뀌고 0.8초 뒤 `.CardItem.current .card-cover` 에 `down` 이 붙는다.
 *    이때부터 보기(정답 후보)를 고를 수 있다. 그 전에 누르면 덮개에 막힌다.
 *  - 보기 중 **정답에는 `.answer` 클래스**가 붙어 있다(사이트가 data-answer=1 을 함께 넣는다).
 *  - 보기 클릭 처리(setCardQuestItem)는 `e.originalEvent.isTrusted` 가 false 면 **그냥 무시**한다.
 *    -> 합성 클릭은 절대 통하지 않는다. 신뢰된 클릭만 받는다.
 *  - 정답을 고르면 사이트가 1초 뒤 `.btnNextCard` 를 스스로 눌러 다음 카드로 넘어간다.
 *    (오답이면 넘어가지 않으므로 우리가 눌러 준다)
 */
const RECALL_STATE_JS = `
var card = document.querySelector('.CardItem.current') ||
           document.querySelector('.CardItem.showing');
if (!card) return { found: false };

var cover = card.querySelector('.card-cover');
var down = !!(cover && cover.className.indexOf('down') >= 0);

// 이미 채점된 카드인지 (정답/오답 표시가 붙었거나 카드가 active/deactive 가 된다)
var cls = ' ' + card.className + ' ';
var answered = cls.indexOf(' active ') >= 0 || cls.indexOf(' deactive ') >= 0 ||
    !!card.querySelector('.card-quest-o, .card-quest-x, .show-answer');

var target = card.querySelector('.answer');
var options = card.querySelectorAll('.cc-table').length;

return {
    found: true,
    idx: card.getAttribute('data-idx') || '',
    down: down,
    answered: answered,
    hasAnswer: !!target,
    options: options
};`;

const RECALL_ANSWER_LOCATOR_JS = `
var card = document.querySelector('.CardItem.current') ||
           document.querySelector('.CardItem.showing');
if (!card) return null;
var t = card.querySelector('.answer');
if (!t) return null;
t.scrollIntoView({ block: 'center', inline: 'center' });
var r = t.getBoundingClientRect();
if (!r.width || !r.height) return null;
return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: window.innerWidth };`;

async function recallState(d) {
  const v = await d.eval(RECALL_STATE_JS);
  return v && v.found ? v : null;
}

/** Recall.py — 단어 리콜 자동화 */
async function recall(d, answerDict, stop) {
  d.log('[리콜] 시작');

  let lastIdx = null;
  let sameIdx = 0;
  let noCard = 0;
  let warnedTrusted = false;

  try {
    while (!stop.isSet) {
      if (await checkStep2SuccessAndStop(d, stop)) break;
      if (await startStudyIfNeeded(d, stop)) continue;

      const st = await recallState(d);
      if (!st) {
        noCard++;
        if (noCard === 10) d.log('[리콜] 카드를 찾지 못했습니다. 리콜 학습 화면이 맞는지 확인하세요.', 'warn');
        if (noCard > 60) { d.log('[리콜] 카드가 없어 종료합니다.', 'warn'); break; }
        if (await stop.await(400)) break;
        continue;
      }
      noCard = 0;

      // 같은 카드에 계속 머물면(정답 클릭이 안 먹는 경우) 다음 카드로 밀어 본다
      if (st.idx && st.idx === lastIdx) sameIdx++;
      else { sameIdx = 0; lastIdx = st.idx; }

      // 이미 채점된 카드 -> 다음 카드로
      if (st.answered) {
        await d.clickFirstVisible('.btnNextCard');
        if (await waitWithCheck(d, stop, 800)) break;
        continue;
      }

      // 덮개가 아직 내려오지 않았다 (카드 전환 후 0.8초). 내려올 때까지 기다린다.
      if (!st.down) {
        if (await waitWithCheck(d, stop, 400)) break;
        continue;
      }

      if (!st.hasAnswer) {
        d.log('[리콜] 이 카드에서 정답 보기를 찾지 못했습니다 — 다음 카드로 넘어갑니다.', 'warn');
        await d.clickFirstVisible('.btnNextCard');
        if (await waitWithCheck(d, stop, 800)) break;
        continue;
      }

      // 정답 보기를 신뢰된 클릭으로 누른다. (합성 클릭은 사이트가 무시한다)
      const clicked = await d.trustedClick(RECALL_ANSWER_LOCATOR_JS);
      if (!clicked && !warnedTrusted) {
        warnedTrusted = true;
        d.log(
          '[리콜] 신뢰된 클릭을 보내지 못했습니다. 리콜은 합성 클릭을 받지 않으므로 ' +
            '브라우저 상단의 디버깅 안내를 취소하지 마세요.',
          'error',
        );
      }

      // 정답이면 사이트가 1초 뒤 스스로 다음 카드로 넘어간다.
      if (await waitWithCheck(d, stop, 1800)) break;

      const after = await recallState(d);
      if (after && after.idx === st.idx && !after.answered && sameIdx >= 3) {
        // 세 번 눌러도 그대로면 다음 카드로 밀어 진행을 계속한다
        await d.clickFirstVisible('.btnNextCard');
        if (await waitWithCheck(d, stop, 800)) break;
      } else if (after && after.answered) {
        // 채점됐는데 자동으로 안 넘어가면(오답) 다음 카드를 눌러 준다
        if (await waitWithCheck(d, stop, 700)) break;
        const still = await recallState(d);
        if (still && still.idx === st.idx) await d.clickFirstVisible('.btnNextCard');
      }
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[리콜] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[리콜] 종료');
  }
}

// ============================================================ Spell.py

const INPUT_SELECTOR = 'input[name="input_answer"]';

/**
 * 제시어(prompt)에 해당하는 입력 정답.
 * 기본은 back(의미) -> front(단어). 단어 제시 모드 대비로 front -> back 역방향도 시도.
 */
function findAnswer(answerDict, prompt) {
  const p = N.squeeze(prompt);
  for (const [back, front] of answerDict) {
    if (p === N.squeeze(back)) return front;
  }
  for (const [back, front] of answerDict) {
    if (p === N.squeeze(front)) return back;
  }
  return null;
}

/**
 * 지금 카드의 **정답을 화면에서 그대로 읽는다**.
 *
 * 사이트 스크립트(scripts/v2/spell.js)가 채점할 때 쓰는 값과 같은 값이다:
 *   `$('.CardItem.current.showing .card-bottom .spell-answer .spell-content').data('answer')`
 * jQuery 의 data 저장소에 들어 있어 DOM 속성으로는 안 보이므로 jQuery 로 읽는다.
 * (실제 페이지에서 확인: 프롬프트 'n.돌봄, 조심, 걱정' -> 정답 'care')
 */
async function readSpellAnswer(d) {
  const v = await d.evalStringOrNull(`
    if (!window.jQuery) return null;
    var sels = ['.CardItem.current.showing .card-bottom .spell-answer .spell-content',
                '.CardItem.current .card-bottom .spell-answer .spell-content',
                '.CardItem.current.showing .card-top .spell-answer .spell-content'];
    for (var i = 0; i < sels.length; i++) {
        var el = jQuery(sels[i]);
        if (!el.length) continue;
        var a = el.data('answer');
        if (a == null) continue;
        // 사이트도 HTML 을 걷어 내고 비교한다
        var t = jQuery('<div>').html(String(a)).text().trim();
        if (t) return t;
    }
    return null;`);
  return v && v.trim() ? v.trim() : null;
}

async function getActiveCard(d) {
  const res = await d.eval(`
    var card = document.querySelector('.CardItem.current');
    if (!card) return null;
    var conts = card.querySelectorAll('.spell-answer .spell-content');
    var prompt = '';
    for (var i = 0; i < conts.length; i++) {
        var t = (conts[i].textContent || '').trim();
        if (t) { prompt = t; break; }
    }
    return {idx: card.getAttribute('data-idx'), prompt: prompt};`);
  if (!res) return { idx: null, prompt: '' };
  return { idx: res.idx ?? null, prompt: res.prompt || '' };
}

/** `#study_end.active` 또는 `.btn-study-end-repeat` 가 보이면 완료. */
async function spellCheckEnd(d, stop) {
  const done = await d.evalBool(`
    var btns = document.querySelectorAll(".btn-study-end-repeat");
    for (var i = 0; i < btns.length; i++) {
        if (btns[i].offsetParent !== null) return true;
    }
    return document.querySelectorAll("#study_end.active").length > 0;`);
  if (!done) return false;
  await d.exec('var a = document.querySelectorAll("#study_end.active .study-header a"); if (a.length) a[0].click();');
  await d.exec('var a = document.querySelectorAll(".btn-top-menu a"); if (a.length) a[0].click();');
  await stop.sleep(500);
  await d.exec('var a = document.querySelectorAll(".close_o"); if (a.length) a[0].click();');
  stop.set();
  return true;
}

/**
 * 스펠 입력창에 답을 써 넣는다.
 *
 * 사이트는 입력창의 마지막 keydown 이벤트를 저장해 두고 채점 때 isTrusted 를 본다.
 * 그래서 **진짜 키 입력**으로 쳐 넣어야 하고, 값만 넣으면 제출이 거부된다.
 * (빈 문자열은 '모름'으로 그냥 제출하는 경우라 값만 비우면 된다)
 */
async function typeActiveInput(d, text) {
  if (!(await focusActiveInput(d))) return false;
  await clearActiveInput(d);
  if (!text) return true;
  if (await d.typeText(text)) return true;
  // 신뢰된 입력을 못 보내는 환경 -> 값만 넣어 본다 (사이트가 거부할 수 있다)
  return fillActiveInput(d, text);
}

/** 입력창에 포커스를 준다 (없으면 false). */
async function focusActiveInput(d) {
  return d.evalBool(`
    function visibleInput(root) {
        var els = root.querySelectorAll(${JSON.stringify(INPUT_SELECTOR)});
        for (var i = 0; i < els.length; i++) {
            if (els[i].offsetParent !== null) return els[i];
        }
        return null;
    }
    var cur = document.querySelector('.CardItem.current');
    var el = cur ? visibleInput(cur) : null;
    if (!el) el = visibleInput(document);
    if (!el) return false;
    el.focus();
    return true;`);
}

/** 입력창을 비운다 (값만 지우면 되므로 신뢰된 입력이 필요 없다). */
async function clearActiveInput(d) {
  return d.evalBool(`
    var el = document.activeElement;
    if (!el || !('value' in el)) return false;
    var setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '');
    el.dispatchEvent(new Event('input', {bubbles: true}));
    return true;`);
}

async function fillActiveInput(d, text) {
  return d.evalBool(`
    function visibleInput(root) {
        var els = root.querySelectorAll(${JSON.stringify(INPUT_SELECTOR)});
        for (var i = 0; i < els.length; i++) {
            if (els[i].offsetParent !== null) return els[i];
        }
        return null;
    }
    var cur = document.querySelector('.CardItem.current');
    var el = cur ? visibleInput(cur) : null;
    if (!el) el = visibleInput(document);
    if (!el) return false;
    el.focus();
    var setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
    return true;`);
}

async function hasActiveInput(d) {
  return d.evalBool(`
    var els = document.querySelectorAll(${JSON.stringify(INPUT_SELECTOR)});
    for (var i = 0; i < els.length; i++) {
        if (els[i].offsetParent !== null) return true;
    }
    return false;`);
}

/** 'changed' | 'done' | 'stopped' | 'stuck' */
async function waitNextCard(d, stop, prevIdx, timeout = 2500) {
  let elapsed = 0;
  while (elapsed < timeout) {
    if (await stop.await(200)) return 'stopped';
    elapsed += 200;
    if (await spellCheckEnd(d, stop)) return 'done';
    const { idx } = await getActiveCard(d);
    if (idx !== null && idx !== prevIdx) return 'changed';
  }
  return 'stuck';
}

/** Spell.py — 스펠(타이핑) 자동화 */
async function spell(d, answerDict, stop) {
  d.log('[스펠] 시작');

  let dict = answerDict;
  if (!dict || dict.size === 0) {
    // 카드 데이터(study_data)는 **학습이 시작된 뒤** 페이지에 채워진다.
    // 그래서 시작 화면이면 먼저 시작 버튼을 누르고, 그 다음에 단어장을 읽는다.
    await startStudyIfNeeded(d, stop);
    for (let i = 0; i < 10 && !stop.isSet; i++) {
      const cards = await d.eval(
        "return (typeof study_data !== 'undefined' && study_data) ? study_data : null;",
      );
      if (Array.isArray(cards) && cards.length) {
        dict = dictFromCards(cards.map((c) => ({
          front: String((c && c.front) || '').trim(),
          back: String((c && c.back) || '').trim(),
        })));
        if (dict && dict.size) {
          d.log(`[스펠] 페이지에서 단어장을 읽었습니다 (${dict.size}개)`);
          break;
        }
      }
      if (await stop.await(500)) return;
    }
  }
  if (!dict || dict.size === 0) {
    d.log('[스펠] 단어장이 없습니다 — 화면에 실린 정답으로 풉니다.');
    dict = new Map();
  }
  answerDict = dict;

  let loggedSource = false;
  try {
    while (!stop.isSet) {
      if (await spellCheckEnd(d, stop)) break;
      if (await startStudyIfNeeded(d, stop)) continue;

      const { idx, prompt } = await getActiveCard(d);
      if (!prompt) {
        if (await spellCheckEnd(d, stop)) break;
        if (await stop.await(400)) break;
        continue;
      }

      if (!(await hasActiveInput(d))) {
        if (await stop.await(300)) break;
        continue;
      }

      // 1순위: 화면에 실린 정답(사이트가 채점에 쓰는 값), 2순위: 단어장
      let answer = await readSpellAnswer(d);
      if (answer) {
        if (!loggedSource) {
          loggedSource = true;
          d.log('[스펠] 화면에서 정답을 읽어 풉니다 (단어장 불필요)');
        }
      } else {
        answer = findAnswer(answerDict, prompt);
      }
      if (answer !== null) {
        if (!(await typeActiveInput(d, answer))) {
          if (await stop.await(300)) break;
          continue;
        }
        if (await stop.await(150)) break;
        await d.pressEnter();
      } else {
        // 정답을 모르면 빈 입력으로 제출 -> 정답 표시 후 다음으로 (무한루프 방지)
        d.log(`[스펠] 매칭 실패(스킵): '${prompt}'`, 'warn');
        await typeActiveInput(d, '');
        await d.pressEnter();
      }

      const status = await waitNextCard(d, stop, idx, 2000);
      if (status === 'stopped' || status === 'done') break;
      if (status === 'stuck') {
        await d.blurActiveElement();
        await d.pressSpace();
        const again = await waitNextCard(d, stop, idx, 2000);
        if (again === 'stopped' || again === 'done') break;
      }
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[스펠] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[스펠] 종료');
  }
}

  return { getData, getDataFromCards, dictFromCards, startStudyIfNeeded, checkStep2SuccessAndStop, waitWithCheck, memorize, recall, findAnswer, spell };
})();

// ======================================================== extension/engine/modules/games.js
__mod.games = (function () {
  const N = __mod.norm;
  const startStudyIfNeeded = __mod.basic.startStudyIfNeeded;
  const ratio = __mod.similarity.ratio;
/**
 * Test.py / TestSentence.py / Matching.py / Scramble.py 이식
 * (단어 테스트 · 문장 테스트 · 단어 매칭 · 문장 스크램블).
 */




/** 모듈별 목표 점수/기준값 — 원본 상수를 그대로 옮겼고 설정에서 바꿀 수 있다. */
const CONFIG = {
  testTargetScore: 90,           // Test.py TARGET_SCORE
  testSentenceTargetScore: 100,  // TestSentence.py TARGET_SCORE
  // 이 범위에서 목표 점수를 뽑아, 도달하면 게임 도중에 빠져나간다(점수는 서버에 저장됨).
  matchExitMin: 7000,            // 단어 매칭 목표 점수 (7000~8500)
  matchExitMax: 8500,
  scrambleExitMin: 7000,         // 문장 스크램블 목표 점수 (7000~8500)
  scrambleExitMax: 8500,
};

const GO_RESULT_SELECTOR = 'a.btn-go-result';

/**
 * TARGET_SCORE 이상이 나오도록 일부러 틀릴 문항 순번(1-based) 집합.
 * 틀릴 개수 = floor(total * (100 - target) / 100) — 내림이라 점수는 항상 목표 이상.
 */
function planWrongIndices(total, targetScore) {
  if (!total || total <= 0) return new Set();
  let nWrong = Math.floor((total * (100 - targetScore)) / 100);
  nWrong = Math.max(0, Math.min(nWrong, total));
  if (nWrong === 0) return new Set();
  const pool = [];
  for (let i = 1; i <= total; i++) pool.push(i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return new Set(pool.slice(0, nWrong));
}

async function countTotal(d) {
  return d.evalIntOrNull(
    'return document.querySelectorAll(\'.flip-card input[name="test_question[]"]\').length;',
  );
}

// ============================================================ Test.py (단어 테스트)

/** fwd[mnorm(front)] = back, bwd[mnorm(back)] = front */
function buildLookups(answerDict) {
  if (!answerDict || !answerDict.size) return null;
  const fwd = new Map();
  const bwd = new Map();
  for (const [back, front] of answerDict) {
    if (front) fwd.set(N.mnorm(front), back);
    if (back) bwd.set(N.mnorm(back), front);
  }
  return { fwd, bwd };
}

const READ_QUESTION_JS = `
var card = document.querySelector('.flip-card.showing');
if (!card) return { found: false };

var qid = '';
var qi = card.querySelector('input[name="test_question[]"]');
if (qi) qid = qi.value;

var flipped = card.classList.contains('flip');

var prompt = '';
var fh = card.querySelector('.flip-card-front .front-hidden');
if (fh) prompt = (fh.textContent || '').trim();
if (!prompt) {
    var fb = card.querySelector('.flip-card-front .cc-table');
    if (fb) prompt = (fb.textContent || '').trim();
}

var options = [];
var seen = {};
var labels = card.querySelectorAll('.flip-card-back label[for^="radio_"]:not(.hidden)');
for (var i = 0; i < labels.length; i++) {
    var l = labels[i];
    var f = l.getAttribute('for') || '';
    var parts = f.split('_');
    var num = parseInt(parts[parts.length - 1], 10);
    if (!num || seen[num]) continue;
    seen[num] = true;
    var cc = l.querySelector('.cc-table');
    var t = ((cc ? cc.textContent : l.textContent) || '').trim();
    if (!t) continue;
    options.push({ num: num, text: t });
}

return { found: true, qid: qid, flipped: flipped, prompt: prompt, options: options };`;

async function readQuestion(d) {
  const data = await d.eval(READ_QUESTION_JS);
  if (!data || !data.found) return null;
  const options = [];
  for (const o of data.options || []) {
    const raw = String(o.text || '').trim();
    if (o.num && raw) options.push({ num: o.num, raw, norm: N.mnorm(raw) });
  }
  return {
    qid: data.qid || '',
    flipped: !!data.flipped,
    promptRaw: String(data.prompt || '').trim(),
    options,
  };
}

/** 현재 보기에서 정답 번호를 찾는다. 반환: [번호, 정답텍스트] */
function solve(promptRaw, options, lk) {
  const pm = N.mnorm(promptRaw);

  // 1) 프롬프트 -> 정답 -> 보기 (정확/부분)
  const ans = lk.fwd.get(pm) ?? lk.bwd.get(pm) ?? null;
  if (ans) {
    const am = N.mnorm(ans);
    for (const o of options) if (o.norm === am) return [o.num, ans];
    for (const o of options) {
      if (am && (am.includes(o.norm) || o.norm.includes(am))) return [o.num, ans];
    }
  }

  // 2) 역방향: 각 보기의 짝을 구해 프롬프트와 비교
  for (const o of options) {
    const cp = lk.fwd.get(o.norm) ?? lk.bwd.get(o.norm) ?? null;
    if (cp && N.mnorm(cp) === pm) return [o.num, o.raw];
  }
  for (const o of options) {
    const cp = lk.fwd.get(o.norm) ?? lk.bwd.get(o.norm) ?? null;
    if (!cp) continue;
    const cpm = N.mnorm(cp);
    if (cpm && (cpm.includes(pm) || pm.includes(cpm))) return [o.num, o.raw];
  }

  // 3) 유사도 폴백: 정답 텍스트와 가장 비슷한 보기
  if (ans) {
    const am = N.mnorm(ans);
    let bestNum = null;
    let best = 0.0;
    for (const o of options) {
      const s = ratio(am, o.norm);
      if (s > best) {
        best = s;
        bestNum = o.num;
      }
    }
    if (bestNum !== null && best >= 0.6) return [bestNum, ans];
  }

  // 4) 유사도 폴백(역방향)
  let bestNum = null;
  let best = 0.0;
  let bestAns = null;
  for (const o of options) {
    const cp = lk.fwd.get(o.norm) ?? lk.bwd.get(o.norm) ?? null;
    if (!cp) continue;
    const s = ratio(N.mnorm(cp), pm);
    if (s > best) {
      best = s;
      bestNum = o.num;
      bestAns = o.raw;
    }
  }
  if (bestNum !== null && best >= 0.6) return [bestNum, bestAns];

  return [null, null];
}

async function clickExitWord(d, stop, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await d.evalBool(`
      var links = document.querySelectorAll('a');
      for (var i = 0; i < links.length; i++) {
          var a = links[i];
          if (a.offsetParent === null) continue;
          if ((a.textContent || '').indexOf('나가기') >= 0) { a.click(); return true; }
      }
      var prim = document.querySelectorAll('a.btn-primary[href*="/set/"]');
      for (var i = 0; i < prim.length; i++) {
          if (prim[i].offsetParent !== null) { prim[i].click(); return true; }
      }
      return false;`);
    if (clicked) return true;
    if (await stop.await(300)) return false;
  }
  return false;
}

/** 결과 화면 -> 제출결과확인 -> X -> 나가기 순으로 빠져나와 set 상세 복귀. */
async function testCheckEndAndStop(d, stop) {
  const visible = await d.evalBool(`
    var b = document.querySelectorAll('${GO_RESULT_SELECTOR}');
    for (var i = 0; i < b.length; i++) if (b[i].offsetParent !== null) return true;
    return false;`);
  if (!visible) return false;

  await d.clickFirstVisible(GO_RESULT_SELECTOR);
  await stop.sleep(800);

  if (await d.waitForVisible('i.cc.times', 8000, stop)) {
    await d.clickFirstVisible('i.cc.times');
  }
  await stop.sleep(800);

  await clickExitWord(d, stop, 8000);
  await stop.sleep(500);

  stop.set();
  return true;
}

/** Test.py — 단어 객관식 테스트 자동 풀이 */
async function test(d, answerDict, stop) {
  d.log('[테스트] 시작');

  const lk = buildLookups(answerDict);
  if (!lk) {
    d.log('[테스트] 오류: 단어장이 없습니다.', 'error');
    d.log('[테스트] 종료');
    return;
  }
  d.log(`[테스트] 매칭 데이터 로드 완료 (단어 ${answerDict.size}개)`);

  const total = await countTotal(d);
  const wrongIdx = planWrongIndices(total, CONFIG.testTargetScore);

  let lastQid = null;
  const spaceAttempts = new Map();
  let answeredCount = 0;

  try {
    while (!stop.isSet) {
      if (await testCheckEndAndStop(d, stop)) break;
      if (await startStudyIfNeeded(d, stop)) continue;

      const q = await readQuestion(d);
      if (!q || !q.options.length) {
        if (await stop.await(300)) break;
        continue;
      }

      const [matchNum] = solve(q.promptRaw, q.options, lk);

      // 이미 답한 문제 -> 다음 문제로 넘어갈 때까지 대기
      if (q.qid && q.qid === lastQid) {
        if (await stop.await(300)) break;
        continue;
      }

      // 단어 카드(아직 안 뒤집힘) -> SPACE 로 6개 보기로 (최대 8회 재시도)
      if (!q.flipped) {
        const n = spaceAttempts.get(q.qid) || 0;
        if (n < 8) {
          await d.pressSpace();
          spaceAttempts.set(q.qid, n + 1);
        }
        if (await stop.await(500)) break;
        continue;
      }

      answeredCount++;
      const makeWrong = wrongIdx.has(answeredCount);
      const allNums = q.options.map((o) => o.num);

      let choose;
      if (matchNum !== null && !makeWrong) {
        choose = matchNum;
      } else {
        const wrongNums = allNums.filter((x) => x !== matchNum);
        choose = wrongNums.length
          ? wrongNums[Math.floor(Math.random() * wrongNums.length)]
          : (allNums[0] || 1);
        if (makeWrong) {
          d.log(`[테스트] ${answeredCount}번째: 의도적 오답 ('${q.promptRaw}')`, 'warn');
        } else if (matchNum === null) {
          d.log(`[테스트] ${answeredCount}번째: 매칭 실패 -> 랜덤 ('${q.promptRaw}')`, 'warn');
        }
      }

      // 활성 직후 너무 빨리 누르면 씹힘 -> 0.5초 후 입력
      if (await stop.await(500)) break;
      await d.pressDigit(choose);
      lastQid = q.qid;
      if (await stop.await(500)) break;
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[테스트] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[테스트] 종료');
  }
}

// ============================================================ TestSentence.py

/** {한글 그대로, 괄호 제거} 두 가지 맵 */
function buildMaps(answerDict) {
  const m = new Map();
  const mnp = new Map();
  for (const [back, front] of answerDict) {
    if (!back) continue;
    m.set(N.normalizeKor(back), front);
    mnp.set(N.normalizeKor(N.stripParensSimple(back)), front);
  }
  return { m, mnp };
}

/**
 * 이 페이지가 들고 있는 카드 목록(study_data / card_list)을 읽는다.
 * 단어장을 안 가져왔거나 제시문이 단어장과 조금 달라도, 페이지 자신의 데이터로 맞출 수 있다.
 */
async function pageCards(d) {
  const arr = await d.eval(`
    var src = null;
    if (typeof study_data !== 'undefined' && study_data && study_data.length) src = study_data;
    else if (typeof card_list !== 'undefined' && card_list && card_list.length) src = card_list;
    if (!src) return null;
    var out = [];
    for (var i = 0; i < src.length; i++) {
        var c = src[i] || {};
        out.push({ front: String(c.front == null ? '' : c.front),
                   back: String(c.back == null ? '' : c.back) });
    }
    return out;`);
  return Array.isArray(arr) && arr.length ? arr : null;
}

/**
 * 정답 후보 영어 문장들 — 페이지가 로그한 정답(preload 캡처) + 지금까지 모은 카드 목록.
 */
async function answerCandidates(d, maps) {
  const out = [];
  const logged = await d.eval(
    'return (window.__cc_answers && window.__cc_answers.length) ? window.__cc_answers : null;',
  );
  if (Array.isArray(logged)) for (const x of logged) if (x) out.push(String(x));
  for (const v of maps.m.values()) if (v) out.push(String(v));
  return out;
}

/**
 * 화면의 버튼(낱말)들과 **낱말 구성이 정확히 같은** 후보 문장을 고른다.
 * 제시문 매칭이 실패해도, 버튼이 곧 그 문장의 낱말이므로 이걸로 정답을 특정할 수 있다.
 */
async function pickByTiles(d, candidates) {
  if (!candidates || !candidates.length) return null;
  const tiles = await listButtons(d);
  const bag = (arr) => arr.map((t) => N.normEn(String(t).replace(/\*$/, ''))).filter(Boolean).sort().join('|');
  const want = bag(tiles);
  if (!want) return null;
  for (const cand of candidates) {
    if (bag(N.parseEnglishWords(cand)) === want) return cand;
  }
  return null;
}

/** 페이지 카드 목록을 {한글 -> 영어} 맵에 더한다. 이미 있는 키는 덮어쓰지 않는다. */
function addCardsToMaps(maps, cards) {
  for (const c of cards || []) {
    const back = String(c.back || '').trim();
    const front = String(c.front || '').trim();
    if (!back || !front) continue;
    const k = N.normalizeKor(back);
    const knp = N.normalizeKor(N.stripParensSimple(back));
    if (!maps.m.has(k)) maps.m.set(k, front);
    if (!maps.mnp.has(knp)) maps.mnp.set(knp, front);
  }
  return maps;
}

function matchEnglish(promptRaw, maps) {
  const p = N.normalizeKor(promptRaw);
  if (maps.m.has(p)) return maps.m.get(p);
  const pnp = N.normalizeKor(N.stripParensSimple(promptRaw));
  if (maps.mnp.has(pnp)) return maps.mnp.get(pnp);
  return null;
}

/**
 * 문장 테스트 화면 읽기.
 *
 * 낱말 버튼과 놓인 자리의 이름이 화면마다 다르다 (사이트 스크립트 확인 결과):
 *   단어 세트 문장 테스트 : .test-sentence-words a.btn        / .test-sentence-input span
 *   문법 어순 배열         : .test-sentence-words .btn-sentence-word / .scramble-body .scramble-word
 * 그래서 둘 다 훑고, 카드가 뒤집혔는지도 클래스(.flip)만 믿지 않고
 * **낱말 버튼이 실제로 보이는지**로 판단한다. (클래스 이름이 달라 영영 안 푸는 일을 막는다)
 */
const WORD_SELECTORS = [
  '.test-sentence-words a.btn',
  '.test-sentence-words .btn-sentence-word',
  '.sentence-tab-box .btn-sentence-word',
  '.test-sentence-words .btn',
];
const PLACED_SELECTORS = [
  '.test-sentence-input span',
  '.scramble-body span',
  '.scramble-body .scramble-word',
];

const READ_CARD_JS = `
var WORD_SEL = ${JSON.stringify(WORD_SELECTORS)};
var PLACED_SEL = ${JSON.stringify(PLACED_SELECTORS)};

var card = document.querySelector('.flip-card.showing') ||
           document.querySelector('.flip-card.current') ||
           document.querySelector('.CardItem.current');
if (!card) return { found: false };

var qid = '';
var qi = card.querySelector('input[name="test_question[]"], [name="card_idx[]"]');
if (qi) qid = qi.value;

function count(sels) {
    for (var i = 0; i < sels.length; i++) {
        var n = card.querySelectorAll(sels[i]).length;
        if (n) return n;
    }
    return 0;
}

var words = count(WORD_SEL);
var placed = count(PLACED_SEL);

// 낱말 버튼이 보이면 이미 뒤집힌 것으로 본다 (클래스 이름이 달라도 풀 수 있게)
var flipped = card.classList.contains('flip') || words > 0;

var prompt = '';
var pSel = ['.flip-card-front .front-hidden', '.flip-card-front .cc-table',
            '.flip-card-front .text', '.q-mean-body', '.card-top .normal-body'];
for (var i = 0; i < pSel.length && !prompt; i++) {
    var el = card.querySelector(pSel[i]);
    if (el) prompt = (el.textContent || '').replace(/\\s+/g, ' ').trim();
}

return { found: true, qid: qid, flipped: flipped, prompt: prompt,
         words: words, placed: placed, cls: card.className };`;

/** 낱말 버튼을 못 찾았을 때, 화면이 어떻게 생겼는지 로그로 남긴다. */
const DUMP_CARD_JS = `
var card = document.querySelector('.flip-card.showing') ||
           document.querySelector('.flip-card.current') ||
           document.querySelector('.CardItem.current');
if (!card) return { card: '(없음)' };
var out = { card: card.className, counts: {} };
var sels = ['.test-sentence-words', '.test-sentence-words a', '.btn-sentence-word',
            '.sentence-tab-box', '.scramble-body', '.test-sentence-input',
            'a.btn', 'button'];
for (var i = 0; i < sels.length; i++) out.counts[sels[i]] = card.querySelectorAll(sels[i]).length;
var kids = [];
var all = card.querySelectorAll('*');
for (var i = 0; i < all.length && kids.length < 12; i++) {
    var c = all[i].className;
    if (typeof c === 'string' && c && kids.indexOf(c) < 0) kids.push(c);
}
out.classes = kids;
return out;`;

async function readCard(d) {
  const data = await d.eval(READ_CARD_JS);
  if (!data || !data.found) return null;
  return {
    qid: data.qid || '',
    flipped: !!data.flipped,
    prompt: String(data.prompt || '').trim(),
    words: data.words || 0,
    placed: data.placed || 0,
  };
}

/**
 * 현재 showing 카드에서 아직 안 클릭된 스크램블 버튼 중 token 과 맞는 버튼을 **신뢰된 클릭**.
 * 이 버튼들은 합성 click 을 무시하고 신뢰된 마우스 이벤트에만 반응한다(원본이 CDP 를 쓴 이유).
 */
async function clickWord(d, token) {
  const findBtns = `
    var SEL = ${JSON.stringify(WORD_SELECTORS)};
    var card = document.querySelector('.flip-card.showing') ||
               document.querySelector('.flip-card.current') ||
               document.querySelector('.CardItem.current') || document;
    var btns = [];
    for (var s = 0; s < SEL.length && !btns.length; s++) {
        var found = card.querySelectorAll(SEL[s]);
        if (found.length) btns = found;
    }`;

  const locator = `
    var token = ${JSON.stringify(token)};
    var tokLow = token.toLowerCase();
    var tokNorm = token.toLowerCase().replace(/[^a-z0-9]/g, '');
    ${findBtns}
    var cands = [];
    for (var i = 0; i < btns.length; i++) {
        if (btns[i].classList.contains('clicked')) continue;
        cands.push([btns[i], (btns[i].textContent || '').trim()]);
    }

    var target = null;
    for (var i = 0; i < cands.length; i++) {          // 1) 정확 일치
        if (cands[i][1] === token) { target = cands[i][0]; break; }
    }
    if (!target) {
        for (var i = 0; i < cands.length; i++) {      // 2) 대소문자 무시
            if (cands[i][1].toLowerCase() === tokLow) { target = cands[i][0]; break; }
        }
    }
    if (!target && tokNorm) {
        for (var i = 0; i < cands.length; i++) {      // 3) 영숫자만
            if (cands[i][1].toLowerCase().replace(/[^a-z0-9]/g, '') === tokNorm) {
                target = cands[i][0]; break;
            }
        }
    }
    if (!target) return null;

    target.scrollIntoView({block:'center', inline:'center'});
    var r = target.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2};`;

  if (await d.trustedClick(locator)) return true;

  // 폴백: 신뢰된 클릭이 불가능한 경우에만 합성 클릭 (원본의 except 분기와 동일)
  return d.evalBool(`
    var token = ${JSON.stringify(token)};
    var tokLow = token.toLowerCase();
    var tokNorm = token.toLowerCase().replace(/[^a-z0-9]/g, '');
    ${findBtns}
    var cands = [];
    for (var i = 0; i < btns.length; i++) {
        if (btns[i].classList.contains('clicked')) continue;
        cands.push([btns[i], (btns[i].textContent || '').trim()]);
    }
    for (var i = 0; i < cands.length; i++) {
        if (cands[i][1] === token) { cands[i][0].click(); return true; }
    }
    for (var i = 0; i < cands.length; i++) {
        if (cands[i][1].toLowerCase() === tokLow) { cands[i][0].click(); return true; }
    }
    if (tokNorm) {
        for (var i = 0; i < cands.length; i++) {
            if (cands[i][1].toLowerCase().replace(/[^a-z0-9]/g, '') === tokNorm) {
                cands[i][0].click(); return true;
            }
        }
    }
    return false;`);
}

async function listButtons(d) {
  return d.evalList(`
    var SEL = ${JSON.stringify(WORD_SELECTORS)};
    var card = document.querySelector('.flip-card.showing') ||
               document.querySelector('.flip-card.current') ||
               document.querySelector('.CardItem.current');
    if (!card) return [];
    var out = [];
    var btns = [];
    for (var s = 0; s < SEL.length && !btns.length; s++) {
        var found = card.querySelectorAll(SEL[s]);
        if (found.length) btns = found;
    }
    for (var i = 0; i < btns.length; i++) {
      out.push((btns[i].textContent || '').trim() +
               (btns[i].classList.contains('clicked') ? '*' : ''));
    }
    return out;`);
}

async function clickExitSentence(d, stop, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await d.evalBool(`
      var setLinks = document.querySelectorAll('a[href*="/set/"]');
      for (var i = 0; i < setLinks.length; i++) {
          var a = setLinks[i];
          if (a.offsetParent !== null && (a.textContent || '').indexOf('나가기') >= 0) {
              a.click(); return true;
          }
      }
      var all = document.querySelectorAll('a');
      for (var i = 0; i < all.length; i++) {
          var b = all[i];
          if (b.offsetParent !== null && (b.textContent || '').indexOf('나가기') >= 0) {
              b.click(); return true;
          }
      }
      var prim = document.querySelectorAll('a.btn-primary[href*="/set/"]');
      for (var i = 0; i < prim.length; i++) {
          if (prim[i].offsetParent !== null) { prim[i].click(); return true; }
      }
      return false;`);
    if (clicked) return true;
    if (await stop.await(300)) return false;
  }
  return false;
}

/** 결과 화면 -> 제출 결과 확인 -> 나가기 (단어 테스트와 달리 X 닫기 단계 없음) */
async function testSentenceCheckEndAndStop(d, stop) {
  const visible = await d.evalBool(`
    var b = document.querySelectorAll('${GO_RESULT_SELECTOR}');
    for (var i = 0; i < b.length; i++) if (b[i].offsetParent !== null) return true;
    return false;`);
  if (!visible) return false;

  await d.clickFirstVisible(GO_RESULT_SELECTOR);
  await stop.sleep(1000);

  if (!(await clickExitSentence(d, stop, 10000))) {
    d.log("[문장 테스트] '나가기' 버튼을 찾지 못했습니다.", 'warn');
  }
  await stop.sleep(500);

  stop.set();
  return true;
}

/** 'stop' | true | false */
async function clickWithRetry(d, token, stop) {
  for (let i = 0; i < 4; i++) {
    if (stop.isSet) return 'stop';
    if (await clickWord(d, token)) return true;
    if (await stop.await(350)) return 'stop';
  }
  return false;
}

async function clickToken(d, token, stop) {
  const res = await clickWithRetry(d, token, stop);
  if (res === 'stop' || res === true) return res;

  const subs = N.splitSubtokens(token);
  if (!subs.length) return false;

  let anyOk = false;
  for (const sub of subs) {
    if (!N.normEn(sub)) continue;
    const r = await clickWithRetry(d, sub, stop);
    if (r === 'stop') return 'stop';
    if (r === true) anyOk = true;
    if (await stop.await(150)) return 'stop';
  }
  return anyOk;
}

/** 영어 문장을 어순대로 클릭. makeWrong 이면 마지막 두 토큰을 바꿔 클릭. */
async function clickSentence(d, english, makeWrong, stop) {
  const tokens = N.parseEnglishWords(english);

  const order = tokens.map((_, i) => i);
  if (makeWrong && order.length >= 2) {
    const tmp = order[order.length - 1];
    order[order.length - 1] = order[order.length - 2];
    order[order.length - 2] = tmp;
    d.log(`[문장 테스트] 의도적 오답 (어순 변경): '${english}'`, 'warn');
  }

  let dumped = false;
  for (const k of order) {
    if (stop.isSet) return false;
    const token = tokens[k];
    if (!N.normEn(token)) continue; // 순수 구두점 토큰 skip

    const res = await clickToken(d, token, stop);
    if (res === 'stop') return false;

    if (res !== true) {
      d.log(`[문장 테스트] 버튼 매칭 실패: '${token}'`, 'warn');
      if (!dumped) {
        d.log(`[문장 테스트]   현재 버튼: ${JSON.stringify(await listButtons(d))}`, 'dim');
        dumped = true;
      }
    }

    if (await stop.await(250)) return false;
  }
  return true;
}

/** TestSentence.py — 문장 어순 배열 테스트 자동 풀이 */
async function testSentence(d, answerDict, stop) {
  d.log('[문장 테스트] 시작');

  // 정답은 페이지가 들고 있는 카드 목록에서 먼저 찾는다(단어장이 없어도 풀 수 있다).
  const maps = buildMaps(answerDict || new Map());
  const cards = await pageCards(d);
  if (cards) {
    addCardsToMaps(maps, cards);
    d.log(`[문장 테스트] 페이지 카드 목록 로드 (카드 ${cards.length}개)`);
  }
  if (answerDict && answerDict.size) {
    d.log(`[문장 테스트] 단어장 로드 (카드 ${answerDict.size}개)`);
  }
  if (!maps.m.size) {
    // 카드 목록도 단어장도 없으면, 사이트가 콘솔에 남기는 정답(arr_front)에 기댄다.
    // 그것도 없으면 문제마다 '매칭 실패' 로그가 남는다.
    d.log('[문장 테스트] 카드 목록·단어장이 없습니다 — 페이지가 남기는 정답으로 풉니다.', 'warn');
  }

  const total = await countTotal(d);
  const wrongIdx = planWrongIndices(total, CONFIG.testSentenceTargetScore);

  const flipAttempts = new Map();
  const answeredQids = new Set();
  let answeredCount = 0;
  let lastQid = null;
  let noProgress = 0;

  try {
    while (!stop.isSet) {
      if (await testSentenceCheckEndAndStop(d, stop)) break;
      if (await startStudyIfNeeded(d, stop)) continue;

      const q = await readCard(d);
      if (!q) {
        if (await stop.await(300)) break;
        continue;
      }

      if (q.qid && q.qid === lastQid) {
        noProgress++;
      } else {
        noProgress = 0;
        lastQid = q.qid;
      }
      if (noProgress > 50) {
        d.log('[문장 테스트] 진행이 멈춰 종료합니다 (매칭 실패/UI 변경 가능).', 'warn');
        break;
      }

      if (q.qid && answeredQids.has(q.qid)) {
        await d.pressSpace();
        if (await stop.await(600)) break;
        continue;
      }

      if (!q.flipped) {
        const n = flipAttempts.get(q.qid) || 0;
        if (n < 8) {
          await d.pressSpace();
          flipAttempts.set(q.qid, n + 1);
        } else if (n === 8) {
          flipAttempts.set(q.qid, n + 1);
          // 여덟 번 눌러도 낱말 버튼이 안 보인다 -> 화면 구조를 로그에 남긴다
          const dump = await d.eval(DUMP_CARD_JS);
          d.log(
            '[문장 테스트] 낱말 버튼을 찾지 못했습니다. 화면 구조: ' +
              JSON.stringify(dump).slice(0, 400),
            'warn',
          );
        }
        if (await stop.await(500)) break;
        continue;
      }

      let english = matchEnglish(q.prompt, maps);
      if (!english) {
        // 화면이 바뀌어 카드 목록이 새로 실렸을 수 있다 — 한 번 다시 읽어 본다.
        const fresh = await pageCards(d);
        if (fresh) {
          addCardsToMaps(maps, fresh);
          english = matchEnglish(q.prompt, maps);
        }
      }
      if (!english) {
        // 제시문으로 못 찾으면, 화면의 버튼들과 낱말이 정확히 일치하는 정답 문장을 고른다.
        // (페이지가 로그하는 정답 arr_front + 카드 목록의 영어 문장이 후보)
        english = await pickByTiles(d, await answerCandidates(d, maps));
        if (english) d.log(`[문장 테스트] 화면 버튼과 맞는 정답 문장을 찾았습니다: '${english}'`);
      }
      if (!english) {
        d.log(`[문장 테스트] 매칭 실패(건너뜀): '${q.prompt}'`, 'warn');
        answeredQids.add(q.qid);
        if (await stop.await(300)) break;
        continue;
      }

      answeredCount++;
      const makeWrong = wrongIdx.has(answeredCount);

      const ok = await clickSentence(d, english, makeWrong, stop);
      answeredQids.add(q.qid);
      if (!ok) break;

      if (await stop.await(500)) break;
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[문장 테스트] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[문장 테스트] 종료');
  }
}

// ============================================================ Matching.py

const LEFT_CARD_SELECTOR = '.match-body.left .flip-card';
const RIGHT_CARD_SELECTOR = '.match-body.right .flip-card';

async function buildMatchLookups(d, answerDict) {
  const cards = await d.eval(
    "return (typeof card_list !== 'undefined' && card_list) ? card_list : null;",
  );
  const fwd = new Map();
  const bwd = new Map();

  if (Array.isArray(cards) && cards.length) {
    d.log(`[매칭] 페이지 card_list 로드 (카드 ${cards.length}개)`);
    for (const c of cards) {
      const front = c.front || '';
      const back = c.back || '';
      if (front) fwd.set(N.mnormHtml(front), back);
      if (back) bwd.set(N.mnormHtml(back), front);
    }
    return { fwd, bwd };
  }

  if (!answerDict || !answerDict.size) {
    d.log('[매칭] 오류: card_list도 없고 단어장도 없습니다.', 'error');
    return null;
  }
  d.log(`[매칭] 단어장 폴백 로드 (카드 ${answerDict.size}개)`);
  for (const [back, front] of answerDict) {
    if (front) fwd.set(N.mnormHtml(front), back);
    if (back) bwd.set(N.mnormHtml(back), front);
  }
  return { fwd, bwd };
}

async function readBoard(d) {
  const data = await d.eval(`
    function read(sel) {
      var out = [];
      var cards = document.querySelectorAll(sel);
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        var t = c.querySelector('.match-text > div[style*="font-size"]');
        out.push((t ? t.textContent : '').trim());
      }
      return out;
    }
    return { left: read(${JSON.stringify(LEFT_CARD_SELECTOR)}),
             right: read(${JSON.stringify(RIGHT_CARD_SELECTOR)}) };`);
  if (!data) return null;
  const conv = (items) => (items || []).map((raw, i) => {
    const text = String(raw || '').trim();
    return { index: i, raw: text, norm: N.mnormHtml(text) };
  });
  return { left: conv(data.left), right: conv(data.right) };
}

/** 좌(영어)/우(한국어)에서 확실한 한 쌍을 찾는다. */
function findPair(lefts, rights, lk) {
  // 1) 정확 매칭
  for (const l of lefts) {
    if (!l.norm) continue;
    const kr = lk.fwd.get(l.norm) ?? lk.bwd.get(l.norm) ?? null;
    if (!kr) continue;
    const krn = N.mnormHtml(kr);
    for (const r of rights) {
      if (r.norm && r.norm === krn) return { li: l.index, ri: r.index, lraw: l.raw, rraw: r.raw };
    }
    for (const r of rights) {
      if (krn && r.norm && (krn.includes(r.norm) || r.norm.includes(krn))) {
        return { li: l.index, ri: r.index, lraw: l.raw, rraw: r.raw };
      }
    }
  }

  // 2) 유사도 폴백
  let bestScore = -1;
  let bestPair = null;
  for (const l of lefts) {
    if (!l.norm) continue;
    const kr = lk.fwd.get(l.norm) ?? lk.bwd.get(l.norm) ?? null;
    if (!kr) continue;
    const krn = N.mnormHtml(kr);
    for (const r of rights) {
      const s = ratio(krn, r.norm);
      if (bestPair === null || s > bestScore) {
        bestScore = s;
        bestPair = { li: l.index, ri: r.index, lraw: l.raw, rraw: r.raw };
      }
    }
  }
  if (bestPair && bestScore >= 0.6) return bestPair;

  return null;
}

/** 'stopped' | 'changed' | 'timeout' */
async function waitBoardChange(d, stop, prevLeft, timeoutMs = 2500) {
  const prev = prevLeft.map((c) => c.raw).join(' ');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await stop.await(200)) return 'stopped';
    const board = await readBoard(d);
    if (!board) continue;
    const cur = board.left.map((c) => c.raw).join(' ');
    if (cur !== prev) return 'changed';
  }
  return 'timeout';
}

async function readMatchScore(d) {
  return d.evalIntOrNull(`
    var els = document.querySelectorAll('.match-top .point');
    for (var i = 0; i < els.length; i++) {
        if (els[i].offsetParent !== null) {
            var n = parseInt((els[i].textContent || '').replace(/[^0-9]/g, ''), 10);
            if (!isNaN(n)) return n;
        }
    }
    var e = document.querySelector('.match-top .point');
    if (e) {
        var n = parseInt((e.textContent || '').replace(/[^0-9]/g, ''), 10);
        if (!isNaN(n)) return n;
    }
    return null;`);
}

/** set 상세(셋홈) 페이지인지 */
async function isSetHome(d) {
  return d.evalBool("return document.querySelectorAll('.btn-summary').length > 0;");
}

/** 점수/랭킹 화면에서 '학습 종료'로 셋홈 복귀 */
async function returnToSetHome(d, stop, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stop.isSet || (await isSetHome(d))) return true;
    const clicked = await d.evalBool(`
      function txt(el){ return (el.textContent || '').trim(); }
      var as = document.querySelectorAll(
          '.start-opt-body a, .end-opt-body a, a[onclick*="history.back"]');
      for (var i = 0; i < as.length; i++) {
          if (/학습\\s*종료/.test(txt(as[i]))) { as[i].click(); return true; }
      }
      var c = document.querySelector('.btn-rank-cancel');
      if (c) { c.click(); return true; }
      return false;`);
    if (!clicked) await d.exec('history.back();');
    await stop.sleep(500);
  }
  return isSetHome(d);
}

/** 게임 도중 뒤로가기 -> '매칭종료'(.btn-ok) -> '학습 종료' 로 셋홈 복귀 (점수는 저장됨) */
async function exitMidGame(d, stop) {
  try {
    await d.exec(`
      var b = document.querySelector('.study-header .btn-back');
      if (b) b.click(); else history.back();`);

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (stop.isSet) break;
      const clicked = await d.evalBool(`
        var m = document.querySelector('#confirmModal');
        if (!m) return false;
        var shown = m.classList.contains('in')
            || getComputedStyle(m).display !== 'none';
        if (!shown) return false;
        var b = m.querySelector('.btn-ok');
        if (b) { b.click(); return true; }
        return false;`);
      if (clicked) break;
      await stop.sleep(200);
    }

    await stop.sleep(800);
    await returnToSetHome(d, stop);
  } finally {
    stop.set();
  }
  return true;
}

/** 게임 종료 화면이 보이면 셋홈 복귀 후 stop. */
async function gameCheckEndAndStop(d, stop) {
  const ended = await d.evalBool(`
    function vis(el){ return el && el.offsetParent !== null; }
    return vis(document.querySelector('.start-opt-body'))
        || vis(document.querySelector('.end-opt-body'));`);
  if (!ended) return false;
  await returnToSetHome(d, stop);
  stop.set();
  return true;
}

/** Matching.py — 단어 매칭 게임 자동 풀이 */
async function matching(d, answerDict, stop) {
  d.log('[매칭] 시작');

  const lk = await buildMatchLookups(d, answerDict);
  if (!lk) {
    d.log('[매칭] 종료');
    return;
  }

  const targetScore = randomInt(CONFIG.matchExitMin, CONFIG.matchExitMax);
  d.log(`[매칭] 목표 점수 ${targetScore} 도달 시 중도 종료`);

  let emptyStreak = 0;
  let nomatchStreak = 0;

  try {
    while (!stop.isSet) {
      if (await gameCheckEndAndStop(d, stop)) break;
      if (await startStudyIfNeeded(d, stop)) continue;

      const score = await readMatchScore(d);
      if (score !== null && score >= targetScore) {
        d.log(`[매칭] 목표 점수 도달 (현재 ${score}) -> 중도 종료`, 'success');
        await exitMidGame(d, stop);
        break;
      }

      const board = await readBoard(d);
      if (!board) {
        if (await stop.await(300)) break;
        continue;
      }

      const { left: lefts, right: rights } = board;

      if (!lefts.length && !rights.length) {
        emptyStreak++;
        if (emptyStreak >= 5 && (await gameCheckEndAndStop(d, stop))) break;
        if (await stop.await(300)) break;
        continue;
      }
      emptyStreak = 0;

      const pair = findPair(lefts, rights, lk);

      if (!pair) {
        nomatchStreak++;
        if (nomatchStreak >= 8 && (await gameCheckEndAndStop(d, stop))) break;
        if (await stop.await(400)) break;
        continue;
      }
      nomatchStreak = 0;

      // 한국어(우) 먼저, 영어(좌) 나중 클릭
      await d.clickIndex(RIGHT_CARD_SELECTOR, pair.ri);
      if (await stop.await(150)) break;
      await d.clickIndex(LEFT_CARD_SELECTOR, pair.li);

      if (await waitBoardChange(d, stop, lefts, 2500) === 'stopped') break;
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[매칭] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[매칭] 종료');
  }
}

// ============================================================ Scramble.py

const PROMPT_SELECTOR = '.quest-back';
const PLACED_SELECTOR = '.user-input-body .user-box';
const WORD_SELECTOR = '.suggest-body .word-box:not(.clicked)';
const SCORE_SELECTOR = '.txt-total-score';

async function buildScrambleLookup(d, answerDict) {
  const cards = await d.eval(
    "return (typeof study_data !== 'undefined' && study_data) ? study_data : null;",
  );
  const lookup = new Map();

  if (Array.isArray(cards) && cards.length) {
    d.log(`[스크램블] 페이지 study_data 로드 (카드 ${cards.length}개)`);
    for (const c of cards) {
      const front = c.front || '';
      const back = c.back || '';
      if (front && back) lookup.set(N.knorm(back), N.stripTags(front).trim());
    }
    return lookup;
  }

  if (!answerDict || !answerDict.size) {
    d.log('[스크램블] 오류: study_data도 없고 단어장도 없습니다.', 'error');
    return null;
  }
  d.log(`[스크램블] 단어장 폴백 로드 (카드 ${answerDict.size}개)`);
  for (const [back, front] of answerDict) {
    if (front && back) lookup.set(N.knorm(back), N.stripTags(front).trim());
  }
  return lookup;
}

async function readScrambleState(d) {
  return d.eval(`
    var qb = document.querySelector(${JSON.stringify(PROMPT_SELECTOR)});
    var prompt = qb ? (qb.textContent || '').trim() : '';

    var placed = [];
    var ub = document.querySelectorAll(${JSON.stringify(PLACED_SELECTOR)});
    for (var i = 0; i < ub.length; i++) {
        var t = (ub[i].textContent || '').trim();
        if (t && t !== '?') placed.push(t);
    }

    var cands = [];
    var wb = document.querySelectorAll(${JSON.stringify(WORD_SELECTOR)});
    for (var i = 0; i < wb.length; i++) {
        cands.push((wb[i].textContent || '').trim());
    }

    return { prompt: prompt, placed: placed, cands: cands };`);
}

/** 배치된 박스가 표준형 targetWords 의 어느 인덱스까지 채웠는지. 깨지면 null. */
function alignIndex(targetWords, placed) {
  let ci = 0;
  for (const p of placed) {
    const pn = N.scrambleNorm(p);
    if (!pn) continue;
    let acc = '';
    while (ci < targetWords.length && acc !== pn) {
      acc += N.scrambleNorm(targetWords[ci]);
      ci++;
    }
    if (acc !== pn) return null;
  }
  return ci;
}

/** 다음에 클릭할 후보 인덱스. 반환: [idx, need] */
function findNextIndex(targetWords, placed, cands) {
  const aligned = alignIndex(targetWords, placed);
  const ci = aligned === null ? placed.length : aligned;
  if (ci >= targetWords.length) return [null, null];

  const need = targetWords[ci];

  // 타일이 가질 수 있는 형태 = 토큰 단독, 또는 단어 + 뒤따르는 문장부호 합본
  const options = new Set();
  let acc = '';
  let j = ci;
  while (j < targetWords.length) {
    acc += targetWords[j];
    const n = N.scrambleNorm(acc);
    if (n) options.add(n);
    const nxt = j + 1 < targetWords.length ? targetWords[j + 1] : null;
    if (nxt !== null && N.isNonWordOnly(nxt)) {
      j++;
      continue;
    }
    break;
  }

  // 1) 표준 매칭
  for (let idx = 0; idx < cands.length; idx++) {
    if (options.has(N.scrambleNorm(cands[idx]))) return [idx, need];
  }

  // 2) 폴백: 구두점까지 무시하고 단어만 일치
  const nn = N.wnorm(need);
  if (nn) {
    for (let idx = 0; idx < cands.length; idx++) {
      if (N.wnorm(cands[idx]) === nn) return [idx, need];
    }
  }

  return [null, need];
}

async function readScrambleScore(d) {
  return d.evalIntOrNull(`
    var els = document.querySelectorAll(${JSON.stringify(SCORE_SELECTOR)});
    for (var i = 0; i < els.length; i++) {
        var n = parseInt((els[i].textContent || '').replace(/[^0-9]/g, ''), 10);
        if (!isNaN(n)) return n;
    }
    return null;`);
}

/** Scramble.py — 문장 스크램블 게임 자동 풀이 */
async function scramble(d, answerDict, stop) {
  d.log('[스크램블] 시작');

  const lookup = await buildScrambleLookup(d, answerDict);
  if (!lookup) {
    d.log('[스크램블] 종료');
    return;
  }

  const targetScore = randomInt(CONFIG.scrambleExitMin, CONFIG.scrambleExitMax);
  d.log(`[스크램블] 목표 점수 ${targetScore} 도달 시 종료`);

  let nomatchStreak = 0;

  try {
    while (!stop.isSet) {
      if (await gameCheckEndAndStop(d, stop)) break;
      if (await startStudyIfNeeded(d, stop)) continue;

      const score = await readScrambleScore(d);
      if (score !== null && score >= targetScore) {
        d.log(`[스크램블] 목표 점수 도달 (현재 ${score}) -> 종료`, 'success');
        await returnToSetHome(d, stop, 10000);
        stop.set();
        break;
      }

      const state = await readScrambleState(d);
      if (!state || !state.prompt) {
        if (await stop.await(300)) break;
        continue;
      }

      const target = lookup.get(N.knorm(state.prompt));
      if (!target) {
        if (await stop.await(400)) break;
        continue;
      }

      const targetWords = N.splitTargetWords(target);
      const [idx, need] = findNextIndex(targetWords, state.placed || [], state.cands || []);

      if (idx === null && need === null) {
        // 문장 완성 -> 다음 문제 대기
        if (await stop.await(300)) break;
        continue;
      }

      if (idx === null) {
        nomatchStreak++;
        if (nomatchStreak >= 10 && (await gameCheckEndAndStop(d, stop))) break;
        if (await stop.await(300)) break;
        continue;
      }
      nomatchStreak = 0;

      await d.clickIndex(WORD_SELECTOR, idx);
      if (await stop.await(250)) break;
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[스크램블] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[스크램블] 종료');
  }
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

  return { CONFIG, planWrongIndices, buildLookups, solve, testCheckEndAndStop, test, buildMaps, matchEnglish, testSentenceCheckEndAndStop, testSentence, findPair, isSetHome, returnToSetHome, gameCheckEndAndStop, matching, alignIndex, findNextIndex, scramble };
})();

// ======================================================== extension/engine/modules/sentence.js
__mod.sentence = (function () {
  const N = __mod.norm;
/**
 * MemorizeSentence.py / RecallSentence.py 이식 (문장 암기 · 문장 리콜).
 */


// ============================================================ 공통 종료 판정

/** `.btn-study-end-repeat` 버튼이 보이면 완료. set 페이지로 복귀 후 stop. */
async function checkStep2SuccessAndStop(d, stop) {
  const done = await d.evalBool(
    'return document.querySelectorAll("#study_end.active .btn-study-end-repeat").length > 0;',
  );
  if (!done) return false;
  await d.exec('var a = document.querySelectorAll("#study_end.active .study-header a"); if (a.length) a[0].click();');
  await d.exec('var a = document.querySelectorAll(".btn-top-menu a"); if (a.length) a[0].click();');
  await stop.sleep(500);
  await d.exec('var a = document.querySelectorAll(".close_o"); if (a.length) a[0].click();');
  stop.set();
  return true;
}

// ============================================================ MemorizeSentence.py

async function getKoreanSentence(d) {
  return d.evalStringOrNull(`
    var els = document.querySelectorAll('.active span.para_item');
    if (!els.length) return null;
    var parts = [];
    for (var i = 0; i < els.length; i++) {
        var t = (els[i].innerText || els[i].textContent || '').trim();
        if (t) parts.push(t);
    }
    var text = parts.join(' ');
    return text ? text : null;`);
}

/** 현재 카드의 영어 정답 문장을 DOM 에서 직접 읽는다 (단어장 불필요). */
async function getActiveEnglish(d) {
  return d.evalStringOrNull(`
    var card = document.querySelector('.CardItem.active');
    if (!card) return null;
    var t = card.querySelector('.step.s1 .front .text') || card.querySelector('.text');
    return t ? (t.textContent || '').trim() : null;`);
}

/** 카드 전환 감지용 신호 (영어 정답 우선, 없으면 한국어 제시문). */
async function cardSignal(d) {
  const eng = await getActiveEnglish(d);
  if (eng) return eng;
  return getKoreanSentence(d);
}

async function advanceToNext(d, stop, prevSignal, maxTries = 6) {
  for (let i = 0; i < maxTries; i++) {
    await d.pressSpace();
    let waited = 0;
    while (waited < 1000) {
      if (await stop.await(200)) return;
      waited += 200;
      if (await checkStep2SuccessAndStop(d, stop)) return;
      const cur = await cardSignal(d);
      if (cur && cur !== prevSignal) return;
    }
  }
}

/**
 * 단일 raw 토큰으로 화면 scramble-item 한 개 매칭 + 클릭.
 *
 * 이 스크램블 타일은 합성 click 을 무시하고 신뢰된 마우스 이벤트에만 반응한다
 * (원본이 Selenium 의 진짜 클릭을 쓴 이유. 문장 테스트도 같은 이유로 CDP 를 쓴다).
 * 그래서 신뢰된 클릭을 먼저 보내고, 불가능할 때만 합성 클릭으로 폴백한다.
 */
async function tryClickToken(d, rawToken) {
  const isDash = rawToken === '-' || rawToken === '–' || rawToken === '—';
  const cleaned = isDash ? '' : rawToken.replace(/[^a-zA-Z0-9]/g, '');
  if (!isDash && !cleaned) return false;

  // 낱말 타일의 이름은 화면마다 다르다 (사이트 스크립트 확인 결과):
  //   .scramble-item (예전 문장 암기) / .btn-scramble (문장 리콜) / .sentence-word (문장 카드)
  // 어느 화면이든 되도록 모두 훑는다.
  const find = `
    var DASH = ${isDash};
    var target = ${JSON.stringify(cleaned)};
    var SELS = ['.active .scramble-item:not(.clicked)',
                '.CardItem.current .scramble-item:not(.clicked)',
                '.active .btn-scramble.clickable:not(.clicked)',
                '.CardItem.current .btn-scramble:not(.clicked)',
                '.CardItem.current .card-bottom .sentence-word:not(.clicked)',
                '.active .sentence-word:not(.clicked)'];
    var items = [];
    for (var s = 0; s < SELS.length && !items.length; s++) {
        var found = document.querySelectorAll(SELS[s]);
        if (found.length) items = found;
    }
    var hit = null;
    for (var i = 0; i < items.length; i++) {
        var raw = (items[i].textContent || '').trim();
        var t = DASH ? raw : raw.replace(/[^a-zA-Z0-9]/g, '');
        var ok = DASH ? (raw === '-' || raw === '–' || raw === '—') : (t === target);
        if (ok) { hit = items[i]; break; }
    }`;

  const clicked = await d.trustedClick(`${find}
    if (!hit) return null;
    hit.scrollIntoView({ block: 'center', inline: 'center' });
    var r = hit.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: window.innerWidth };`);
  if (clicked) return true;

  return d.evalBool(`${find}
    if (!hit) return false;
    hit.click();
    return true;`);
}

/** 통째 매칭 실패 시 하이픈/괄호로 분리해 부분 매칭 폴백. */
async function clickScrambleWord(d, rawToken, stop) {
  if (await tryClickToken(d, rawToken)) return true;

  if (/[-–—]/.test(rawToken)) {
    let anyClicked = false;
    for (const sub of N.splitByDash(rawToken)) {
      if (await tryClickToken(d, sub)) {
        anyClicked = true;
        await stop.sleep(150);
      }
    }
    if (anyClicked) return true;
  }

  if (rawToken.includes('(') && rawToken.includes(')')) {
    let anyClicked = false;
    for (const sub of N.splitByParenGroup(rawToken)) {
      if (await tryClickToken(d, sub)) {
        anyClicked = true;
        await stop.sleep(150);
      }
    }
    if (anyClicked) return true;
  }

  return false;
}

/** MemorizeSentence.py — 문장 암기 자동화 */
async function memorizeSentence(d, answerDict, stop) {
  d.log('[문장 암기] 시작');
  try {
    while (!stop.isSet) {
      await d.pressSpace();
      if (await stop.await(300)) break;
      await d.pressSpace();
      if (await stop.await(300)) break;

      // 1) 정답 영어 문장: DOM 에서 직접 읽기
      let englishSentence = await getActiveEnglish(d);

      // 2) 폴백: 한국어 -> 단어장 매칭
      if (!englishSentence && answerDict && answerDict.size) {
        const koreanText = await getKoreanSentence(d);
        if (koreanText) {
          const normalizedKorean = N.normalizeText(koreanText);
          for (const key of answerDict.keys()) {
            if (normalizedKorean === N.normalizeText(key)) {
              englishSentence = answerDict.get(key);
              break;
            }
          }
        }
      }

      if (!englishSentence) {
        if (await checkStep2SuccessAndStop(d, stop)) break;
        if (await stop.await(300)) break;
        continue;
      }

      const prevSignal = await cardSignal(d);
      const words = N.parseEnglishWords(englishSentence);

      for (const word of words) {
        if (stop.isSet) break;
        // 타일이 7개씩 창처럼 보여 아직 안 나타났을 수 있으니 재시도
        for (let i = 0; i < 10; i++) {
          if (await clickScrambleWord(d, word, stop)) break;
          if (await stop.await(200)) break;
        }
        if (await stop.await(150)) break;
      }

      if (stop.isSet) break;
      if (await stop.await(300)) break;

      await advanceToNext(d, stop, prevSignal);

      if (await checkStep2SuccessAndStop(d, stop)) break;
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[문장 암기] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[문장 암기] 종료');
  }
}

// ============================================================ RecallSentence.py

/** prefix 가 부분 수열이면 마지막 매칭 인덱스, 아니면 -1. */
function findSubsequenceEnd(prefixTokens, sentenceTokens) {
  const pLow = prefixTokens.map((t) => t.toLowerCase());
  if (!pLow.length) return -1;
  let i = 0;
  let last = -1;
  for (let idx = 0; idx < sentenceTokens.length; idx++) {
    if (sentenceTokens[idx].toLowerCase() === pLow[i]) {
      last = idx;
      i++;
      if (i === pLow.length) return last;
    }
  }
  return -1;
}

/** preload.js 가 모아 둔 정답 문장 목록(중복 제거). */
async function getPageAnswers(d) {
  const arr = await d.eval(
    'return (window.__cc_answers && window.__cc_answers.length) ? window.__cc_answers : null;',
  );
  if (!Array.isArray(arr) || !arr.length) return null;
  const seen = [];
  for (const raw of arr) {
    const s = String(raw || '').trim();
    if (s && !seen.includes(s)) seen.push(s);
  }
  return seen.length ? seen : null;
}

async function getPrefixTokens(d) {
  const text = await d.evalStringOrNull(`
    var el = document.querySelector('.active .input-box');
    if (!el) return null;
    var t = (el.innerText || el.textContent || '').trim();
    return t.slice(0, -1);`);
  if (!text) return [];
  return N.tokenize(text);
}

async function getAvailableTokens(d) {
  return d.evalList(`
    var btns = document.querySelectorAll('.btn-scramble.clickable');
    var out = [];
    for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].innerText || btns[i].textContent || '').trim();
        if (t) out.push(t);
    }
    return out;`);
}

async function hasActiveInput(d) {
  return d.evalBool("return document.querySelectorAll('.active .input-box').length > 0;");
}

/** prefix 로 시작하는 문장들. */
function findMatchingSentences(prefixTokens, sentences, tokenizeFn) {
  const n = prefixTokens.length;
  if (n === 0) return [];
  const lowerPrefix = prefixTokens.map((t) => t.toLowerCase());
  const matches = [];
  for (const sentence of sentences) {
    const tokens = tokenizeFn(sentence);
    if (tokens.length < n) continue;
    const head = tokens.slice(0, n).map((t) => t.toLowerCase());
    if (head.join(' ') === lowerPrefix.join(' ')) matches.push(sentence);
  }
  return matches;
}

/** 후보 단어 순열로 유일 문장을 좁힌다 (itertools.permutations 이식). */
function findMatchingSentenceFallback(prefixTokens, availableTokens, sentences, tokenizeFn) {
  const n = Math.min(4, availableTokens.length);
  if (n === 0) return null;
  const lowerPrefix = prefixTokens.map((t) => t.toLowerCase());

  let found = null;
  permutations(availableTokens, n, (perm) => {
    const candidate = lowerPrefix.concat(perm.map((t) => t.toLowerCase()));
    const key = candidate.join(' ');
    const matched = [];
    for (const sentence of sentences) {
      const tokens = tokenizeFn(sentence);
      if (tokens.length < candidate.length) continue;
      const head = tokens.slice(0, candidate.length).map((t) => t.toLowerCase());
      if (head.join(' ') === key) matched.push(sentence);
    }
    if (matched.length === 1) {
      found = matched[0];
      return false; // 순회 중단
    }
    return true;
  });
  return found;
}

function permutations(items, r, onPerm) {
  if (r === 0 || r > items.length) return;
  const used = new Array(items.length).fill(false);
  const current = [];

  function rec() {
    if (current.length === r) return onPerm(current);
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      current.push(items[i]);
      const cont = rec();
      current.pop();
      used[i] = false;
      if (!cont) return false;
    }
    return true;
  }
  rec();
}

/** 빈 prefix(문장 시작)일 때 후보 단어 멀티셋으로 문장을 식별한다. */
function findSentenceByCandidates(availableTokens, sentences, tokenizeFn) {
  const cand = availableTokens.map((t) => N.wkey(t)).filter(Boolean).sort();
  if (!cand.length) return null;
  const k = availableTokens.length;
  const matched = [];
  for (const s of sentences) {
    const toks = tokenizeFn(s);
    if (toks.length < k) continue;
    const head = toks.slice(0, k).map((t) => N.wkey(t)).filter(Boolean).sort();
    if (head.join(' ') === cand.join(' ')) matched.push(s);
  }
  if (matched.length === 1) return matched[0];
  if (matched.length > 1) {
    const firsts = new Set(
      matched.map((s) => {
        const toks = tokenizeFn(s);
        return toks.length ? N.wkey(toks[0]) : null;
      }).filter((v) => v !== null),
    );
    if (firsts.size === 1) return matched[0];
  }
  return null;
}

/**
 * 화면 가용 scramble 버튼에 있는 토큰만 순서대로 클릭.
 * 매칭 우선순위: 정확 일치(정규화) -> 대소문자 무시 -> 구두점 무시.
 */
async function clickRemainingTokens(d, remainingTokens, stop) {
  for (const token of remainingTokens) {
    if (stop.isSet) break;

    // 후보 버튼을 찾는 부분(원본과 같은 우선순위: 정확 -> 대소문자 무시 -> 구두점 무시)
    const find = `
      var token = ${JSON.stringify(token)};
      function normUni(s) {
          var map = {'‘':"'", '’':"'", '‚':"'", '‛':"'",
                     '“':'"', '”':'"', '„':'"', '‟':'"',
                     '–':'-', '—':'-', '−':'-', '…':'...'};
          var out = '';
          for (var i = 0; i < s.length; i++) {
              var c = s.charAt(i);
              out += (map[c] !== undefined) ? map[c] : c;
          }
          return out;
      }
      var btns = document.querySelectorAll('.btn-scramble.clickable:not(.clicked)');
      var texts = [];
      for (var i = 0; i < btns.length; i++) {
          texts.push(normUni((btns[i].innerText || btns[i].textContent || '').trim()));
      }
      var hit = null;
      for (var i = 0; i < btns.length; i++) {
          if (texts[i] === token) { hit = btns[i]; break; }
      }
      if (!hit) {
          for (var i = 0; i < btns.length; i++) {
              if (texts[i].toLowerCase() === token.toLowerCase()) { hit = btns[i]; break; }
          }
      }
      if (!hit) {
          var tokenClean = token.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          if (tokenClean) {
              for (var i = 0; i < btns.length; i++) {
                  if (texts[i].replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === tokenClean) {
                      hit = btns[i]; break;
                  }
              }
          }
      }`;

    const none = await d.evalBool(`${find}
      return btns.length === 0;`);
    if (none) break;                          // 남은 버튼 없음

    // 원본(Selenium)은 진짜 클릭을 먼저 보냈다. 이 버튼도 합성 click 을 무시할 수 있으므로
    // 신뢰된 클릭을 먼저 쓰고, 안 되면 합성 클릭으로 폴백한다.
    let clicked = await d.trustedClick(`${find}
      if (!hit) return null;
      hit.scrollIntoView({ block: 'center', inline: 'center' });
      var r = hit.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: window.innerWidth };`);

    if (!clicked) {
      clicked = await d.evalBool(`${find}
        if (!hit) return false;
        hit.click();
        return true;`);
    }

    if (!clicked) {
      if (N.isPunctOnly(token)) continue;    // 단독 구두점은 버튼이 없는 게 정상
      break;                                  // 화면에 없는 단어 -> 중단
    }

    if (await stop.await(200)) break;
  }
}

async function inputText(d) {
  return (await d.evalStringOrNull(`
    var el = document.querySelector('.active .input-box');
    if (!el) return '';
    return (el.innerText || el.textContent || '').trim();`)) || '';
}

async function advance(d, stop, maxTries = 6) {
  const before = await inputText(d);
  for (let i = 0; i < maxTries; i++) {
    await d.pressSpace();
    let waited = 0;
    while (waited < 1000) {
      if (await stop.await(200)) return;
      waited += 200;
      if (await checkStep2SuccessAndStop(d, stop)) return;
      if ((await inputText(d)) !== before) return;
    }
  }
}

/** RecallSentence.py — 문장 리콜 자동화 */
async function recallSentence(d, answerDict, stop) {
  d.log('[문장 리콜] 시작');

  // 페이지가 정답을 로그할 때까지 잠깐 대기 (console.log 후킹 캡처)
  let capturedLogged = false;
  for (let i = 0; i < 20; i++) {
    if (await getPageAnswers(d)) {
      d.log('[문장 리콜] 페이지 정답 캡처 성공 (단어장 불필요)', 'success');
      capturedLogged = true;
      break;
    }
    if (await stop.await(300)) return;
  }
  if (!capturedLogged && (!answerDict || !answerDict.size)) {
    d.log('[문장 리콜] 정답 소스 없음 (캡처 실패 & 단어장 없음). 종료', 'error');
    return;
  }

  try {
    while (!stop.isSet) {
      const pageAnswers = await getPageAnswers(d);
      const activeSentences = pageAnswers || (answerDict ? Array.from(answerDict.values()) : []);

      if (!activeSentences.length) {
        if (await checkStep2SuccessAndStop(d, stop)) break;
        if (await stop.await(300)) break;
        continue;
      }

      let prefixTokens = await getPrefixTokens(d);

      if (!prefixTokens.length) {
        if (!(await hasActiveInput(d))) {
          if (await checkStep2SuccessAndStop(d, stop)) break;
          if (await stop.await(300)) break;
          continue;
        }

        // 문장 시작(빈 prefix): 후보 단어로 문장을 식별해 처음부터 클릭
        const availableTokens = (await getAvailableTokens(d)).map((t) => N.normalizeUnicode(t));
        const startFn = availableTokens.some((t) => N.isPunctOnly(t)) ? N.tokenizeLoose : N.tokenize;
        const normalized = activeSentences.map((s) => N.normalizeUnicode(s));
        const startSentence =
          findSentenceByCandidates(availableTokens, normalized, startFn) ||
          findSentenceByCandidates(availableTokens, normalized.map((s) => N.stripParens(s)), startFn);

        if (!startSentence) {
          if (await stop.await(300)) break;
          continue;
        }

        await clickRemainingTokens(d, startFn(startSentence), stop);
        if (await stop.await(300)) break;
        await advance(d, stop);
        continue;
      }

      prefixTokens = prefixTokens.map((t) => N.normalizeUnicode(t));
      const tokenizeFn = N.isPrefixPunctSplit(prefixTokens) ? N.tokenizeLoose : N.tokenize;
      const normalized = activeSentences.map((s) => N.normalizeUnicode(s));

      let matches = findMatchingSentences(prefixTokens, normalized, tokenizeFn);
      let working = normalized;

      if (!matches.length) {
        working = normalized.map((s) => N.stripParens(s));
        matches = findMatchingSentences(prefixTokens, working, tokenizeFn);
      }

      let sentence = null;
      let subseqEnd = -1;

      if (matches.length === 1) {
        sentence = matches[0];
      } else if (matches.length > 1) {
        const availableTokens = (await getAvailableTokens(d)).map((t) => N.normalizeUnicode(t));
        sentence = findMatchingSentenceFallback(prefixTokens, availableTokens, working, tokenizeFn);
      }

      if (!sentence) {
        const candidates = [];
        for (const s of working) {
          const sTokens = tokenizeFn(s);
          const end = findSubsequenceEnd(prefixTokens, sTokens);
          if (end >= 0) candidates.push([s, end, sTokens]);
        }
        if (candidates.length) {
          candidates.sort((a, b) => a[2].length - b[2].length);
          [sentence, subseqEnd] = [candidates[0][0], candidates[0][1]];
        }
      }

      if (!sentence) {
        d.log(`[문장 리콜] 매칭 실패: ${JSON.stringify(prefixTokens)}`, 'warn');
        if (await stop.await(300)) break;
        continue;
      }

      let allTokens = tokenizeFn(sentence);
      let remainingTokens = subseqEnd >= 0
        ? allTokens.slice(subseqEnd + 1)
        : allTokens.slice(prefixTokens.length);

      if (remainingTokens.some((t) => t.includes('(') || t.includes(')'))) {
        const stripped = normalized.map((s) => N.stripParens(s));
        const alt = findMatchingSentences(prefixTokens, stripped, tokenizeFn);
        const altSentence = alt.length === 1 ? alt[0] : null;
        if (!altSentence) {
          const altCands = [];
          for (const sAlt of stripped) {
            const sTok = tokenizeFn(sAlt);
            const endAlt = findSubsequenceEnd(prefixTokens, sTok);
            if (endAlt >= 0) altCands.push([sAlt, endAlt, sTok]);
          }
          if (altCands.length) {
            altCands.sort((a, b) => a[2].length - b[2].length);
            allTokens = altCands[0][2];
            remainingTokens = allTokens.slice(altCands[0][1] + 1);
          }
        } else {
          allTokens = tokenizeFn(altSentence);
          remainingTokens = allTokens.slice(prefixTokens.length);
        }
      }

      await clickRemainingTokens(d, remainingTokens, stop);

      if (stop.isSet) break;

      await advance(d, stop);

      if (await checkStep2SuccessAndStop(d, stop)) break;
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[문장 리콜] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[문장 리콜] 종료');
  }
}

  return { checkStep2SuccessAndStop, memorizeSentence, findSubsequenceEnd, findMatchingSentences, findMatchingSentenceFallback, findSentenceByCandidates, recallSentence };
})();

// ======================================================== extension/engine/modules/grammar.js
__mod.grammar = (function () {
  const N = __mod.norm;
  const buildLookups = __mod.games.buildLookups;
/**
 * 문법훈련(GClass) 자동 풀이 — 안드로이드 Grammar.kt 와 같은 로직.
 *
 * 셀렉터는 사용자가 저장해 준 실제 문법 클래스 페이지(www.classcard.net/GClass/…)의
 * HTML 과 style_v2.css 에서 확인한 이름을 그대로 쓴다.
 *
 *  클래스 페이지 : .unit-list > .unit-item[data-idx] > .unit-title
 *                 .unit-content .unit-set-list .set-box (.lock 이면 잠김, .ing 이면 진행중)
 *                 -> 개념 톡 · 연습 문제 A/B · 서술형 문제 · 실전 문제 · 누적오답복습 · Scramble
 *  문제 화면     : .gclass-q-item (+ .correct / .wrong 이 채점 결과)
 *                 .gclass-q-quest                        지문
 *                 .gclass-q-answer-box .gclass-q-answer-text   정답(숨겨져 있어도 읽는다)
 *                 .gclass-q-input .object-body .object         객관식 보기
 *                 .gclass-q-input .inline-box .option-box .option-item   인라인 선택
 *                 .gclass-q-input input / .inline-input-body input       입력형
 *
 * 짝맞추기(16)·분류(17)는 gclass_test.js 의 채점부에서 규칙을 확인했다:
 *   16 — 같은 줄에 놓인 왼쪽·오른쪽 .match-item 의 data-idx 가 같으면 정답
 *   17 — .grouping-item 의 data-key 와 고른 .chk_grouping 의 value 가 같으면 정답
 * 그래서 이 두 유형은 추측 없이 화면에 실린 값 그대로 푼다.
 *
 * 그래도 값이 실려 있지 않은 화면을 대비해, 찍고 채점 결과를 기억해 오답을 지워 나가는
 * 구조 기반 폴백을 남겨 둔다.
 */



const CONFIG = {
  debug: false,         // 진단 로그
  // 한 동작(보기 클릭·채점하기·Enter·화면 이동) 뒤에 기다리는 시간.
  // 문법훈련은 소리를 읽어 주고 카드가 애니메이션으로 나타나므로, 빨리 누르면
  // 페이지가 아직 못 받는다. 넉넉히 3초를 기다린다.
  stepDelayMs: 3000,
  // 사이트 정답 데이터를 미리 다 읽어 둔 화면은 찍을 필요가 없다.
  // 이럴 때는 기다리지 않고 바로바로 눌러 문제를 한 번에 다 맞춘다.
  knownStepMs: 700,
  maxTryPerQuestion: 6,  // 한 문제에서 이만큼 시도하면 다음으로 넘어간다
  idleGiveUp: 30,        // 문제도 버튼도 못 찾은 채 이만큼 반복하면(≈12초) 종료
  driveClassPage: true,  // 클래스 페이지에서 유닛/단계를 스스로 눌러 진행할지
  reviewWrong: true,     // 오답이 있으면 '누적오답복습'을 먼저 다시 학습할지
  // 개념 톡 해설 음성을 끝까지 들려줄지. 끄면 재생 위치를 끝으로 보내 빨리 넘어간다.
  playTalkAudio: true,
  loadSettleMs: 600,     // 화면의 항목이 다 로드됐는지 확인할 때 두 번 재는 간격
};

/** 같은 안내 창이 이만큼 연달아 다시 뜨면 그만 누르고 멈춘다. */
const MODAL_REPEAT_LIMIT = 5;

/**
 * 개념 톡 해설 음성을 이만큼(0.7초 단위) 기다려도 안 끝나면 알린다.
 * 해설을 끝까지 들려주므로 긴 카드도 덮을 만큼 넉넉히 둔다(≈84초).
 */
const TALK_WAIT_LIMIT = 120;

/** 단계 시작 화면에서 '시작' 을 이만큼 눌러도 안 넘어가면 멈춘다. */
const START_PRESS_LIMIT = 4;

/** 소리에 손을 대기 전에 이만큼(0.7초 단위) 먼저 지켜본다. */
const TALK_AUDIO_SKIP_AFTER = 3;

/**
 * 재생 위치가 이만큼(0.7초 단위) 1초도 안 늘어나면 소리가 멈춘 것으로 본다.
 * 그때만 '끝났다'고 알려 다음으로 넘어간다. 재생 중이면 절대 건드리지 않는다.
 */
const TALK_AUDIO_FORCE_AFTER = 8;

/** 합성 클릭이 이만큼 무시되면 신뢰된 클릭(CDP)으로 올린다. */
const TRUSTED_AFTER = 2;

/** 클래스 페이지에서 이 순서로 단계를 진행한다(화면에 나타나는 순서와 같다). */
const STAGE_ORDER = [
  '개념 톡', '연습 문제 A', '연습 문제 B', '서술형 문제',
  '실전 문제', '누적오답복습', 'Scramble',
];

const NEXT_SELECTORS = [
  // 문법 문제 화면의 '채점하기' (실제 마크업: .btn.btn-gclass.btn-next-card)
  '.flip-card.showing .btn-next-card', '.btn-next-card',
  '.flip-card.showing .default-btn-body .btn-gclass',
  '.study-bottom .btn-next-box .btn-gclass', '.study-bottom .btn-next-box a',
  '.btn-next-box .btn-gclass', '.btnNextCard',
  '.btn-condition-next', '.btn-next', '.btn-continue',
  // 모달 버튼은 글자를 보고 고른다(handleModal). 여기서 눌렀다간 '학습 생략'을 누를 수 있다.
  '.btn-quiz-start', '.btn-opt-start',
];

const END_SELECTORS = [
  '.start-opt-body', '.end-opt-body', '.result-body', '.quiz-result', 'a.btn-go-result',
];

const READ_STATE_JS = `
// 지난 화면에서 붙여 둔 표시를 먼저 지운다.
// 문제 화면은 카드가 카드 여러 장이 겹쳐 보이므로, 남아 있는 표시를 그대로 두면
// **이전 카드의 빈칸·보기**를 채우거나 눌러 버린다(그 문제는 빈칸으로 제출되어 틀린다).
(function () {
    var marks = ['data-cc-input', 'data-cc-tinput', 'data-cc-opt', 'data-cc-order',
                 'data-cc-sel', 'data-cc-next', 'data-cc-rowopt', 'data-cc-row',
                 'data-cc-left', 'data-cc-right'];
    for (var m = 0; m < marks.length; m++) {
        var old = document.querySelectorAll('[' + marks[m] + ']');
        for (var i = 0; i < old.length; i++) old[i].removeAttribute(marks[m]);
    }
})();

function vis(el) {
    if (!el || el.offsetParent === null) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}
function txt(el) { return ((el && el.textContent) || '').replace(/\\s+/g, ' ').trim(); }
// 보기 텍스트: .option-answer 는 화면에 안 보이는 사본이라 빼고 읽는다
function optTxt(el) {
    if (!el) return '';
    var c = el.cloneNode(true);
    var dup = c.querySelectorAll('.option-answer');
    for (var i = 0; i < dup.length; i++) dup[i].parentNode.removeChild(dup[i]);
    return (c.textContent || '').replace(/\\s+/g, ' ').trim();
}
function any(sel) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) if (vis(els[i])) return els[i];
    return null;
}

var NEXT_SEL = ${JSON.stringify(NEXT_SELECTORS)}.join(',');
var END_SEL = ${JSON.stringify(END_SELECTORS)}.join(',');

// ================================================ 0) 로그인 화면
// 세션이 끊기면 사이트가 어떤 주소든 로그인 화면으로 돌려보낸다.
// 이걸 문제 화면으로 착각하면 '아이디/비밀번호 찾기' 같은 링크를 눌러 버린다.
// 주의: 로그인 폼이 position:fixed 안에 있으면 offsetParent 가 null 이라
// 평소의 vis() 로는 '안 보인다'고 나온다(모달에서 겪은 것과 같은 함정).
// 그래서 크기와 스타일로만 판단하고, 사이트가 붙이는 body.login 도 함께 본다.
var loginIns = document.querySelectorAll(
    'input[name="login_id"], input[name="login_pwd"], #login_id, #login_pwd');
var onLogin = false;
for (var i = 0; i < loginIns.length; i++) {
    var lr = loginIns[i].getBoundingClientRect();
    if (!(lr.width > 0 && lr.height > 0)) continue;
    var ls = window.getComputedStyle(loginIns[i]);
    if (ls.display !== 'none' && ls.visibility !== 'hidden') { onLogin = true; break; }
}
if (!onLogin && loginIns.length) {
    var bodyCls = ' ' + ((document.body && document.body.className) || '') + ' ';
    if (bodyCls.indexOf(' login ') >= 0) onLogin = true;
}
if (onLogin) {
    return { kind: 'login' };
}

// ================================================ 0) 단계 시작 화면 (학습 시작 버튼)
// 클래스에서 단계를 열면 곧바로 문제가 나오지 않는다. '시작' 버튼 하나만 있는
// 시작 화면이 먼저 뜨고, 그 버튼이 쿠키(is_std_start)를 심고 페이지를 다시 연다.
// 이걸 안 누르면 카드가 아예 만들어지지 않아, 매크로가 '풀 게 없다'고 보고 끝내 버린다.
var startBtn = null;
var sbs = document.querySelectorAll('.btn-quiz-start, .btn-opt-start');
for (var i = 0; i < sbs.length; i++) if (vis(sbs[i])) { startBtn = sbs[i]; break; }
if (startBtn) {
    // 클래스 페이지에도 비슷한 버튼이 있을 수 있으므로, 단계 목록이 보이면 시작 화면이 아니다.
    var anyBox = document.querySelectorAll('.unit-set-list .set-box');
    var boxVisible = false;
    for (var i = 0; i < anyBox.length; i++) if (vis(anyBox[i])) { boxVisible = true; break; }
    if (!boxVisible) {
        startBtn.setAttribute('data-cc-startbtn', '1');
        return { kind: 'start', label: txt(startBtn).slice(0, 20) };
    }
}

// ================================================ 1) 문법 클래스 페이지
// 화면에 보이는 유닛만 센다. 문제 화면으로 넘어가도 클래스 페이지가 DOM 에
// 숨은 채 남아 있는 경우가 있어, 보이지 않으면 클래스 페이지로 보지 않는다.
var allUnits = document.querySelectorAll('.unit-list .unit-item');
var unitItems = [];
for (var i = 0; i < allUnits.length; i++) if (vis(allUnits[i])) unitItems.push(allUnits[i]);
if (unitItems.length) {
    var units = [];
    for (var i = 0; i < unitItems.length; i++) {
        var u = unitItems[i];
        var title = u.querySelector('.unit-title');
        var nameEl = u.querySelector('.unit-name');
        var uname = txt(nameEl);
        var stages = [];
        var boxes = u.querySelectorAll('.unit-set-list .set-box');
        for (var j = 0; j < boxes.length; j++) {
            var b = boxes[j];
            var stitle = txt(b.querySelector('.title')) || txt(b);
            // 페이지를 다시 열어도 변하지 않는 키 (자리 번호를 쓰면 잠금이 풀릴 때 어긋난다)
            var skey = uname + '|' + stitle;
            b.setAttribute('data-cc-stage', skey);
            stages.push({
                key: skey,
                title: stitle,
                locked: b.className.indexOf('lock') >= 0,
                visible: vis(b)
            });
        }
        u.setAttribute('data-cc-unit', String(i));
        units.push({
            i: i,
            name: uname,
            locked: u.className.indexOf('lock') >= 0,
            open: !!(title && title.getAttribute('data-open') === '1'),
            hasTitle: !!title,
            stages: stages
        });
    }
    return { kind: 'class', units: units };
}

// ================================================ 2) 개념 톡 (grammarTalk)
// 사이트 스크립트(scripts/v2/grammar_talk.js)를 확인한 결과:
//   - 지금 푸는 카드는 전역 card_idx 가 가리키는 $('.talk-card').eq(card_idx) 다.
//     (이전 카드들도 화면에 남아 있으므로 '마지막으로 보이는 카드'로 고르면 안 된다)
//   - 정답은 arr_card[card_idx].answer (빈칸이 여러 개면 ';' 로 구분)
//   - 카드 종류는 data-type:
//       0/4 설명·문장(빈칸 입력)  2 객관식(.option-item, 정답 비교는 .option-txt)
//       6 어순 배열(.order-item)  1 해설  3 문장
//   - 빈칸을 보기로 고르는 화면은 문서 전체의 .select-option 을 눌러 채운다.
//   - 다음으로 넘어가는 버튼은 .next-btn ('계속하기 (Enter)'), Enter(keyup) 도 같은 동작.
//   - 클릭 처리에 isTrusted 검사는 없다(합성 클릭도 받는다).
var talkCards = document.querySelectorAll('.talk-card');
if (talkCards.length) {
    var ci = -1;
    try { if (typeof card_idx !== 'undefined' && card_idx !== null) ci = Number(card_idx); } catch (e) {}
    if (!(ci >= 0 && ci < talkCards.length)) {
        // card_idx 를 못 읽으면 마지막으로 보이는 카드를 현재 카드로 본다
        for (var i = 0; i < talkCards.length; i++) if (vis(talkCards[i])) ci = i;
    }
    var card = (ci >= 0 && ci < talkCards.length) ? talkCards[ci] : null;

    if (card) {
        var ctype = card.getAttribute('data-type') || '';
        var ccls = ' ' + (card.className || '') + ' ';

        var answer = '';
        try {
            if (typeof arr_card !== 'undefined' && arr_card && arr_card[ci] && arr_card[ci].answer != null) {
                answer = String(arr_card[ci].answer);
            }
        } catch (e) {}

        // 객관식 보기 (.option-item) — 정답 비교는 .option-txt 의 글자
        var opts = [];
        var oi = card.querySelectorAll('.option-item');
        for (var i = 0; i < oi.length; i++) {
            oi[i].setAttribute('data-cc-opt', String(i));
            var ot = oi[i].querySelector('.option-txt');
            opts.push({ i: i, text: txt(ot || oi[i]) });
        }

        // 어순 배열 (.order-item) — 아직 안 고른 것만
        var orders = [];
        var od = card.querySelectorAll('.order-item');
        for (var i = 0; i < od.length; i++) {
            od[i].setAttribute('data-cc-order', String(i));
            orders.push({
                i: i, text: txt(od[i]),
                picked: (' ' + (od[i].className || '') + ' ').indexOf(' selected ') >= 0
            });
        }

        // 빈칸 입력 (.user-text) — 지금 채울 칸은 .choice
        var blanks = [];
        var ut = card.querySelectorAll('.user-text');
        for (var i = 0; i < ut.length; i++) {
            ut[i].setAttribute('data-cc-tinput', String(i));
            var bc = ' ' + (ut[i].className || '') + ' ';
            blanks.push({
                i: i,
                cnt: parseInt(ut[i].getAttribute('data-cnt') || '-1', 10),
                filled: !!(ut[i].value || '').trim() || bc.indexOf(' choice-end ') >= 0,
                current: bc.indexOf(' choice ') >= 0
            });
        }

        // 빈칸을 고르는 보기 (문서 전체에 있다)
        var picks = [];
        var so = document.querySelectorAll('.select-option');
        for (var i = 0; i < so.length; i++) {
            if (!vis(so[i])) continue;
            so[i].setAttribute('data-cc-sel', String(picks.length));
            var num = so[i].querySelector('.select-num');
            var full = txt(so[i]);
            var numTxt = num ? txt(num) : '';
            picks.push({ i: picks.length, text: numTxt ? full.replace(numTxt, '').trim() : full });
        }

        // 다음으로 넘어가는 버튼
        var nb = null;
        var nbs = document.querySelectorAll('.next-btn');
        for (var i = 0; i < nbs.length; i++) if (vis(nbs[i])) nb = nbs[i];
        if (nb) nb.setAttribute('data-cc-next', '1');

        // 바로 다음 카드의 해설에 정답 단서가 들어 있다 (정답 데이터가 없을 때 쓴다)
        var upcoming = '';
        var nx = card.nextElementSibling;
        while (nx && (nx.className || '').indexOf('talk-card') < 0) nx = nx.nextElementSibling;
        if (nx) {
            var cr = nx.querySelector('.content-row.correct');
            upcoming = txt(cr || nx);
        }

        var written = '';
        for (var i = 0; i < ut.length; i++) written += '|' + (ut[i].value || '') + (ut[i].className || '');
        for (var i = 0; i < oi.length; i++) written += '#' + (oi[i].className || '');
        for (var i = 0; i < od.length; i++) written += '@' + (od[i].className || '');

        return {
            kind: 'talk',
            idx: ci,
            ctype: ctype,
            answer: answer,
            qid: 'card' + ci,
            sig: ci + '|' + ctype + '|' + ccls + '|' + written + '|' + (nb ? '1' : '0'),
            options: opts,
            orders: orders,
            blanks: blanks,
            picks: picks,
            hasNext: !!nb,
            upcoming: upcoming,
            cards: talkCards.length,
            done: ccls.indexOf(' end ') >= 0,
            correct: ccls.indexOf(' correct ') >= 0,
            wrong: ccls.indexOf(' wrong ') >= 0,
            // 사이트는 소리(해설 음성)가 끝날 때까지 카드에 'wait' 를 달아 두고,
            // 그 동안에는 Enter 도 '계속하기'도 받지 않는다 (grammar_talk.js keyup/setPassStatus).
            waiting: ccls.indexOf(' wait ') >= 0
        };
    }
}

// ================================================ 3) 종료 화면
if (any(END_SEL)) {
    return { kind: 'end' };
}

// ================================================ 4) 문법 문제 화면
// 문제는 .flip-card 로 겹겹이 쌓여 있고 현재 카드에만 .showing 이 붙는다.
// (.next / .hidden 카드도 화면에 걸쳐 보일 수 있어 반드시 .showing 으로 좁힌다)
var items = document.querySelectorAll('.flip-card.showing .gclass-q-item');
if (!items.length) items = document.querySelectorAll('.gclass-q-item');
for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!vis(it)) continue;
    var cls = ' ' + it.className + ' ';
    var done = cls.indexOf(' correct ') >= 0 || cls.indexOf(' wrong ') >= 0;

    var question = txt(it.querySelector('.gclass-q-quest')) ||
                   txt(it.querySelector('.gclass-q-dictation'));

    // 정답이 DOM 에 들어 있으면 숨겨져 있어도 읽는다.
    var answer = '';
    var abox = it.querySelector('.gclass-q-answer-box');
    if (abox) {
        var atexts = abox.querySelectorAll('.gclass-q-answer-text');
        var parts = [];
        for (var j = 0; j < atexts.length; j++) {
            var t = txt(atexts[j]);
            if (t) parts.push(t);
        }
        answer = parts.join(' ') || txt(abox);
    }

    // 인라인 선택형은 ' ? ' 를 눌러야 보기(.option-box)가 열린다.
    var opening = false;
    var hints = it.querySelectorAll('.inline-input-body .hint-box');
    for (var j = 0; j < hints.length; j++) {
        var obox = hints[j].parentElement
            ? hints[j].parentElement.querySelector('.option-box') : null;
        if (obox && !vis(obox) && vis(hints[j])) { hints[j].click(); opening = true; break; }
    }

    // 보기 종류별로 찾는다 (실제 마크업 이름)
    var type = '', found = [];
    var groups = [
        ['object', '.gclass-q-input .object-body .object'],
        ['option', '.inline-box .option-box:not(.hidden) .option-item'],
        // 실전 문제의 객관식(정답이 여러 개일 수 있다) — gclass_test.js 는 .option-list 를 쓴다
        ['option', '.option-list .option-item'],
        ['scramble', '.test-sentence-words .btn-sentence-word, .scramble-body .scramble-word'],
        ['group', '.grouping-body .grouping-item'],
        ['match', '.match-content .match-body .match-item']
    ];
    for (var g = 0; g < groups.length; g++) {
        var els = it.querySelectorAll(groups[g][1]);
        var keep = [];
        for (var j = 0; j < els.length; j++) if (vis(els[j]) && optTxt(els[j])) keep.push(els[j]);
        if (keep.length >= 2) { type = groups[g][0]; found = keep; break; }
    }

    // 입력형(서술형·딕테이션). 배열형은 빈칸이 여러 개라 전부 읽는다.
    var inputs = [];
    if (!found.length) {
        var ins = it.querySelectorAll(
            '.gclass-q-input input[type="text"], .inline-input-body input, .dictation-input, textarea');
        for (var j = 0; j < ins.length; j++) {
            if (!vis(ins[j]) || ins[j].disabled) continue;
            ins[j].setAttribute('data-cc-input', String(inputs.length));
            inputs.push({ i: inputs.length, filled: !!(ins[j].value || '').trim() });
        }
        if (inputs.length) type = 'input';
    }

    // 힌트: 쓸 단어들이 화면에 주어지는 유형이 있다 (.q-mean-body '힌트 the, tallest, …')
    var hint = '';
    var hb = it.querySelector('.q-mean-body');
    if (hb) {
        var hc = hb.cloneNode(true);
        var lb = hc.querySelectorAll('.label');
        for (var j = 0; j < lb.length; j++) lb[j].parentNode.removeChild(lb[j]);
        hint = (hc.textContent || '').replace(/\\s+/g, ' ').trim();
    }

    // ---- 분류형: 줄마다 라디오 보기가 따로 있다
    var rows = [];
    if (type === 'group') {
        for (var j = 0; j < found.length; j++) {
            var row = found[j];
            row.setAttribute('data-cc-row', String(j));
            var rcls = ' ' + row.className + ' ';
            var labels = row.querySelectorAll('.radio-button label');
            var opts = [];
            for (var k = 0; k < labels.length; k++) {
                if (!vis(labels[k])) continue;
                labels[k].setAttribute('data-cc-rowopt', j + '_' + k);
                // 이 라벨이 누르는 라디오의 value. gclass_test.js 는 채점할 때
                // select_el.val() 과 줄의 data-key 를 견준다 (drill_type 17).
                var rad = null;
                try {
                    var forId = labels[k].getAttribute('for');
                    if (forId) rad = document.getElementById(forId);
                    if (!rad && labels[k].parentNode) {
                        rad = labels[k].parentNode.querySelector('input.chk_grouping, input[type="radio"]');
                    }
                } catch (e) {}
                opts.push({
                    i: k, key: j + '_' + k, text: txt(labels[k]),
                    val: rad ? String(rad.value == null ? '' : rad.value).trim() : ''
                });
            }
            // 줄 이름: 라디오 라벨 텍스트를 뺀 나머지
            var name = txt(row);
            for (var k = 0; k < opts.length; k++) name = name.replace(opts[k].text, ' ');
            // 사이트가 정답으로 쓰는 값 — 줄의 data-key 가 그 줄이 속할 그룹 번호다.
            var rkey = row.getAttribute('data-key');
            // 이 줄에서 이미 고른 보기(라디오)가 있으면 다시 고르지 않는다
            var rsel = '';
            try {
                var on = row.querySelector('input.chk_grouping:checked, input[type="radio"]:checked');
                if (on) rsel = String(on.value == null ? '' : on.value).trim();
            } catch (e) {}
            rows.push({
                i: j,
                text: name.replace(/\\s+/g, ' ').trim(),
                options: opts,
                key: rkey == null ? '' : String(rkey).trim(),
                sel: rsel,
                bad: rcls.indexOf(' wrong ') >= 0,
                done: rcls.indexOf(' correct ') >= 0 || rcls.indexOf(' wrong ') >= 0
            });
        }
    }

    // ---- 짝맞추기: 왼쪽/오른쪽을 따로 읽는다 (.end 는 이미 맞춘 칸)
    var left = [], right = [];
    if (type === 'match') {
        var sides = [['left', left], ['right', right]];
        for (var sIdx = 0; sIdx < sides.length; sIdx++) {
            var side = sides[sIdx][0], bucket = sides[sIdx][1];
            var cells = it.querySelectorAll('.match-content .match-body.' + side + ' .match-item');
            for (var j = 0; j < cells.length; j++) {
                if (!vis(cells[j])) continue;
                cells[j].setAttribute('data-cc-' + side, String(j));
                // 사이트는 같은 줄에 놓인 왼쪽·오른쪽의 data-idx 가 같으면 정답으로 친다
                // (gclass_test.js drill_type 16). 즉 data-idx 가 곧 짝 번호다.
                var mIdx = cells[j].getAttribute('data-idx');
                bucket.push({
                    i: j,
                    text: txt(cells[j]),
                    idx: mIdx == null ? '' : String(mIdx).trim(),
                    done: (' ' + cells[j].className + ' ').indexOf(' end ') >= 0
                });
            }
        }
    }

    // ---- 어순 배열: 이미 고른 타일과 남은 타일
    var tiles = [];
    if (type === 'scramble') {
        for (var j = 0; j < found.length; j++) {
            var tcls = ' ' + found[j].className + ' ';
            found[j].setAttribute('data-cc-opt', String(j));
            tiles.push({
                i: j,
                text: txt(found[j]),
                used: tcls.indexOf(' clicked ') >= 0 || tcls.indexOf(' correct ') >= 0
                      || tcls.indexOf(' wrong ') >= 0 || tcls.indexOf(' end ') >= 0
            });
        }
    }

    var choices = [], selectedIdx = -1;
    if (type === 'object' || type === 'option' || type === 'fallback' || type === '') {
        for (var j = 0; j < found.length; j++) {
            found[j].setAttribute('data-cc-opt', String(j));
            var scls = ' ' + found[j].className + ' ';
            var on = scls.indexOf(' selected ') >= 0 || scls.indexOf(' active ') >= 0
                || scls.indexOf(' checked ') >= 0;
            // 사이트는 채점할 때 보기 안에 숨겨 둔 .option-answer 의 글자를 쓴다
            // (화면에 보이는 글자와 다를 수 있어 둘 다 들고 있는다)
            var aEl = found[j].querySelector('.option-answer');
            choices.push({
                i: j,
                text: optTxt(found[j]),
                ans: aEl ? txt(aEl) : '',
                on: on
            });
            if (on) selectedIdx = j;
        }
    }

    // 빈칸을 전부 채웠는지
    var filled = inputs.length > 0;
    for (var j = 0; j < inputs.length; j++) if (!inputs[j].filled) filled = false;

    if (done && !choices.length && !inputs.length && !rows.length && !left.length && !tiles.length) continue;

    var sig = question + '#' + selectedIdx + (filled ? '+' : '') + '@' + inputs.length;
    for (var j = 0; j < choices.length; j++) sig += '|' + choices[j].text;
    for (var j = 0; j < rows.length; j++) sig += '|r' + rows[j].text;
    for (var j = 0; j < left.length; j++) sig += '|l' + left[j].text + (left[j].done ? '*' : '');
    for (var j = 0; j < right.length; j++) sig += '|R' + right[j].text + (right[j].done ? '*' : '');
    for (var j = 0; j < tiles.length; j++) sig += '|t' + tiles[j].text + (tiles[j].used ? '*' : '');

    var qid = question;
    for (var j = 0; j < choices.length; j++) qid += '|' + choices[j].text;

    // 카드 종류 (gclass_test.js 의 data-type). 2·3 이 '여러 개 고르는' 객관식이다.
    var flip = it.closest ? it.closest('.flip-card') : null;
    var cardType = flip ? (flip.getAttribute('data-type') || '') : '';
    // 아직 보기·입력이 아닌 유형들 (구문 표시 / 문단 순서 / 드롭다운)
    var scope = flip || it;
    var paints = scope.querySelectorAll('.paint-word').length;
    var paragraphs = scope.querySelectorAll('.paragraph-row').length;
    var selects = 0;
    var selEls = scope.querySelectorAll('select.select-option, .select-option select');
    for (var j = 0; j < selEls.length; j++) if (vis(selEls[j])) selects++;

    return {
        kind: 'quiz', type: type, qid: qid, sig: sig, cardType: cardType,
        paints: paints, paragraphs: paragraphs, selects: selects,
        question: question, answer: answer,
        choices: choices, selectedIdx: selectedIdx, filled: filled,
        hasInput: inputs.length > 0, inputs: inputs, hint: hint, opening: opening,
        rows: rows, left: left, right: right, tiles: tiles,
        feedback: cls.indexOf(' correct ') >= 0 ? 'correct'
                : (cls.indexOf(' wrong ') >= 0 ? 'wrong' : 'none'),
        next: !!any(NEXT_SEL)
    };
}

// ================================================ 5) 이름을 모르는 화면 (폴백)
var question = '';
var qSel = ['.quest-front', '.quest-back', '.quest-body', '.question-body',
            '.quiz-question', '.txt-question', '.card-question'];
for (var i = 0; i < qSel.length && !question; i++) {
    var qs = document.querySelectorAll(qSel[i]);
    for (var j = 0; j < qs.length; j++) if (vis(qs[j]) && txt(qs[j])) { question = txt(qs[j]); break; }
}

var found = [];
var optSel = ['.quiz-opt-body .opt-box', '.opt-body .opt-item', '.opt-list .opt-item',
              'label[for^="radio_"]:not(.hidden)', '.answer-box .answer-item',
              '.btn-answer', '.list-choice li', 'ul.choice li', '.choice-item'];
for (var i = 0; i < optSel.length; i++) {
    var els = document.querySelectorAll(optSel[i]);
    var keep = [];
    for (var j = 0; j < els.length; j++) if (vis(els[j]) && txt(els[j])) keep.push(els[j]);
    if (keep.length >= 2) { found = keep; break; }
}
if (!found.length) {
    // 한 부모 아래 같은 태그로 나란히 있는 2~6개의 "누를 수 있어 보이는" 짧은 요소 묶음
    var all = document.querySelectorAll('button, li, label, a, div, span');
    var byKey = {};
    for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (!vis(el)) continue;
        var t = txt(el);
        if (!t || t.length > 300) continue;
        if (question && t === question) continue;
        var tag = el.tagName;
        var clickable = (tag === 'BUTTON' || tag === 'LI' || tag === 'LABEL' || tag === 'A');
        if (!clickable) {
            var cur = '';
            try { cur = getComputedStyle(el).cursor; } catch (e) {}
            if (cur !== 'pointer') continue;
            if (el.querySelector('button, li, label, a')) continue;
        }
        var p = el.parentElement;
        if (!p) continue;
        if (!p.__ccKey) p.__ccKey = 'p' + (Math.random() + '').slice(2);
        var key = p.__ccKey + '|' + tag;
        (byKey[key] = byKey[key] || []).push(el);
    }
    for (var k in byKey) {
        var g2 = byKey[k];
        if (g2.length >= 2 && g2.length <= 6 && g2.length > found.length) found = g2;
    }
}

var choices = [];
for (var i = 0; i < found.length; i++) {
    found[i].setAttribute('data-cc-opt', String(i));
    choices.push({ i: i, text: txt(found[i]) });
}

var feedback = 'none';
if (any('[class*="wrong"], [class*="incorrect"], .x-mark, .mark-x')) feedback = 'wrong';
else if (any('[class*="correct"], .o-mark, .mark-o')) feedback = 'correct';

var sig = question;
for (var i = 0; i < choices.length; i++) sig += '|' + choices[i].text;

return {
    kind: choices.length ? 'quiz' : 'idle', type: 'fallback',
    qid: sig, sig: sig, question: question, answer: '',
    choices: choices, hasInput: false, feedback: feedback, next: !!any(NEXT_SEL)
};
`;

const CLICK_NEXT_JS = `
function vis(el) {
    if (!el || el.offsetParent === null) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}
var sel = ${JSON.stringify(NEXT_SELECTORS)};
for (var i = 0; i < sel.length; i++) {
    var els = document.querySelectorAll(sel[i]);
    for (var j = 0; j < els.length; j++) {
        if (vis(els[j]) && els[j].className.indexOf('disabled') < 0) { els[j].click(); return true; }
    }
}
return false;
`;

async function readState(d) {
  const data = await d.eval(READ_STATE_JS);
  if (!data || typeof data !== 'object') return null;
  // 화면 종류가 정해진 것들은 그대로 넘긴다.
  // ('start'/'login' 을 빠뜨리면 시작 화면·로그인 화면을 문제 화면으로 잘못 읽는다)
  if (data.kind === 'class' || data.kind === 'start' || data.kind === 'login'
      || data.kind === 'end' || data.kind === 'idle') return data;
  if (data.kind === 'talk') {
    const conv = (arr) => (arr || [])
      .filter((c) => c && (c.text || '').trim())
      .map((c) => ({ ...c, index: c.i, raw: c.text.trim(), norm: N.mnorm(c.text.trim()) }));
    return {
      ...data,
      options: conv(data.options),
      orders: conv(data.orders),
      picks: conv(data.picks),
      blanks: data.blanks || [],
      answers: splitAnswers(data.answer || ''),
    };
  }
  return {
    kind: 'quiz',
    type: data.type || '',
    cardType: String(data.cardType || ''),   // 사이트 카드 종류 (data-type)
    paints: data.paints || 0,                // 구문 표시형의 낱말 수
    paragraphs: data.paragraphs || 0,        // 문단 순서형의 조각 수
    selects: data.selects || 0,              // 드롭다운 칸 수
    qid: data.qid || '',
    sig: data.sig || '',
    question: (data.question || '').trim(),
    answer: (data.answer || '').trim(),
    hasInput: !!data.hasInput,
    inputs: (data.inputs || []).map((x) => ({ index: x.i, filled: !!x.filled })),
    hint: (data.hint || '').trim(),
    selectedIdx: typeof data.selectedIdx === 'number' ? data.selectedIdx : -1,
    filled: !!data.filled,
    opening: !!data.opening,
    feedback: data.feedback || 'none',
    next: !!data.next,
    choices: (data.choices || [])
      .filter((c) => c && (c.text || '').trim())
      .map((c) => ({
        index: c.i,
        raw: c.text.trim(),
        norm: N.mnorm(c.text.trim()),
        ans: (c.ans || '').trim(),          // 사이트가 채점에 쓰는 글자
        on: !!c.on,                         // 지금 골라져 있는가
      })),
    rows: (data.rows || []).map((r) => ({
      index: r.i,
      text: (r.text || '').trim(),
      done: !!r.done,
      key: (r.key || '').trim(),          // 사이트가 쓰는 정답 그룹 번호
      sel: (r.sel || '').trim(),          // 이미 골라 둔 값 (있으면 그 줄은 끝났다)
      bad: !!r.bad,                       // 채점에서 틀렸다고 표시된 줄
      options: (r.options || []).map((o) => ({
        index: o.i, key: o.key, raw: (o.text || '').trim(), norm: N.mnorm(o.text || ''),
        val: (o.val || '').trim(),        // 이 보기를 고르면 저장되는 값
      })),
    })),
    left: (data.left || []).map((c) => (
      { index: c.i, raw: (c.text || '').trim(), idx: (c.idx || '').trim(), done: !!c.done })),
    right: (data.right || []).map((c) => (
      { index: c.i, raw: (c.text || '').trim(), idx: (c.idx || '').trim(), done: !!c.done })),
    tiles: (data.tiles || []).map((t) => ({
      index: t.i, raw: (t.text || '').trim(), norm: N.mnorm(t.text || ''), used: !!t.used,
    })),
  };
}

/**
 * 보기 선택형에서 **골라야 하는 보기들**.
 *
 * 사이트 스크립트(gclass_test.js)를 확인한 결과, 객관식(카드 type 2·3)은
 * 정답을 '|' 로 이어 두고 **그 개수만큼 골라야** 제출을 받는다:
 *   if ($(el).find('.option-item.selected').length < answer.split('|').length) {
 *       showConfirm('정답이 N개인데 M개만 선택하였습니다. 이대로 제출할까요?' …)
 *   }
 * 채점도 고른 보기들의 .option-answer 글자를 '|' 로 이어 맞춰 본다.
 * (빈칸형에서 '|' 가 '둘 중 아무거나'인 것과 다르다 — 그쪽은 splitBlanks 를 쓴다)
 *
 * @param {string} raw 사이트 정답 원문
 * @returns {string[]} 골라야 하는 보기 글자들 (1개면 한 개만 고른다)
 */
function splitPicks(raw) {
  return String(raw == null ? '' : raw)
    .split('|')
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * 정답 보기 여러 개 중 **아직 고르지 않은 첫 번째** 보기 번호. 다 골랐으면 null.
 *
 * @param {{index:number, raw:string, ans?:string, on?:boolean}[]} choices
 * @param {string[]} wanted 골라야 하는 보기 글자들
 */
function nextPickIndex(choices, wanted) {
  const list = choices || [];
  const norm = (t) => N.mnorm(String(t || ''));
  const match = (c, w) => {
    const nw = norm(w);
    if (!nw) return false;
    return norm(c.ans) === nw || norm(c.raw) === nw;
  };
  const taken = new Set();
  for (const w of wanted || []) {
    // 이미 골라 둔 보기가 이 정답을 맡고 있으면 넘어간다
    const done = list.find((c) => c.on && !taken.has(c.index) && match(c, w));
    if (done) { taken.add(done.index); continue; }
    const open = list.find((c) => !c.on && !taken.has(c.index) && match(c, w));
    if (open) return open.index;
    return null;            // 화면에 없는 정답 -> 더 고를 수 없다
  }
  return null;              // 다 골랐다
}

/**
 * 고를 보기 번호. 순수 로직이라 단위 테스트로 검증한다.
 *
 * @param {{index:number, raw:string, norm:string}[]} choices
 * @param {string|null} answer 정답(모르면 null)
 * @param {Set<number>} wrong  이 문제에서 이미 틀린 보기 번호
 */
function pickChoice(choices, answer, wrong) {
  if (!choices || !choices.length) return null;
  const open = choices.filter((c) => !wrong || !wrong.has(c.index));
  const pool = open.length ? open : choices;

  if (answer) {
    const am = N.mnorm(answer);
    if (am) {
      const exact = pool.find((c) => c.norm === am);
      if (exact) return exact.index;
      // 문장 첫 글자 대문자처럼 대소문자만 다른 경우까지 받아준다.
      const lower = am.toLowerCase();
      const ci = pool.find((c) => c.norm.toLowerCase() === lower);
      if (ci) return ci.index;
      const part = pool.find((c) => {
        const cn = c.norm.toLowerCase();
        return cn && (lower.includes(cn) || cn.includes(lower));
      });
      if (part) return part.index;
    }
  }
  return pool[0].index;
}

/**
 * 어순 배열: 다음에 누를 타일 번호.
 * 정답 문장을 토큰으로 끊어, 지금까지 고른 개수만큼 건너뛴 다음 단어와 같은 타일을 찾는다.
 * 정답을 모르면 아직 안 쓴 첫 타일(왼쪽부터)을 고른다.
 *
 * @param {string|null} answer 정답 문장
 * @param {{index:number, raw:string, norm:string, used:boolean}[]} tiles
 * @param {number[]} clicked 지금까지 누른 타일 번호(순서대로)
 */
function nextScrambleIndex(answer, tiles, placed) {
  const open = (tiles || []).filter((t) => !t.used);
  if (!open.length) return null;

  const words = answer
    ? N.splitTargetWords(answer).map((w) => N.wnorm(w)).filter(Boolean)
    : [];
  if (!words.length) {
    // 정답을 모르면 아직 안 쓴 첫 타일
    const left = open.filter((t) => !(placed || []).includes(t.index));
    return left.length ? left[0].index : null;
  }

  // 사이트는 낱말을 놓을 때마다 남은 타일을 다시 늘어놓아 번호가 바뀐다.
  // 그래서 번호가 아니라 **이미 놓은 낱말 목록**으로 진행 상황을 센다.
  // (같은 낱말이 두 번 나오는 문장도 한 번씩 차례로 지워 가며 맞춘다)
  const rest = (placed || []).map((w) => String(w));
  for (let i = 0; i < words.length; i++) {
    const need = words[i];
    const already = rest.indexOf(need);
    if (already >= 0) { rest.splice(already, 1); continue; }
    const exact = open.find((t) => N.wnorm(t.raw) === need);
    if (exact) return exact.index;
    // 타일이 여러 토큰을 담는 경우("without." 처럼) 앞부분만 맞아도 받아준다
    const part = open.find((t) => {
      const tn = N.wnorm(t.raw);
      return tn && (tn.startsWith(need) || need.startsWith(tn));
    });
    if (part) return part.index;
    return null;                 // 다음 낱말이 화면에 없다 -> 더 놓을 수 없다
  }
  return null;                   // 정답 낱말을 다 놓았다
}


/**
 * 짝맞추기: 다음에 시도할 (왼쪽, 오른쪽) 짝.
 * 이미 맞춘 칸(done)과 이미 틀린 조합(failed)은 건너뛴다.
 *
 * @param {{index:number, raw:string, done:boolean}[]} left
 * @param {{index:number, raw:string, done:boolean}[]} right
 * @param {Set<string>} failed "l_r" 형태로 저장한 실패 조합
 */
function nextPairAttempt(left, right, failed) {
  // 사이트는 같은 줄의 왼쪽·오른쪽 data-idx 가 같으면 정답으로 친다(drill_type 16).
  // 그 번호가 화면에 실려 있으면 추측하지 않고 바로 맞는 짝을 누른다.
  for (const l of left || []) {
    if (l.done || !l.idx) continue;
    for (const r of right || []) {
      if (r.done || r.idx !== l.idx) continue;
      // 눌렀는데 사이트가 못 받은 조합은 다시 고르지 않는다.
      // (안 그러면 같은 짝을 무한히 다시 눌러 그 문제에서 멈춘다)
      if (failed && failed.has(`${l.index}_${r.index}`)) continue;
      return { left: l.index, right: r.index };
    }
  }
  // 번호가 없는 화면에서만 하나씩 시도한다.
  for (const l of left || []) {
    if (l.done) continue;
    for (const r of right || []) {
      if (r.done) continue;
      if (failed && failed.has(`${l.index}_${r.index}`)) continue;
      return { left: l.index, right: r.index };
    }
  }
  return null;
}

/**
 * 분류형: 아직 답하지 않은 줄과, 그 줄에서 고를 보기.
 * 정답 문장에 "줄이름 - 보기" 가 들어 있으면 그것을 쓰고, 없으면 안 틀린 보기를 고른다.
 */
function nextGroupPick(rows, answer, wrongByRow) {
  for (const row of rows || []) {
    if (row.done || row.sel || !row.options.length) continue;
    const wrong = (wrongByRow && wrongByRow.get(row.index)) || new Set();
    // 사이트는 줄의 data-key 와 고른 라디오 값이 같으면 정답으로 친다(drill_type 17).
    // 그 값이 화면에 실려 있으면 추측하지 않고 바로 맞는 보기를 고른다.
    if (row.key) {
      const sure = row.options.find((o) => o.val && o.val === row.key);
      if (sure) return { row: row.index, option: sure.index };
    }
    let hint = null;
    if (answer && row.text) {
      // 정답 문장에서 줄 이름 뒤에 나오는 보기를 찾는다
      const am = N.mnorm(answer);
      const rm = N.mnorm(row.text);
      const at = rm ? am.indexOf(rm) : -1;
      if (at >= 0) {
        // 줄 이름 바로 뒤에 '가장 먼저' 나오는 보기가 그 줄의 답이다.
        // (뒤쪽에 다른 줄의 답이 이어져 있어도 앞선 것을 고른다)
        const rest = am.slice(at + rm.length, at + rm.length + 40);
        let best = -1;
        for (const o of row.options) {
          if (!o.norm) continue;
          const at2 = rest.indexOf(o.norm);
          if (at2 >= 0 && (best < 0 || at2 < rest.indexOf(row.options[best].norm))) {
            best = row.options.indexOf(o);
          }
        }
        if (best >= 0) hint = row.options[best].raw;
      }
    }
    const pick = pickChoice(
      row.options.map((o) => ({ index: o.index, raw: o.raw, norm: o.norm })),
      hint, wrong,
    );
    if (pick !== null) return { row: row.index, option: pick };
  }
  return null;
}

/**
 * 이 화면에 정답 데이터가 실려 있는지 확인한다.
 *
 * 문법은 단계(개념 톡·연습 문제·서술형·실전·누적오답복습)마다 페이지가 새로 열리고,
 * 그때마다 정답 데이터도 새로 실린다. 그래서 새 화면에 들어갈 때마다 한 번 확인해
 * 로그에 남긴다 — 정답으로 풀 수 있는 화면인지 바로 알 수 있다.
 */
const CHECK_ANSWER_SOURCE_JS = `
var out = { quiz: 0, quizWith: 0, talk: 0, talkWith: 0 };
// 이 화면의 정답을 통째로 담아 둔다. 문제를 풀 때마다 다시 읽지 않고 여기서 꺼내 쓴다.
var box = { byCard: {}, order: [], talk: [] };
try {
    if (typeof arr_answer !== 'undefined' && arr_answer && arr_answer.length) {
        out.quiz = arr_answer.length;
        for (var i = 0; i < arr_answer.length; i++) {
            var row = arr_answer[i] || {};
            var a = row.answer;
            var v = a == null ? '' : String(a);
            box.order.push(v);
            if (row.card_idx != null) box.byCard[String(row.card_idx)] = v;
            if (v.trim()) out.quizWith++;
        }
    }
} catch (e) {}
try {
    if (typeof arr_card !== 'undefined' && arr_card && arr_card.length) {
        out.talk = arr_card.length;
        for (var i = 0; i < arr_card.length; i++) {
            var a = arr_card[i] && arr_card[i].answer;
            var v = a == null ? '' : String(a);
            box.talk.push(v);
            if (v.trim()) out.talkWith++;
        }
    }
} catch (e) {}
try { window.__ccGAll = box; } catch (e) {}
return out;
`;

/**
 * 새 화면에 들어갈 때마다 그 화면의 정답을 **전부** 한 번에 읽어 둔다.
 * (문제마다 다시 뒤지지 않고, 읽어 둔 표에서 꺼내 바로 정답을 누른다)
 * 읽은 정답이 있으면 true — 이 화면은 찍지 않고 다 맞출 수 있다는 뜻이다.
 */
async function checkAnswerSource(d, label) {
  const v = await d.eval(CHECK_ANSWER_SOURCE_JS);
  if (!v) return false;
  if (v.quiz) {
    d.log(`[문법] ${label} 정답 데이터 확인 — 문항 ${v.quiz}개 중 정답 ${v.quizWith}개를 한 번에 읽었습니다.`);
    return v.quizWith > 0;
  }
  if (v.talk) {
    d.log(`[문법] ${label} 정답 데이터 확인 — 카드 ${v.talk}장 중 정답 ${v.talkWith}개를 한 번에 읽었습니다.`);
    return v.talkWith > 0;
  }
  d.log(`[문법] ${label} 정답 데이터를 찾지 못했습니다 — 화면 정보와 채점 결과로 풉니다.`);
  return false;
}

/**
 * 사이트가 채점에 쓰는 정답 데이터를 그대로 읽는다.
 *
 * 실제 소스(classcard.net/scripts/v2/gclass_test.js, grammar_talk.js)를 확인한 결과:
 *   문제 화면  : var answer = obj_answer['q' + card_idx]  ← arr_answer[{card_idx, answer}] 에서 만든다
 *   개념 톡    : var card_obj = arr_card[card_idx]; card_obj.answer
 * 즉 정답은 페이지 전역 arr_answer / arr_card 에 들어 있다. 그것을 그대로 쓴다.
 *
 * 정답 문자열은 여러 개일 수 있다 — 빈칸별로 ';', 객관식 복수정답은 '|' 로 구분된다.
 */
const READ_PAGE_ANSWER_JS = `
function vis(el) {
    if (!el || el.offsetParent === null) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}

// 화면에 들어올 때 통째로 읽어 둔 정답표(없으면 그때그때 전역에서 읽는다)
var ALL = null;
try { ALL = (window.__ccGAll && typeof window.__ccGAll === 'object') ? window.__ccGAll : null; } catch (e) {}

// ---- 문제 화면: 지금 보이는 카드의 card_idx 로 정답표에서 찾는다
var card = document.querySelector('.flip-card.showing');
var list = (typeof arr_answer !== 'undefined' && arr_answer) ? arr_answer : null;
if (card && (list && list.length || ALL && ALL.order.length)) {
    var id = null;
    var ci = card.querySelector('[name="card_idx[]"], .card_idx');
    if (ci && ci.value) id = String(ci.value);
    if (!id) {
        var item = card.querySelector('.gclass-q-item');
        if (item) id = item.getAttribute('data-idx');
    }
    if (id) {
        if (list) {
            for (var i = 0; i < list.length; i++) {
                if (String(list[i].card_idx) === String(id)) {
                    return { src: 'arr_answer', answer: String(list[i].answer == null ? '' : list[i].answer) };
                }
            }
        }
        if (ALL && ALL.byCard[id] != null) {
            return { src: '미리 읽은 정답표', answer: String(ALL.byCard[id]) };
        }
    }
    // id 로 못 찾으면 카드 순서로 맞춰 본다
    var cards = document.querySelectorAll('.flip-card');
    for (var i = 0; i < cards.length; i++) {
        if (cards[i] !== card) continue;
        if (list && list[i]) {
            return { src: 'arr_answer(순서)', answer: String(list[i].answer == null ? '' : list[i].answer) };
        }
        if (ALL && ALL.order[i] != null) {
            return { src: '미리 읽은 정답표(순서)', answer: String(ALL.order[i]) };
        }
    }
}

// ---- 개념 톡: 마지막으로 보이는 카드가 지금 카드
var talkList = (typeof arr_card !== 'undefined' && arr_card && arr_card.length) ? arr_card : null;
if (talkList || (ALL && ALL.talk.length)) {
    var tc = document.querySelectorAll('.talk-card');
    var idx = -1;
    for (var i = 0; i < tc.length; i++) if (vis(tc[i])) idx = i;
    if (idx >= 0) {
        if (talkList && talkList[idx]) {
            return { src: 'arr_card', answer: String(talkList[idx].answer == null ? '' : talkList[idx].answer) };
        }
        if (ALL && ALL.talk[idx] != null) {
            return { src: '미리 읽은 정답표', answer: String(ALL.talk[idx]) };
        }
    }
}
return null;
`;

/**
 * 개념 톡에서 직접 써 넣어야 하는 빈칸을, 그 카드의 사이트 정답으로 한 번에 채운다.
 * 어떤 칸에 무엇을 썼는지 [{i, value}] 로 돌려준다.
 */
const TALK_FILL_JS = `
// 개념 톡 빈칸 채우기 — 사이트 채점 방식 그대로.
//
// grammar_talk.js 의 setAnswer():
//     $.each(card_obj.answer.split(';'), function (i, v) {
//         checkAnswer2(v.trim(), card_el.find('.user-text').eq(i).val().trim(), …)
//     })
//   즉 **지금 카드(card_idx) 안의 i번째 .user-text** 에 정답의 i번째 조각을 넣어야 한다.
//   ';' 는 칸 구분, '|' 는 같은 칸의 다른 답이다 ('|' 로도 쪼개면 칸 번호가 밀린다).
var out = [];
var cards = document.querySelectorAll('.talk-card');
var idx = (typeof card_idx !== 'undefined' && card_idx >= 0) ? card_idx : -1;
var card = idx >= 0 ? cards[idx] : null;
if (!card) {                       // card_idx 를 못 읽으면 마지막으로 보이는 카드
    for (var i = 0; i < cards.length; i++) {
        if (cards[i].offsetParent !== null) { card = cards[i]; idx = i; }
    }
}
if (!card) return out;

var raw = null;
if (typeof arr_card !== 'undefined' && arr_card && arr_card[idx] && arr_card[idx].answer != null) {
    raw = String(arr_card[idx].answer);
} else {
    try {
        var ALL = (window.__ccGAll && typeof window.__ccGAll === 'object') ? window.__ccGAll : null;
        if (ALL && ALL.talk[idx] != null) raw = String(ALL.talk[idx]);
    } catch (e) {}
}
if (raw == null) return out;

var parts = raw.split(';').map(function (x) {
    return x.split('|')[0].replace(/\\s*\\/\\s*/g, ' ').replace(/\\s+/g, ' ').trim();
});

var boxes = card.querySelectorAll('.user-text');
for (var i = 0; i < boxes.length && i < parts.length; i++) {
    var el = boxes[i];
    var v = parts[i];
    if (!v) continue;
    if ((el.value || '').trim() === v) continue;        // 이미 맞게 들어 있다
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    out.push({ i: i, value: v });
}
return out;
`;

/** 페이지 정답 문자열을 조각으로 나눈다 (빈칸별 ';', 복수정답 '|'). */
function splitAnswers(raw) {
  return String(raw == null ? '' : raw)
    .split(/[|;]/)
    .map((x) => x.replace(/\s*\/\s*/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** 정답 후보들 중 하나와 실제로 맞는 보기를 고른다. 맞는 게 없으면 null. */
function pickByAnswers(choices, answers, wrong) {
  const open = (choices || []).filter((c) => !wrong || !wrong.has(c.index));
  const list = (answers || []).map((a) => N.mnorm(a).toLowerCase()).filter(Boolean);
  if (!open.length || !list.length) return null;

  // 1) 정확히 같은 보기부터. ('동사' 정답이 '동사원형' 보기에 걸리면 안 된다)
  //    사이트가 채점에 쓰는 글자(.option-answer)도 함께 본다 — 화면 글자와 다를 수 있다.
  for (const am of list) {
    const hit = open.find((c) => c.norm.toLowerCase() === am ||
      (c.ans && N.mnorm(c.ans).toLowerCase() === am));
    if (hit) return hit.index;
  }
  // 2) 정확히 같은 게 없을 때만 포함 관계로 (정답이 문장이고 보기가 그 일부인 경우 등)
  for (const am of list) {
    const hit = open.find((c) => {
      const cn = c.norm.toLowerCase();
      return cn && (cn.includes(am) || am.includes(cn));
    });
    if (hit) return hit.index;
  }
  return null;
}

/** 사이트 정답 데이터를 읽는다. { src, answers[] } 또는 null. */
async function readPageAnswer(d) {
  try {
    const v = await d.eval(READ_PAGE_ANSWER_JS);
    if (!v || !v.answer) return null;
    const answers = splitAnswers(v.answer);
    return answers.length ? { src: v.src, answers, raw: String(v.answer) } : null;
  } catch (e) {
    return null;
  }
}

/**
 * 페이지가 들고 있는 정답 데이터를 실행 중에 찾아낸다.
 *
 * 개념 톡은 정답을 화면에 그리지 않지만, 채점을 브라우저에서 하므로
 * 정답이 페이지의 전역 변수 어딘가에 들어 있다. 그래서 전역을 훑어
 * "지금 보기 중 하나와 정확히 같은 문자열"을 찾는다.
 * 빈칸이면 그 칸 번호(data-cnt)에 해당하는 자리부터 본다.
 *
 * 후보가 여러 개인데 값이 서로 다르면 확신할 수 없으므로 쓰지 않는다.
 */
const FIND_ANSWER_JS = (options, cnt) => `
var OPT = ${JSON.stringify(options)};
var CNT = ${Number(cnt)};
// 보기 텍스트에는 번호가 붙어 있다('4인칭'). 숫자·공백·문장부호를 떼고 비교한다.
var norm = function (s) {
    return String(s == null ? '' : s).replace(/[^A-Za-z\\uac00-\\ud7a3]/g, '');
};
var optSet = {};
for (var i = 0; i < OPT.length; i++) optSet[norm(OPT[i])] = true;

var hits = {}, namedHits = {}, nodes = 0, indexedOnly = false;
// 이름이 정답을 뜻하는 자리(answer, ans, correct …)에서 나온 값은 따로 모아 우선한다.
var ANSWER_KEY = /(^|[^a-z])(ans|answer|correct|right|solution)([^a-z]|$)|정답/i;

function look(v, depth, named) {
    if (nodes++ > 60000 || v == null || depth > 4) return;   // 정답이 중첩돼 있어도 닿도록
    if (typeof v === 'string') {
        var n = norm(v);
        if (n && optSet[n]) {
            hits[n] = (hits[n] || 0) + 1;
            if (named) namedHits[n] = (namedHits[n] || 0) + 1;
        }
        return;
    }
    if (typeof v !== 'object') return;
    if (Array.isArray(v)) {
        if (indexedOnly) {
            // 1차: 배열은 '이번 빈칸 번호' 자리만 본다 (정답 배열이면 그 자리가 답)
            if (CNT >= 0 && CNT < v.length) look(v[CNT], depth + 1, named);
            return;
        }
        for (var i = 0; i < v.length && i < 200; i++) look(v[i], depth + 1, named);
        return;
    }
    for (var k in v) {
        try { look(v[k], depth + 1, named || ANSWER_KEY.test(k)); } catch (e) {}
    }
}

var skip = { window: 1, self: 1, top: 1, parent: 1, document: 1, location: 1, frames: 1 };
function sweep() {
    // 브라우저 기본 전역이 수천 개라 그대로 훑으면 페이지 변수에 닿기 전에 예산이 끝난다.
    // 페이지가 나중에 만든 전역이 뒤쪽에 오므로 뒤에서부터 본다.
    var keys = Object.getOwnPropertyNames(window);
    for (var i = keys.length - 1; i >= 0; i--) {
        var k = keys[i];
        if (skip[k]) continue;
        var v;
        try { v = window[k]; } catch (e) { continue; }
        if (v == null || typeof v === 'function') continue;
        if (typeof v !== 'string' && typeof v !== 'object') continue;
        if (v === window || v.nodeType || v.window === v) continue;   // DOM/창 객체는 건너뛴다
        try { look(v, 0, ANSWER_KEY.test(k)); } catch (e) {}
    }
    return Object.keys(hits);
}

// 1차: 빈칸 번호 자리만 (정답 배열에 다른 문제의 답이 같이 들어 있어도 헷갈리지 않는다)
if (CNT >= 0) {
    indexedOnly = true;
    var indexed = sweep();
    if (indexed.length === 1) return indexed[0];
}

// 2차: 전체를 훑는다.
hits = {}; namedHits = {}; nodes = 0; indexedOnly = false;
var found = sweep();

// 이름이 '정답'인 자리에서 나온 값이 하나면 그것을 믿는다
// (보기 목록도 전역에 있는 경우가 많아, 그냥 세면 여러 개가 걸린다)
var named = Object.keys(namedHits);
if (named.length === 1) return named[0];

// 그 밖에는 보기와 맞는 값이 딱 하나일 때만 믿는다
return found.length === 1 ? found[0] : '';
`;

/** 페이지 전역에서 이번 문제의 정답 문자열을 찾는다. 못 찾거나 애매하면 null. */
async function findAnswerInPage(d, options, cnt) {
  try {
    const v = await d.eval(FIND_ANSWER_JS(options, cnt));
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch (e) {
    return null;
  }
}

/**
 * 개념 톡의 정답 고르기.
 *
 * 개념 톡은 정답 데이터를 화면에 두지 않지만, **바로 다음 설명 카드가 정답을 풀어서 말해 준다.**
 *   빈칸  "do(does,did)를 사용해서 ___를 강조" -> 다음 카드 "…해석해서 **동사**의 뜻을 강조해 줘요."
 *   객관식 "동사를 강조하는 문장은?"          -> 다음 카드 "'정말'을 붙여 '**싫어한다**'는 동사의 의미를…"
 * 그래서 보기마다 그 해설과 얼마나 겹치는지 점수를 매겨 가장 높은 것을 고른다.
 * 모든 보기에 공통으로 나오는 말(예: '정말')은 변별력이 없으므로 점수에서 뺀다.
 *
 * @returns {number|null} 고를 보기 번호. 단서가 없으면 null.
 */
function pickTalkAnswer(choices, upcoming) {
  if (!choices || !choices.length || !upcoming) return null;
  const hay = N.mnorm(upcoming);
  if (!hay) return null;

  const tokensOf = (text) =>
    (text || '').split(/[\s,./·"'()[\]?!~]+/)
      .map((w) => N.mnorm(w))
      .filter((w) => w.length >= 2);

  // 여러 보기에 공통으로 들어간 토큰은 변별력이 없다
  const seen = new Map();
  for (const c of choices) {
    for (const t of new Set(tokensOf(c.raw))) seen.set(t, (seen.get(t) || 0) + 1);
  }

  let best = null, bestScore = 0;
  for (const c of choices) {
    const whole = N.mnorm(c.raw);
    let score = 0;
    if (whole.length >= 2 && hay.includes(whole)) score += whole.length * 3;
    for (const t of new Set(tokensOf(c.raw))) {
      if ((seen.get(t) || 0) > 1) continue;      // 공통 토큰은 제외
      if (hay.includes(t)) score += t.length;
    }
    if (score > bestScore) { bestScore = score; best = c.index; }
  }
  return bestScore > 0 ? best : null;
}

/** 단어장에서 지문에 대한 정답을 찾는다. 없으면 null. */
function lookupAnswer(question, lookups) {
  if (!lookups || !question) return null;
  const qm = N.mnorm(question);
  if (!qm) return null;
  if (lookups.fwd.has(qm)) return lookups.fwd.get(qm);
  if (lookups.bwd.has(qm)) return lookups.bwd.get(qm);
  for (const [k, v] of lookups.fwd) {
    if (k.length >= 4 && qm.includes(k)) return v;
  }
  return null;
}

/**
 * 클래스 페이지에서 다음에 눌러야 할 단계를 고른다.
 * 잠기지 않고, 아직 시도하지 않은 것 중 STAGE_ORDER 순서가 가장 앞선 것.
 *
 * @param {{i:number,name:string,locked:boolean,open:boolean,stages:object[]}[]} units
 * @param {Set<string>} tried  이미 눌러 본 단계 key
 * @returns {{action:'open'|'stage'|'none', unit?:object, stage?:object}}
 */
function nextClassAction(units, tried, prefer) {
  for (const u of units || []) {
    if (u.locked) continue;
    const open = (u.stages || []).filter((s) => !s.locked && !tried.has(s.key));
    if (!open.length) {
      // 아직 펼치지 않은 유닛이면 펼쳐서 단계를 확인한다.
      if (!(u.stages || []).length && u.hasTitle && !tried.has('open_' + u.i)) {
        return { action: 'open', unit: u };
      }
      continue;
    }
    open.sort((a, b) => {
      // prefer 로 지정된 단계(예: 오답이 있었을 때의 '누적오답복습')를 맨 앞으로
      if (prefer) {
        const pa = a.title === prefer ? 0 : 1;
        const pb = b.title === prefer ? 0 : 1;
        if (pa !== pb) return pa - pb;
      }
      const ia = STAGE_ORDER.indexOf(a.title);
      const ib = STAGE_ORDER.indexOf(b.title);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return { action: 'stage', unit: u, stage: open[0] };
  }
  return { action: 'none' };
}

/**
 * 사이트 정답 문자열을 **빈칸 단위**로 나눈다.
 *
 * 규칙(gclass_test.js 의 arr_answer 를 보고 확인):
 *   - ';' 는 빈칸 구분    'do;love'                  -> ['do', 'love']
 *   - '|' 는 같은 칸의 다른 답  'that|which'         -> ['that']  (첫 번째만 쓴다)
 *   - 'It;was;a;puppy;that|which' -> 5칸
 *
 * (여러 답을 다 알아야 하는 보기 고르기에는 splitAnswers 를 그대로 쓴다)
 *
 * @param {string} raw 사이트 정답 문자열
 * @returns {string[]} 빈칸별로 써 넣을 값
 */
function splitBlanks(raw) {
  return String(raw == null ? '' : raw)
    .split(';')
    .map((part) => part.split('|')[0].replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * 빈칸(여러 개일 수 있음)에 넣을 값 목록.
 *
 * 정답을 알면 정답 문장을 빈칸 수에 맞춰 나눠 넣고,
 * 모르면 화면에 주어진 힌트 단어("the, tallest, student, …")를 순서대로 넣는다.
 * 둘 다 없으면 빈 배열(=풀 수 없음).
 *
 * @param {number} count 빈칸 수
 * @param {string|null} answer 정답 문장
 * @param {string} hint 힌트 문자열
 */
function fillValues(count, answer, hint) {
  if (count <= 0) return [];
  if (answer) {
    // 사이트 정답은 빈칸을 ';' 로 나누고, 한 칸에 여러 답이 되면 '|' 로 잇는다.
    //   'It;was;a;puppy;that|which'  -> 5칸: It / was / a / puppy / that
    // 이걸 안 풀면 빈칸 수와 안 맞아 한 칸도 못 채운다.
    const blanks = splitBlanks(answer);
    if (blanks.length === count) return blanks;
    const words = N.splitTargetWords(answer).filter((w) => w.trim());
    if (count === 1) return [blanks[0] || answer];
    if (words.length === count) return words;
    if (words.length > count) {
      // 빈칸보다 단어가 많으면 마지막 칸에 남은 단어를 몰아 넣는다
      const head = words.slice(0, count - 1);
      return head.concat([words.slice(count - 1).join(' ')]);
    }
  }
  if (hint) {
    const words = hint.split(/[,،]|\s{2,}/).map((w) => w.trim()).filter(Boolean);
    if (words.length >= count) return words.slice(0, count);
    if (words.length) return words.concat(Array(count - words.length).fill(''));
  }
  return [];
}

/** 페이지 전역 study_data 를 단어장(Map)으로 읽는다(있을 때만). */
async function pageDict(d) {
  const cards = await d.eval(
    'return (typeof study_data !== "undefined" && study_data) ? study_data : null;',
  );
  if (!Array.isArray(cards) || !cards.length) return null;
  const dict = new Map();
  for (const c of cards) {
    const front = N.stripTags(c && c.front).trim();
    const back = N.stripTags(c && c.back).trim();
    if (front && back) dict.set(back, front);
  }
  return dict.size ? dict : null;
}

async function clickTagged(d, attr, value, trusted) {
  const selector = `[${attr}="${value}"]`;
  if (!trusted) return d.clickFirstVisible(selector);
  return d.trustedClick(`
    var el = document.querySelector('${selector}');
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: window.innerWidth };
  `);
}

/** 입력형 문제의 index 번째 빈칸에 값을 써 넣는다 (값 설정 + input/change 이벤트). */
async function fillInput(d, index, value, attr) {
  return d.evalBool(`
    var el = document.querySelector('[${attr || 'data-cc-input'}="${index}"]');
    if (el) el.focus();
    if (!el) return false;
    var setter = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  `);
}

/**
 * 사이트 모달(#alertModal / #confirmModal)이 떠 있으면 알맞은 버튼을 눌러 준다.
 *
 * 사이트 스크립트(homer.js 의 showAlert/showConfirm)를 확인한 결과:
 *   - 두 모달 모두 `.btn-ok`(확인) 와 `.btn-cancel` 을 쓰고, **버튼 글자는 호출할 때 바뀐다**.
 *   - 특히 '누적오답복습'(gclass_main_std.js)은
 *       showConfirm('… 복습을 시작할까요?', …, btn_ok_text='학습 생략', btn_cancel_text='학습 시작')
 *     이라서, `.btn-ok` 를 그냥 누르면 **복습을 건너뛴다**.
 * 그래서 클래스 이름이 아니라 **버튼에 적힌 글자**로 고른다.
 *
 * 또 하나: 문제 화면(gclass_test.js)은 '답을 입력하지 않은 문항이 있습니다. 이대로 제출할까요?'
 * 처럼 **그대로 넘기면 그 문제를 틀리는 확인 창**을 띄운다(제출/취소, 제출/수정).
 * 이때는 '취소·수정'을 눌러 돌아가 답을 채워야 하므로 창의 문구를 보고 반대로 고른다.
 *
 * @returns {Promise<string|null>} 누른 버튼의 글자 (모달이 없으면 null)
 */
async function handleModal(d) {
  const label = await d.eval(`
    // 모달은 position:fixed 라 offsetParent 가 null 이다. 크기와 스타일로만 판단한다.
    function vis(el) {
        if (!el) return false;
        var r = el.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return false;
        var s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    }
    // 사이트는 #alertModal / #confirmModal 을 항상 DOM 에 두고 display:block 으로 둔다.
    // **열려 있는 창은 부트스트랩이 붙이는 in(또는 show) 클래스로만 구분된다.**
    // (이걸 안 보면 닫혀 있는 창의 '확인'을 계속 눌러 학습이 끝나 버린다)
    var modals = document.querySelectorAll('.modal.in, .modal.show');
    var modal = null;
    for (var i = 0; i < modals.length; i++) {
        var m = modals[i];
        if (!vis(m)) continue;
        var body = m.querySelector('.modal-content, .modal-dialog');
        if (!body || body.getBoundingClientRect().height < 40) continue;
        modal = m;
        break;
    }
    if (!modal) return null;

    var msg = ((modal.querySelector('.msg') || modal).textContent || '')
        .replace(/\\s+/g, ' ').trim();
    // 답을 비운 채 제출하거나, 오타·대소문자를 그대로 밀어 넣으면 그 문제는 틀린다.
    // (gclass_test.js: '답을 입력하지 않은 문항이 있습니다. 이대로 제출할까요?' [제출/취소] 등)
    // 이런 창은 '취소·수정'을 눌러 돌아가서 답을 채워야 한다.
    var goBack = /입력하지 않은|개만 선택|오타|대소문자|바꾸어 입력/.test(msg);

    var btns = modal.querySelectorAll('button, a, .btn');
    var best = null, bestScore = -1, bestText = '';
    for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (!vis(b)) continue;
        var t = ((b.textContent || '') + '').replace(/\\s+/g, ' ').trim();
        if (!t) continue;                    // 글자 없는 버튼(X 닫기)은 고르지 않는다
        var score = 0;
        if (goBack) {
            // 돌아가서 고쳐야 하는 창: 수정 > 취소. 제출·확인은 절대 누르지 않는다.
            if (/수정/.test(t)) score = 6;
            else if (/취소/.test(t)) score = 5;
            else continue;
        } else {
            // 학습을 건너뛰거나 닫는 버튼은 절대 고르지 않는다
            if (/생략|취소|나중|닫기|아니/.test(t)) continue;
            // 지금까지 푼 것을 날리는 버튼('처음부터 다시 학습' 등)도 절대 고르지 않는다
            if (/처음부터|초기화|리셋/.test(t)) continue;
            if (/학습 ?시작/.test(t)) score = 6;
            else if (/시작/.test(t)) score = 5;
            else if (/재시도/.test(t)) score = 5;        // 소리를 못 받았을 때의 '재시도'
            else if (/계속/.test(t)) score = 4;
            else if (/확인|예|네/.test(t)) score = 3;
            else if (b.className.indexOf('btn-ok') >= 0) score = 2;
            else continue;
        }
        if (score > bestScore) { bestScore = score; best = b; bestText = t; }
    }
    if (!best) return null;
    best.setAttribute('data-cc-modal-btn', '1');
    return bestText + '\u0001' + msg.slice(0, 40);
  `);
  if (!label) return null;
  await d.clickFirstVisible('[data-cc-modal-btn="1"]');
  return label;   // '누른 버튼\u0001창 문구'
}

/**
 * 개념 톡의 해설 음성을 **사이트가 스스로 끝내게** 만든다.
 *
 * 사이트 스크립트(grammar_talk.js) 확인 결과:
 *   - 재생이 시작되면 200ms 마다 재생 위치를 보다가, **끝 0.7초 전**이 되면
 *     스스로 audio.pause() 를 부르고, 그 pause 에서 다음 단계로 넘어간다(setAudioTimeUpdate).
 *   - 반대로 스피커(.talk-audio)를 누르면 audio.src 를 다시 넣고 load() 하므로
 *     **소리가 처음부터 다시 재생된다.** (그래서 누르면 안 된다)
 *
 * 기본은 **해설을 끝까지 들려주는 것**이다. 재생이 진행 중이면 손대지 않는다.
 * 손대는 경우는 둘뿐이다.
 *   - 소리가 아예 안 잡힌 화면(자동 재생 차단 등): 스피커를 카드마다 한 번만 누른다.
 *   - 재생 위치가 멈춰 버린 화면: 마지막 수단으로 '끝났다'고만 알려 다음으로 넘긴다.
 * CONFIG.playTalkAudio 를 끄면 예전처럼 재생 위치를 끝으로 보내 빨리 넘어간다.
 *
 * @returns {Promise<string>} 'playing' 재생 중(그대로 둔다) · 'seek' 끝으로 보냄
 *                            · 'start' 스피커를 눌러 걸어 줌 · 'force' 끝났다고 알림 · '' 아직
 */
async function skipTalkAudio(d, allowStart, allowForce, allowSeek) {
  const r = await d.eval(`
    var allowStart = ${allowStart ? 'true' : 'false'};
    var allowForce = ${allowForce ? 'true' : 'false'};
    var allowSeek = ${allowSeek ? 'true' : 'false'};
    var a = null;
    try { a = window.audio; } catch (e) {}
    if (a && isFinite(a.duration) && a.duration > 0) {
      if (allowSeek) {
        // '음성 끄기' 설정: 사이트가 '끝 0.7초 전'에 스스로 멈추므로 그 지점으로 보낸다
        var target = a.duration - 0.6;
        if (target < 0) target = 0;
        if (a.currentTime < target) a.currentTime = target;
        if (a.paused) { try { var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
        return 'seek';
      }
      // 해설을 끝까지 듣는다. 재생 위치가 늘고 있으면 아무것도 하지 않는다.
      var prev = -1;
      try { prev = window.__ccTalkAt; } catch (e) {}
      if (typeof prev !== 'number') prev = -1;
      var now = a.currentTime;
      try { window.__ccTalkAt = now; } catch (e) {}
      if (prev < 0 || now > prev + 0.2) return 'playing';
      // 소리가 멈춰 있다. 오래 기다린 뒤라면 **먼저** 마지막 수단으로 넘긴다.
      // (재생을 걸어 보는 쪽이 먼저 return 해 버리면 마지막 수단에 영영 닿지 못한다)
      if (allowForce) {
        try { a.pause(); a.dispatchEvent(new Event('pause')); return 'force'; } catch (e) {}
      }
      // 아직 여유가 있으면 이어서 재생만 걸어 본다. 자동 재생이 막힌 화면에서는
      // 이 play() 가 조용히 거부되지만, 'resume' 이라 대기 카운터는 계속 올라간다.
      // 단, **다 들은 소리에 play() 를 걸면 처음부터 다시 재생된다.** 사이트가 끝 0.7초
      // 전에 스스로 멈추므로, 끝 근처이거나 ended 면 절대 다시 걸지 않는다.
      var nearEnd = a.ended || now >= a.duration - 1.2;
      if (a.paused && !nearEnd) {
        try { var p2 = a.play(); if (p2 && p2.catch) p2.catch(function () {}); return 'resume'; } catch (e) {}
      }
      return '';
    }
    // 소리가 끝내 안 들어오는 화면(네트워크·자동재생 차단)에서는 마지막 수단으로
    // '끝났다'고만 알려 준다. 사이트의 pause 처리가 다음 단계로 넘겨 준다.
    if (allowForce && a) {
      try {
        a.pause();
        a.dispatchEvent(new Event('pause'));
        return 'force';
      } catch (e) {}
    }
    // 소리가 아직 잡히지 않았다 -> 이때만 스피커를 눌러 사이트가 오디오를 잡게 한다.
    // (누르면 처음부터 재생되므로 카드마다 딱 한 번만 한다)
    if (!allowStart) return '';
    var cards = document.querySelectorAll('.talk-card');
    var i = (typeof card_idx !== 'undefined' && card_idx >= 0) ? card_idx : 0;
    var card = cards[i];
    var btn = card ? card.querySelector('.talk-audio') : null;
    if (btn) { btn.click(); return 'start'; }
    return '';
  `);
  return r || '';
}

/**
 * 어순 배열(문장 만들기)을 **사이트 방식 그대로** 다룬다.
 *
 * 사이트 스크립트(gclass_test.js)를 확인한 결과:
 *   - 지금 푸는 카드는 전역 card_index 가 가리키는 .flip-card 다.
 *     (카드가 여러 장 겹쳐 있고, 지나간 카드의 낱말 버튼은 눌러도 아무 일이 없다)
 *   - 낱말 버튼(.btn-sentence-word)을 누르면 .scramble-body 에
 *     <span class="scramble-word">낱말</span> 이 순서대로 쌓이고, 누른 버튼에는 'clicked' 가 붙는다.
 *   - 그래서 **지금까지 놓은 낱말은 .scramble-body 의 span 들**이다(우리가 따로 셀 필요가 없다).
 *
 * @returns {Promise<{placed:string[], words:string[], clicked:boolean}|null>}
 */
async function scrambleStep(d, targetWords) {
  return d.eval(`
    function norm(s) {
      return String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]+/g, '');
    }
    var want = ${JSON.stringify(targetWords)};
    var cards = document.querySelectorAll('.flip-card');
    var card = null;
    if (typeof card_index !== 'undefined' && card_index >= 0 && cards[card_index]) {
      card = cards[card_index];
    } else {
      card = document.querySelector('.flip-card.showing');
    }
    if (!card) return null;

    // 사이트가 기록해 둔 '지금까지 놓은 낱말'
    var spans = card.querySelectorAll('.scramble-body .scramble-word, .scramble-body span');
    var placed = [];
    for (var i = 0; i < spans.length; i++) placed.push((spans[i].textContent || '').trim());

    if (placed.length >= want.length) return { placed: placed, words: want, clicked: false };

    var need = norm(want[placed.length]);
    var tiles = card.querySelectorAll('.test-sentence-words .btn-sentence-word, .btn-sentence-word');
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if ((' ' + t.className + ' ').indexOf(' clicked ') >= 0) continue;
      if (t.offsetParent === null) continue;
      var tn = norm(t.textContent);
      if (tn === need || (tn && need && (tn.indexOf(need) === 0 || need.indexOf(tn) === 0))) {
        t.click();
        return { placed: placed, words: want, clicked: true };
      }
    }
    return { placed: placed, words: want, clicked: false };
  `);
}

/**
 * 지금 푸는 카드 안에서 JS 를 돌린다 (문제 화면 공통).
 * 사이트는 카드를 여러 장 겹쳐 두고 전역 card_index 로 현재 카드를 가리킨다.
 */
function inCurrentCard(body) {
  return `
    var cards = document.querySelectorAll('.flip-card');
    var card = null;
    if (typeof card_index !== 'undefined' && card_index >= 0 && cards[card_index]) {
      card = cards[card_index];
    } else {
      card = document.querySelector('.flip-card.showing');
    }
    if (!card) return null;
    ${body}
  `;
}

/**
 * 구문 표시형(카드 type 8·11): 문장의 낱말에 '주어/동사/목적어' 같은 표시를 칠한다.
 *
 * 사이트 규칙(gclass_test.js):
 *   - 정답은 '이름:낱말번호,낱말번호;이름:번호' 형식이다 (예: '주어:0,1;동사:2').
 *     이름 순서는 화면의 .syntax-options 순서와 같고, 번호는 .paint-word 의 순번이다.
 *   - 먼저 .syntax-options 를 눌러 그 표시를 고르고(active), 그 다음 .paint-word 를 누르면
 *     그 낱말에 표시가 칠해진다.
 *   - type 11 은 '[[wr]]:쓴내용' 조각으로 주관식 입력도 함께 낸다.
 */
async function applySyntaxMarking(d, raw) {
  return d.eval(inCurrentCard(`
    function norm(s) { return String(s || '').replace(/\\s+/g, ' ').trim(); }
    var answer = ${JSON.stringify(String(raw))};
    var parts = answer.split(';');
    var opts = card.querySelectorAll('.syntax-options');
    var words = card.querySelectorAll('.paint-word');
    var done = 0, wrote = 0;
    for (var i = 0; i < parts.length; i++) {
      var at = parts[i].indexOf(':');
      if (at < 0) continue;
      var name = norm(parts[i].slice(0, at));
      var idxs = parts[i].slice(at + 1).trim();

      if (name === '[[wr]]') {                     // type 11 의 주관식 칸
        var input = card.querySelector('input[type="text"], .subject-input');
        if (input) {
          var setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, idxs);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          wrote++;
        }
        continue;
      }
      if (!idxs) continue;

      // 이름이 같은 표시를 고른다 (없으면 순서로)
      var opt = null;
      for (var j = 0; j < opts.length; j++) {
        if (norm(opts[j].textContent) === name) { opt = opts[j]; break; }
      }
      if (!opt) opt = opts[i] || null;
      if (!opt) continue;
      opt.click();

      var list = idxs.split(',');
      for (var k = 0; k < list.length; k++) {
        var w = words[parseInt(list[k], 10)];
        if (!w) continue;
        if ((' ' + w.className + ' ').indexOf(' option-except ') >= 0) continue;
        if (w.getAttribute('data-opidx') === opt.getAttribute('data-opidx')) continue;  // 이미 칠해짐
        w.click();
        done++;
      }
    }
    return { marked: done, wrote: wrote, options: opts.length, words: words.length };
  `));
}

/**
 * 드롭다운형(카드 type 5·9·10 에 섞여 나온다): `select.select-option` 을 정답으로 맞춘다.
 *
 * 사이트 규칙(gclass_test.js): 칸마다 고른 값을 ';' 로 이어 채점한다
 *   ($(el).find('.select-option option:selected').val())
 * 정답도 ';' 로 칸이, '|' 로 같은 칸의 다른 답이 나뉘어 있다.
 */
async function fillSelects(d, values) {
  return d.eval(inCurrentCard(`
    function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]+/g, ''); }
    var want = ${JSON.stringify(values)};
    var sels = card.querySelectorAll('select.select-option, .select-option select, select');
    var open = [];
    for (var i = 0; i < sels.length; i++) {
      if (sels[i].offsetParent === null && !sels[i].closest('.select2-container')) continue;
      open.push(sels[i]);
    }
    if (!open.length) return { filled: 0, total: 0 };
    var filled = 0;
    for (var i = 0; i < open.length && i < want.length; i++) {
      var sel = open[i];
      var target = norm(want[i]);
      for (var j = 0; j < sel.options.length; j++) {
        var o = sel.options[j];
        if (norm(o.value) === target || norm(o.textContent) === target) {
          sel.value = o.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          // select2 를 쓰는 화면이면 jQuery 쪽에도 알려 준다
          try { if (window.jQuery) window.jQuery(sel).trigger('change'); } catch (e) {}
          filled++;
          break;
        }
      }
    }
    return { filled: filled, total: open.length };
  `));
}

/**
 * 문단 순서형(카드 type 12): 문단 조각을 정답 순서대로 놓는다.
 *
 * 사이트 규칙(gclass_test.js): `.paragraph-row` 들의 data-idx 를 **화면에 놓인 순서대로**
 * ';' 로 이어 채점한다. 그래서 정답 순서대로 DOM 에 다시 꽂아 주면 그대로 정답이 된다.
 * (사이트는 드래그(sortable)로 순서를 바꾸지만, 채점은 순서만 본다)
 */
async function applyParagraphOrder(d, raw) {
  return d.eval(inCurrentCard(`
    var want = ${JSON.stringify(String(raw))}.split(';').map(function (x) { return x.trim(); });
    var rows = card.querySelectorAll('.paragraph-row');
    if (!rows.length) return { moved: 0, rows: 0 };
    var parent = rows[0].parentNode;
    var byIdx = {};
    for (var i = 0; i < rows.length; i++) byIdx[String(rows[i].getAttribute('data-idx'))] = rows[i];
    var moved = 0;
    for (var i = 0; i < want.length; i++) {
      var row = byIdx[want[i]];
      if (!row) continue;
      parent.appendChild(row);          // 정답 순서대로 뒤에 붙여 나간다
      moved++;
    }
    return { moved: moved, rows: rows.length };
  `));
}

async function grammar(d, answerDict, stop) {
  d.log('[문법] 시작');

  const dict = answerDict && answerDict.size ? answerDict : await pageDict(d);
  const lookups = buildLookups(dict);
  if (!lookups) d.log('[문법] 단어장이 없습니다 — 화면의 정답 정보와 채점 결과로 진행합니다.');
  else d.log(`[문법] 매칭 데이터 로드 완료 (${dict.size}개)`);

  const wrongByQid = new Map();
  const triesByQid = new Map();
  const lastPick = new Map();
  const triedStages = new Set();
  const modalRetry = new Map();   // 확인 창을 거친 단계를 다시 눌러 본 횟수
  let startPressed = 0;           // 단계 시작 화면에서 '시작' 을 누른 횟수
  let talkWait = 0;               // 개념 톡 해설 음성을 기다린 횟수
  let talkHeld = 0;               // 재생 중이어도 무조건 올라가는 절대 상한 카운터
  let talkAudioSkipped = null;    // 소리를 끝으로 넘긴 카드
  let talkAudioStarted = null;    // 재생을 걸어 준 카드 (한 번만 — 누르면 처음부터 다시 난다)
  let lastModal = null;           // 직전에 누른 안내 창의 글자
  let sameModal = 0;              // 같은 안내 창이 연달아 뜬 횟수
  const scrambleStuck = new Map();    // 어순 배열에서 낱말을 못 찾고 기다린 횟수
  const failedPairs = new Map();      // 문제별로 틀린 짝 조합
  const wrongByRow = new Map();       // 문제별 · 줄별로 틀린 보기
  let lastGroupPick = null;
  let lastQid = '';
  let idleStreak = 0;
  let ignoredClicks = 0;
  let talkStuck = 0;      // 개념 톡에서 Enter 가 먹히지 않은 연속 횟수
  let checkedScreen = '';  // 정답 데이터를 확인한 화면 (단계가 바뀌면 다시 확인한다)

  /**
   * 지금 진행 중인 단계의 학습 기록.
   * 사용자가 요청한 순서대로 남긴다:
   *   ① 단계 열기 -> ② 내용 읽기 -> ③ 로드 대기 -> ④ 확인 완료 ->
   *   ⑤ 1번부터 순서대로 풀기 -> ⑨ 오답노트 -> ⑫ 점수·오답 목록 -> ⑬ 오답 재학습
   */
  let stage = null;
  let wrongLastStage = false;   // 직전 단계에서 오답이 있었나 (누적오답복습 우선용)
  const answeredQ = new Set();  // 이미 번호를 매겨 로그한 문항
  const lastNote = new Map();   // 문항별로 마지막에 고른 답 (오답노트용)

  const newStage = (unitName, title) => ({
    unit: unitName, title, total: 0, cards: 0, withAnswer: 0,
    solved: 0, wrong: [], no: 0, done: false,
  });

  /** ⑫ 단계 결과(점수 + 오답 목록)를 로그에 남긴다. */
  const reportStage = () => {
    if (!stage || stage.done) return;
    stage.done = true;
    const total = stage.total || stage.solved;
    const wrongCount = stage.wrong.length;
    const right = Math.max(0, stage.solved - wrongCount);
    d.log(
      `[문법] ⑪ '${stage.unit}' — ${stage.title} 완료. ` +
        `⑫ 푼 문제 ${stage.solved}${total ? `/${total}` : ''}개, 정답 ${right}개, 오답 ${wrongCount}개`,
    );
    if (wrongCount) {
      d.log(`[문법] ⑨ 오답노트 (${wrongCount}개)`);
      stage.wrong.forEach((w, i) => {
        d.log(`[문법]   ${i + 1}) '${w.q.slice(0, 40)}' — 고른 답 '${w.picked}'` +
          (w.answer ? ` / 정답 '${w.answer}'` : ''));
      });
    }
    wrongLastStage = wrongCount > 0;
  };
  let fastScreen = false;  // 이 화면의 정답을 전부 읽어 뒀는가 (읽어 뒀으면 빠르게 진행)

  /** 한 동작 뒤에 기다릴 시간. 정답을 다 아는 화면은 짧게. */
  const pace = () => (fastScreen ? CONFIG.knownStepMs : CONFIG.stepDelayMs);
  const talkTries = new Map();   // 개념 톡 보기별 시도 횟수 (합성 -> 신뢰된 클릭 승격용)
  let classUrl = '';             // 문법 클래스 페이지 주소 (단계가 끝나면 여기로 돌아온다)

  /**
   * 한 단계(개념 톡·연습 문제 …)가 끝났을 때 클래스 페이지로 돌아간다.
   * 돌아가면 다음 단계를 이어서 진행한다. 돌아갈 곳이 없으면 false.
   */
  const backToClass = async (why) => {
    if (!classUrl) return false;
    reportStage();
    d.log(`[문법] ${why} -> 클래스 페이지로 돌아가 다음 단계를 진행합니다.`);
    await d.loadUrl(classUrl);
    await d.waitForLoad(15000);
    talkTries.clear();
    checkedScreen = '';
    fastScreen = false;
    await stop.await(CONFIG.stepDelayMs);
    return true;
  };

  try {
    while (!stop.isSet) {
      const state = await readState(d);
      if (!state) {
        if (await stop.await(400)) break;
        continue;
      }

      // ---------------------------------------------- 로그인 화면(세션 끊김)
      if (state.kind === 'login') {
        d.log('[문법] 클래스카드에서 로그아웃된 상태입니다 — 로그인한 뒤 다시 실행하세요.');
        stop.set();
        break;
      }

      // ---------------------------------------------- 안내 창이 떠 있으면 먼저 닫는다
      if (state.kind !== 'class') {
        const picked = await handleModal(d);
        if (picked) {
          // 같은 안내 창이 계속 다시 뜨면(눌러도 화면이 안 넘어가면) 무한히 누르지 않는다
          sameModal = picked === lastModal ? sameModal + 1 : 0;
          lastModal = picked;
          if (sameModal >= MODAL_REPEAT_LIMIT) {
            d.log(`[문법] 안내 창('${picked}')이 계속 다시 떠서 멈춥니다 — 화면에서 직접 확인해 주세요.`);
            stop.set();
            break;
          }
          d.log(`[문법] 안내 창("${(picked.split('\u0001')[1] || '').slice(0, 34)}")의 ` +
            `'${picked.split('\u0001')[0]}' 를 눌렀습니다.`);
          if (await stop.await(700)) break;
          continue;
        }
        lastModal = null;
        sameModal = 0;
      }

      // ---------------------------------------------- 단계 시작 화면
      // '시작' 을 눌러야 카드가 만들어진다. 안 누르면 풀 게 없다고 보고 끝내 버린다.
      if (state.kind === 'start') {
        if (startPressed >= START_PRESS_LIMIT) {
          d.log('[문법] 시작 화면에서 더 진행되지 않습니다 — 화면을 확인해 주세요.');
          stop.set();
          break;
        }
        startPressed++;
        d.log(`[문법] 단계 시작 화면입니다 — '${state.label || '시작'}' 을 누릅니다.`);
        if (!(await clickTagged(d, 'data-cc-startbtn', 1, false))) {
          await d.clickFirstVisible('.btn-quiz-start, .btn-opt-start');
        }
        if (await stop.await(CONFIG.stepDelayMs)) break;
        continue;
      }

      // ---------------------------------------------- 문법 클래스 페이지
      if (state.kind === 'class') {
        classUrl = (await d.currentUrl()) || classUrl;
        if (!CONFIG.driveClassPage) {
          d.log('[문법] 클래스 페이지입니다. 학습할 단계를 직접 열고 다시 실행하세요.');
          stop.set();
          break;
        }
        // ⑬ 직전 단계에서 틀린 게 있으면 '누적오답복습'(틀린 문제만 다시 학습)을 먼저 한다.
        const prefer = (CONFIG.reviewWrong && wrongLastStage) ? '누적오답복습' : null;
        const act = nextClassAction(state.units, triedStages, prefer);
        if (act.action === 'none') {
          d.log('[문법] 남은 단계가 없습니다 -> 종료');
          stop.set();
          break;
        }
        if (act.action === 'open') {
          triedStages.add('open_' + act.unit.i);
          await d.clickFirstVisible(`[data-cc-unit="${act.unit.i}"] .unit-title`);
        } else {
          triedStages.add(act.stage.key);
          checkedScreen = '';        // 새 단계 -> 정답 데이터를 다시 확인한다
          fastScreen = false;
          reportStage();
          stage = newStage(act.unit.name, act.stage.title);
          if (prefer && act.stage.title === prefer) {
            d.log('[문법] ⑬ 직전 단계에 오답이 있어 틀린 문제부터 다시 학습합니다.');
          }
          d.log(`[문법] ① '${act.unit.name}' — ${act.stage.title} 열기`);
          await clickTagged(d, 'data-cc-stage', act.stage.key, false);
          if (await stop.await(700)) break;
          // '누적오답복습'처럼 확인 창이 먼저 뜨는 단계가 있다.
          // (사이트가 '학습 생략'을 확인 버튼에 달아 두므로 글자를 보고 고른다)
          const picked = await handleModal(d);
          if (picked) {
            d.log(`[문법] 확인 창("${(picked.split('\u0001')[1] || '').slice(0, 34)}")의 ` +
              `'${picked.split('\u0001')[0]}' 를 눌렀습니다.`);
            // 확인 창을 거친 단계는 화면이 바뀐 뒤 다시 눌러야 열리는 경우가 있다
            const again = (modalRetry.get(act.stage.key) || 0) + 1;
            modalRetry.set(act.stage.key, again);
            if (again <= 2) triedStages.delete(act.stage.key);
          }
        }
        if (await stop.await(CONFIG.stepDelayMs)) break;
        continue;
      }

      // 새 화면(단계)에 들어왔으면 그 화면의 정답을 전부 한 번에 읽어 둔다.
      // 읽어 뒀으면(fastScreen) 문제마다 찍어 볼 필요가 없으므로 기다리지 않고 바로 푼다.
      if (state.kind === 'talk' || state.kind === 'quiz') {
        const screen = state.kind + '|' + (await d.currentUrl());
        const label = state.kind === 'talk' ? '개념 톡' : '문제 화면';

        // 이 화면의 정답을 전부 미리 읽어 둔다 (②③④).
        const preread = async () => {
          if (!stage) stage = newStage('', label);

          // ② 페이지의 문제·설명을 처음부터 끝까지 읽는다
          d.log(`[문법] ② ${label}의 내용을 처음부터 끝까지 읽는 중…`);

          // ③ 모든 항목이 로드될 때까지 대기 (두 번 재서 개수가 같아지면 로드 완료)
          let prev = null;
          let counts = null;
          for (let i = 0; i < 12; i++) {
            counts = await d.eval(CHECK_ANSWER_SOURCE_JS);
            const sig = counts ? `${counts.quiz}/${counts.talk}` : 'x';
            if (prev !== null && sig === prev && counts && (counts.quiz || counts.talk)) break;
            prev = sig;
            if (await stop.await(CONFIG.loadSettleMs)) break;
          }
          if (stop.isSet) return;

          stage.total = (counts && counts.quiz) || 0;
          stage.cards = (counts && counts.talk) || 0;
          stage.withAnswer = (counts && (counts.quizWith || counts.talkWith)) || 0;
          stage.no = 0;
          d.log(
            `[문법] ③ 로드 완료 — ` +
              (stage.total ? `문항 ${stage.total}개` : `카드 ${stage.cards}장`),
          );

          // ④ 학습 내용 확인 완료 (정답 데이터를 미리 다 읽어 둔다)
          fastScreen = stage.withAnswer > 0;
          if (fastScreen) {
            d.log(
              `[문법] ④ 학습 내용 확인 완료 — 정답 ${stage.withAnswer}개를 미리 읽었습니다. ` +
                '⑤ 1번 문제부터 순서대로 풉니다.',
            );
          } else {
            d.log('[문법] ④ 학습 내용 확인 완료 — 정답 데이터가 없어 화면 정보로 풉니다.');
          }
        };

        if (screen !== checkedScreen) {
          checkedScreen = screen;
          await preread();
          if (stop.isSet) break;
        } else if (!fastScreen) {
          // 새 단계는 '시작' 화면으로 열려서, 그때는 문제가 아직 만들어지지 않았다.
          // (그 상태로 읽으면 '카드 0장'이 되고, 다시 안 읽으면 정답 없이 풀게 된다)
          // 그래서 정답표를 아직 못 읽었으면 **내용이 생겼는지 계속 확인해서 다시 읽는다.**
          const now = await d.eval(CHECK_ANSWER_SOURCE_JS);
          const nowSize = now ? (now.quiz || 0) + (now.talk || 0) : 0;
          const hadSize = stage ? (stage.total || 0) + (stage.cards || 0) : 0;
          if (nowSize > hadSize) {
            d.log('[문법] 문제가 이제 나타났습니다 — 정답 데이터를 다시 읽습니다.');
            await preread();
            if (stop.isSet) break;
          }
        }
      }

      // ---------------------------------------------- 개념 톡 (설명 카드)
      if (state.kind === 'talk') {
        // 개념 톡: 사이트 스크립트대로 '지금 카드(card_idx)' 에서만 조작한다.
        //   type 2 객관식 / type 6 어순 배열 / 빈칸(보기 고르기·직접 입력) / 그 외는 넘기기
        const ans = state.answers || [];
        const talkKey = state.qid;
        const tried = wrongByQid.get(talkKey) || new Set();

        // 1) 객관식 — 정답 글자와 같은 보기를 고른다 (사이트는 .option-txt 로 비교한다)
        if (state.options.length && !state.done) {
          let pick = pickByAnswers(state.options, ans, tried);
          if (pick === null) {
            // 정답을 모르면 다음 카드 해설 -> 전역 훑기 -> 안 해 본 보기 순으로 고른다
            const open = state.options.filter((c) => !tried.has(c.index));
            pick = pickTalkAnswer(open, state.upcoming);
            if (pick === null) {
              const scanned = await findAnswerInPage(d, state.options.map((c) => c.raw), -1);
              const hit = scanned
                ? open.find((c) => N.mnorm(c.raw) === N.mnorm(scanned))
                : null;
              if (hit) pick = hit.index;
            }
            if (pick === null) pick = open.length ? open[0].index : null;
            if (pick !== null && ans.length) {
              d.log(`[문법] (개념 톡) 정답과 같은 보기를 못 찾아 ${pick + 1}번을 고릅니다.`);
            }
          }
          if (pick === null) {
            if (await backToClass('개념 톡 보기를 모두 눌러 봤습니다')) continue;
            d.log('[문법] 개념 톡 보기를 모두 눌러도 넘어가지 않습니다 -> 종료');
            stop.set();
            break;
          }

          const label = (state.options.find((c) => c.index === pick) || {}).raw || '';
          if (stage && !answeredQ.has(talkKey)) {
            answeredQ.add(talkKey);
            stage.no++;
            stage.solved++;
            d.log(
              `[문법] ⑤ ${stage.no}번 (개념 톡 객관식) -> ${pick + 1}번 '${label.slice(0, 20)}'` +
                `${ans.length ? ' (사이트 정답)' : ' (추정)'}`,
            );
          }
          await clickTagged(d, 'data-cc-opt', pick, talkStuck >= 1);
          if (await stop.await(pace())) break;

          const after = await readState(d);
          if (after && after.kind === 'talk' && after.sig === state.sig) {
            talkStuck++;
            if (!wrongByQid.has(talkKey)) wrongByQid.set(talkKey, new Set());
            wrongByQid.get(talkKey).add(pick);   // 이 보기는 아니었다
            if (talkStuck === 1) d.log('[문법] 개념 톡 클릭이 한 번 무시됨 -> 신뢰된 클릭으로 재시도');
          } else {
            talkStuck = 0;
            if (after && after.kind === 'talk' && after.wrong && stage &&
                !stage.wrong.some((w) => w.qid === talkKey)) {
              stage.wrong.push({ qid: talkKey, q: '개념 톡 객관식', picked: label, answer: ans.join(' / ') });
              d.log(`[문법] ⑨ 오답 -> 오답노트에 저장 (${stage.wrong.length}번째)`);
            }
          }
          continue;
        }

        // 2) 어순 배열 — 정답 순서대로 낱말을 누른다
        if (state.orders.length && state.orders.some((o) => !o.picked)) {
          const want = ans.length ? ans : [];
          const picked = state.orders.filter((o) => o.picked).length;
          let target = null;
          if (want[picked]) {
            const w = N.mnorm(want[picked]).toLowerCase();
            const hit = state.orders.find((o) => !o.picked && o.norm.toLowerCase() === w);
            if (hit) target = hit.index;
          }
          if (target === null) {
            const open = state.orders.filter((o) => !o.picked);
            target = open.length ? open[0].index : null;
          }
          if (target === null) { if (await stop.await(400)) break; continue; }
          if (stage && !answeredQ.has(talkKey)) {
            answeredQ.add(talkKey);
            stage.no++;
            stage.solved++;
            d.log(`[문법] ⑤ ${stage.no}번 (개념 톡 어순 배열) — 정답 순서대로 놓습니다.`);
          }
          await clickTagged(d, 'data-cc-order', target, talkStuck >= 1);
          if (await stop.await(400)) break;
          const after = await readState(d);
          if (after && after.kind === 'talk' && after.sig === state.sig) talkStuck++;
          else talkStuck = 0;
          continue;
        }

        // 3) 빈칸 — 보기가 있으면 고르고, 없으면 직접 써 넣는다
        const emptyBlank = (state.blanks || []).filter((b) => !b.filled);
        if (emptyBlank.length) {
          const cur = emptyBlank.find((b) => b.current) || emptyBlank[0];
          const want = (cur.cnt >= 0 ? ans[cur.cnt] : null) || ans[cur.i] || ans[0] || '';

          if (state.picks.length) {
            const pkey = talkKey + '_p' + cur.i;
            const ptried = wrongByQid.get(pkey) || new Set();
            let pick = want ? pickByAnswers(state.picks, [want], ptried) : null;
            if (pick === null) {
              // 정답을 모르면 다음 카드 해설 -> 전역 훑기 -> 안 해 본 보기 순으로 고른다
              const guess = pickTalkAnswer(
                state.picks.filter((c) => !ptried.has(c.index)), state.upcoming,
              );
              if (guess !== null) {
                pick = guess;
              } else {
                const scanned = await findAnswerInPage(
                  d, state.picks.map((c) => c.raw), cur.cnt >= 0 ? cur.cnt : -1,
                );
                const hit = scanned
                  ? state.picks.find((c) => N.mnorm(c.raw) === N.mnorm(scanned) && !ptried.has(c.index))
                  : null;
                if (hit) pick = hit.index;
              }
            }
            if (pick === null) {
              const open = state.picks.filter((c) => !ptried.has(c.index));
              pick = open.length ? open[0].index : null;
            }
            if (pick === null) {
              if (await backToClass('개념 톡 빈칸 보기를 모두 눌러 봤습니다')) continue;
              d.log('[문법] 개념 톡 빈칸 보기를 모두 눌러도 넘어가지 않습니다 -> 종료');
              stop.set();
              break;
            }
            if (stage && !answeredQ.has(talkKey + '_' + cur.i)) {
              answeredQ.add(talkKey + '_' + cur.i);
              stage.no++;
              stage.solved++;
              const lab = (state.picks.find((c) => c.index === pick) || {}).raw || '';
              d.log(
                `[문법] ⑤ ${stage.no}번 (개념 톡 빈칸) -> '${lab.slice(0, 20)}'` +
                  `${want ? ' (사이트 정답)' : ' (추정)'}`,
              );
            }
            await clickTagged(d, 'data-cc-sel', pick, talkStuck >= 1);
            if (await stop.await(pace())) break;
            const after = await readState(d);
            if (after && after.kind === 'talk' && after.sig === state.sig) {
              talkStuck++;
              if (!wrongByQid.has(pkey)) wrongByQid.set(pkey, new Set());
              wrongByQid.get(pkey).add(pick);   // 이 보기는 아니었다
            } else {
              talkStuck = 0;
            }
            continue;
          }

          // 직접 입력 (사이트가 값 비교만 하므로 값 설정으로 충분하다)
          const written = (await d.eval(TALK_FILL_JS)) || [];
          for (const w of written) {
            d.log(`[문법] ⑤ (개념 톡 입력) ${w.i + 1}번 칸 -> '${w.value}' (사이트 정답)`);
          }
          if (written.length) {
            if (stage) { stage.no++; stage.solved++; }
            if (!(await clickTagged(d, 'data-cc-next', 1, false))) await d.pressEnter();
            if (await stop.await(pace())) break;
            const after = await readState(d);
            if (after && after.kind === 'talk' && after.sig === state.sig) talkStuck++;
            else talkStuck = 0;
            continue;
          }
          d.log('[문법] 개념 톡 빈칸의 정답을 찾지 못했습니다 — 그대로 넘깁니다.');
        }

        // 3-b) 소리(해설 음성)가 아직 재생 중이면 사이트가 아무 입력도 받지 않는다.
        //      이때 누르면 헛손질이므로 끝날 때까지 조용히 기다린다.
        if (state.waiting && !(state.options || []).length &&
            !(state.orders || []).length && !(state.blanks || []).length) {
          talkWait++;
          talkHeld++;                 // 재생 중이어도 무조건 올라가는 절대 상한용 카운터
          if (talkWait === 1) d.log('[문법] 개념 톡 해설 음성이 끝나기를 기다리는 중…');
          // 잠깐 기다려도 안 끝나면(자동 재생이 막힌 화면 등) 사이트 방식대로 소리를 끝낸다
          if (talkWait >= TALK_AUDIO_SKIP_AFTER) {
            // 해설이 재생 중이면 손대지 않는다('playing'). 소리가 멈춰 있을 때만
            // 이어서 걸어 주고, 그래도 안 움직이면 마지막 수단으로 넘긴다.
            // '재생 걸기'는 소리를 처음부터 다시 틀기 때문에 카드마다 한 번만 한다.
            const how = await skipTalkAudio(
              d,
              talkAudioStarted !== state.sig,
              talkWait >= TALK_AUDIO_FORCE_AFTER,          // 끝내 안 들어오면 마지막 수단
              !CONFIG.playTalkAudio,                       // 음성 끄기 설정일 때만 끝으로 보낸다
            );
            if (how === 'playing') {
              // 소리가 실제로 자라는 중일 때만 마지막 수단을 미룬다.
              // ('resume' 은 재생을 걸어만 본 것이라 미루지 않는다 — 안 걸리면 넘어가야 한다)
              talkWait = TALK_AUDIO_SKIP_AFTER;
            } else if (how === 'seek' && talkAudioSkipped !== state.sig) {
              talkAudioSkipped = state.sig;
              d.log('[문법] 해설 음성을 끝으로 넘겨 다음으로 진행합니다.');
            } else if (how === 'start') {
              talkAudioStarted = state.sig;
              d.log('[문법] 해설 음성이 재생되지 않아 한 번 걸어 줍니다.');
            } else if (how === 'force' && talkAudioSkipped !== state.sig) {
              talkAudioSkipped = state.sig;
              d.log('[문법] 소리를 받지 못해 해설을 건너뜁니다.');
            }
          }
          if (talkHeld > TALK_WAIT_LIMIT || talkWait > TALK_WAIT_LIMIT) {
            d.log('[문법] 해설 음성이 끝나지 않습니다 — 소리가 나오는지 확인해 주세요.');
            talkWait = 0;
            talkHeld = 0;
            talkStuck++;
          }
          if (await stop.await(700)) break;
          continue;
        }
        talkWait = 0;
        talkHeld = 0;

        // 4) 고를 것이 없으면 '계속하기'(next-btn) 또는 Enter 로 다음 카드
        if (state.hasNext) {
          if (!(await clickTagged(d, 'data-cc-next', 1, talkStuck >= 2))) await d.pressEnter();
        } else {
          await d.pressEnter();
        }
        if (await stop.await(pace())) break;

        const after = await readState(d);
        if (after && after.kind === 'talk' && after.sig === state.sig) {
          talkStuck++;
          if (talkStuck === 3) {
            // Enter 가 안 먹는 화면일 수 있어 화면을 한 번 눌러 포커스를 준다
            await d.trustedClick(`
              return { x: window.innerWidth / 2, y: window.innerHeight / 2, w: window.innerWidth };
            `);
            await d.pressEnter();
          }
          if (talkStuck >= CONFIG.idleGiveUp) {
            if (await backToClass('개념 톡이 끝났거나 더 넘어가지 않습니다')) continue;
            d.log('[문법] 개념 톡이 더 넘어가지 않습니다 -> 종료');
            stop.set();
            break;
          }
        } else {
          talkStuck = 0;
          if (after && after.kind === 'talk' && CONFIG.debug) {
            d.log(`[문법] (개념 톡) ${after.idx + 1}/${after.cards}장`);
          }
        }
        continue;
      }

      if (state.kind === 'end') {
        if (await backToClass('한 단계를 마쳤습니다')) continue;
        d.log('[문법] 종료 화면 감지 -> 끝');
        stop.set();
        break;
      }

      // ---------------------------------------------- 문제 화면이 아닌 경우
      if (state.opening) {
        // 인라인 보기 상자를 막 열었다 — 다음 바퀴에서 보기를 읽는다
        if (await stop.await(400)) break;
        continue;
      }

      const hasWork = state.choices.length || state.hasInput ||
        (state.rows || []).length || (state.left || []).length || (state.tiles || []).length ||
        // 구문 표시 · 문단 순서 · 드롭다운도 '풀 거리'다 (없다고 보면 그냥 넘겨 버린다)
        state.paints || state.paragraphs || state.selects;
      if (state.kind === 'idle' || !hasWork) {
        if ((state.next || state.kind === 'idle') && (await d.evalBool(CLICK_NEXT_JS))) {
          idleStreak = 0;
        } else {
          idleStreak++;
          if (idleStreak === 15) {
            // 처음 보는 유형이면 무엇이 있었는지 남긴다 (다음에 그 유형을 붙일 수 있게)
            const shape = await d.eval(`
              var cards = document.querySelectorAll('.flip-card');
              var card = (typeof card_index !== 'undefined' && cards[card_index])
                ? cards[card_index] : document.querySelector('.flip-card.showing');
              if (!card) return null;
              function n(sel) { return card.querySelectorAll(sel).length; }
              return {
                type: card.getAttribute('data-type') || '',
                option: n('.option-item'), input: n('input[type=\\'text\\'], textarea'),
                select: n('select'), paint: n('.paint-word'), para: n('.paragraph-row'),
                word: n('.btn-sentence-word'), row: n('.grouping-item'), match: n('.match-item')
              };
            `);
            d.log(
              '[문법] 문제도 버튼도 찾지 못했습니다. ' +
              (shape
                ? `현재 화면 구조: 카드종류=${shape.type} 보기=${shape.option} 입력=${shape.input} ` +
                  `드롭다운=${shape.select} 구문표시=${shape.paint} 문단=${shape.para} ` +
                  `낱말=${shape.word} 분류=${shape.row} 짝=${shape.match}`
                : '화면을 읽지 못했습니다.'),
            );
          }
          if (idleStreak >= CONFIG.idleGiveUp) {
            if (await backToClass('이 단계에서 더 풀 문제가 없습니다')) { idleStreak = 0; continue; }
            d.log('[문법] 더 이상 풀 문제가 없습니다 -> 종료');
            stop.set();
            break;
          }
        }
        if (await stop.await(400)) break;
        continue;
      }
      idleStreak = 0;

      // 분류형: 방금 고른 줄이 오답으로 표시되면 그 보기를 기억한다.
      if (lastGroupPick && state.type === 'group') {
        // 맞은 줄까지 오답으로 기억하면 다시 풀 때 정답을 피하게 된다. 틀린 줄만 기억한다.
        const row = (state.rows || []).find((r) => r.index === lastGroupPick.row);
        if (row && row.bad) {
          const map = wrongByRow.get(lastGroupPick.qid);
          if (map) {
            if (!map.has(row.index)) map.set(row.index, new Set());
            map.get(row.index).add(lastGroupPick.option);
          }
        }
        lastGroupPick = null;
      }

      // ⑧ 채점 결과 확인 -> ⑨ 틀린 문제는 오답노트에 저장
      if (state.feedback === 'wrong' && lastQid && lastPick.has(lastQid)) {
        const picked = lastPick.get(lastQid);
        if (!wrongByQid.has(lastQid)) wrongByQid.set(lastQid, new Set());
        wrongByQid.get(lastQid).add(picked);
        if (stage && !stage.wrong.some((w) => w.qid === lastQid)) {
          const note = lastNote.get(lastQid) || {};
          stage.wrong.push({
            qid: lastQid,
            q: note.q || state.question || '',
            picked: note.picked || `보기 ${picked + 1}`,
            answer: note.answer || state.answer || '',
          });
          d.log(`[문법] ⑨ 오답 -> 오답노트에 저장 (${stage.wrong.length}번째)`);
        }
      }
      // 채점이 끝난 문항이면 다음으로 넘긴다.
      // (분류·짝맞추기는 줄/칸 단위로 채점되므로 문항 단위 채점만 본다)
      if (state.feedback !== 'none' && state.type !== 'group' && state.type !== 'match') {
        await d.evalBool(CLICK_NEXT_JS);
        if (await stop.await(pace())) break;
        continue;
      }

      const qid = state.qid;
      const tries = triesByQid.get(qid) || 0;
      // 어순 배열·분류·짝맞추기는 한 문제에서 낱말/칸 수만큼 눌러야 끝난다.
      // 이때도 '시도 횟수'로 세면 문장을 다 못 만들고 넘어가 버린다 -> 칸 수만큼 여유를 준다.
      const steps = (state.tiles || []).length + (state.rows || []).length +
        (state.left || []).length + (state.inputs || []).length;
      const tryLimit = CONFIG.maxTryPerQuestion + steps;
      if (tries >= tryLimit) {
        await d.evalBool(CLICK_NEXT_JS);
        triesByQid.set(qid, 0);
        wrongByQid.delete(qid);
        if (await stop.await(400)) break;
        continue;
      }
      triesByQid.set(qid, tries + 1);

      // 정답: 사이트가 채점에 쓰는 정답(arr_answer) > 화면의 정답 > 단어장 > 전역 훑기
      let answer = '';
      let answerFrom = '';
      let answerList = [];

      const page = await readPageAnswer(d);
      let rawAnswer = '';           // 사이트 정답 원문 ('It;was;a;puppy;that|which')
      if (page) {
        answerList = page.answers;
        answer = page.answers[0];
        rawAnswer = page.raw;
        answerFrom = `사이트 정답(${page.src})`;
      }
      if (!answer) {
        answer = state.answer || lookupAnswer(state.question, lookups) || '';
        answerFrom = state.answer ? '화면의 정답' : (answer ? '단어장' : '');
        if (answer) answerList = [answer];
      }
      if (!answer && state.choices.length) {
        const scanned = await findAnswerInPage(d, state.choices.map((c) => c.raw), -1);
        if (scanned) { answer = scanned; answerList = [scanned]; answerFrom = '페이지 정답 데이터'; }
      }

      // ⑤ 보기형이 아닌 문제도 번호를 매겨 진행 상황을 남긴다
      if (stage && !state.choices.length && !answeredQ.has(qid) &&
          (state.hasInput || (state.tiles || []).length || (state.rows || []).length ||
           (state.left || []).length)) {
        answeredQ.add(qid);
        stage.no++;
        stage.solved++;
        const kind = state.hasInput ? '입력형'
          : (state.tiles || []).length ? '어순 배열'
          : (state.rows || []).length ? '분류형' : '짝맞추기';
        d.log(
          `[문법] ⑤ ${stage.no}${stage.total ? `/${stage.total}` : ''}번 문제 (${kind}) ` +
            `'${state.question.slice(0, 30)}'${answer ? ` (${answerFrom})` : ' (추정)'}`,
        );
      }

      // ---------------------------------------------- 구문 표시형 (카드 type 8·11)
      // 문장의 낱말에 '주어/동사/목적어' 같은 표시를 칠하는 문제.
      if ((state.cardType === '8' || state.cardType === '11') && rawAnswer) {
        const r = await applySyntaxMarking(d, rawAnswer);
        if (stage && !answeredQ.has(qid)) {
          answeredQ.add(qid);
          stage.no++;
          stage.solved++;
          d.log(
            `[문법] ⑤ ${stage.no}${stage.total ? `/${stage.total}` : ''}번 문제 (구문 표시) ` +
              `'${state.question.slice(0, 30)}' — 낱말 ${(r && r.marked) || 0}개 표시 (${answerFrom})`,
          );
        }
        if (await stop.await(pace())) break;
        await d.evalBool(CLICK_NEXT_JS);          // 채점하기
        if (await stop.await(pace())) break;
        continue;
      }

      // ---------------------------------------------- 문단 순서형 (카드 type 12)
      if (state.cardType === '12' && rawAnswer) {
        const r = await applyParagraphOrder(d, rawAnswer);
        if (stage && !answeredQ.has(qid)) {
          answeredQ.add(qid);
          stage.no++;
          stage.solved++;
          d.log(
            `[문법] ⑤ ${stage.no}${stage.total ? `/${stage.total}` : ''}번 문제 (문단 순서) ` +
              `— ${(r && r.moved) || 0}조각을 정답 순서로 놓았습니다 (${answerFrom})`,
          );
        }
        if (await stop.await(pace())) break;
        await d.evalBool(CLICK_NEXT_JS);
        if (await stop.await(pace())) break;
        continue;
      }

      // ---------------------------------------------- 드롭다운형 (select.select-option)
      // 빈칸이 드롭다운으로 나오는 화면. 보기·입력형보다 먼저 확인한다.
      if (rawAnswer && !state.choices.length) {
        const picks = splitBlanks(rawAnswer);
        if (picks.length) {
          const r = await fillSelects(d, picks);
          if (r && r.filled) {
            // 드롭다운과 빈칸이 같이 있는 화면(카드 type 9)은 빈칸까지 채운 뒤에 채점한다.
            // 먼저 채점하면 '답을 입력하지 않은 문항' 창이 떠서 한 바퀴를 버린다.
            if (state.hasInput && !state.filled) {
              if (await stop.await(300)) break;
              continue;
            }
            if (stage && !answeredQ.has(qid)) {
              answeredQ.add(qid);
              stage.no++;
              stage.solved++;
              d.log(
                `[문법] ⑤ ${stage.no}${stage.total ? `/${stage.total}` : ''}번 문제 (드롭다운) ` +
                  `— ${r.filled}/${r.total}칸을 골랐습니다 (${answerFrom})`,
              );
            }
            if (await stop.await(pace())) break;
            await d.evalBool(CLICK_NEXT_JS);
            if (await stop.await(pace())) break;
            continue;
          }
        }
      }

      // ---------------------------------------------- 입력형
      if (!state.choices.length && state.hasInput) {
        if (state.filled) {
          await d.evalBool(CLICK_NEXT_JS);          // 이미 다 써 넣었다 -> 채점하기
          if (await stop.await(pace())) break;
          continue;
        }
        // 빈칸 수에 맞추는 순서: 빈칸 단위로 쪼갠 사이트 정답 > 정답 조각 > 추정
        // (사이트 정답 원문을 써야 한다. answer 는 첫 조각뿐이라 빈칸 수를 못 맞춘다)
        const blanks = splitBlanks(rawAnswer || answer);
        const values = (blanks.length === state.inputs.length) ? blanks
          : (answerList.length === state.inputs.length) ? answerList
            : fillValues(state.inputs.length, rawAnswer || answer, state.hint);
        if (!values.length) {
          d.log(`[문법] 답을 알 수 없는 입력형 문제(빈칸 ${state.inputs.length}칸) — 비운 채 넘어갑니다.`);
          await d.evalBool(CLICK_NEXT_JS);
          if (await stop.await(pace())) break;
          continue;
        }
        if (CONFIG.debug) {
          d.log(`[문법] (입력) 빈칸 ${values.length}칸 -> ${values.join(' / ').slice(0, 60)}`);
        }
        for (let i = 0; i < values.length; i++) {
          await fillInput(d, i, values[i]);
          if (await stop.await(120)) break;
        }
        if (stop.isSet) break;
        // 사이트는 빈칸이 하나라도 비면 '이대로 제출할까요?' 를 띄우고 그 문제를 틀린다.
        // 값이 정말 들어갔는지 읽어 보고, 안 들어간 칸이 있으면 구조를 알려 준다.
        const written = await d.eval(`
          var card = document.querySelector('.flip-card.showing') || document;
          var els = card.querySelectorAll('[data-cc-input]');
          var empty = 0, total = 0, cls = '';
          for (var i = 0; i < els.length; i++) {
            if (els[i].offsetParent === null) continue;
            total++;
            if (!String(els[i].value || '').trim()) { empty++; cls = els[i].className; }
          }
          return { total: total, empty: empty, cls: cls };
        `);
        if (written && written.empty) {
          d.log(`[문법] 빈칸 ${written.empty}/${written.total}칸이 비어 있습니다 ` +
            `(입력창 구조: ${written.cls || '?'}) — 그대로 채점합니다.`);
        }
        await d.evalBool(CLICK_NEXT_JS);
        if (await stop.await(pace())) break;
        continue;
      }

      // ---------------------------------------------- 어순 배열
      if (state.type === 'scramble') {
        // 사이트 정답은 낱말을 ';' 로 이어 준다 ('The;children;do;like;…').
        const words = splitBlanks(rawAnswer).length > 1
          ? splitBlanks(rawAnswer)
          : N.splitTargetWords(rawAnswer || answer || '').filter((w) => w.trim());
        const step = words.length ? await scrambleStep(d, words) : null;
        if (!step) {
          if (await stop.await(400)) break;
          continue;
        }
        if (step.clicked) {
          if (CONFIG.debug) {
            d.log(`[문법] (어순) ${step.placed.length + 1}번째 -> '${words[step.placed.length]}'`);
          }
          if (await stop.await(400)) break;
          continue;
        }
        if (step.placed.length < words.length) {
          // 아직 덜 놓였는데 누를 낱말을 못 찾았다 (카드가 막 바뀌는 중일 수 있다)
          scrambleStuck.set(qid, (scrambleStuck.get(qid) || 0) + 1);
          if ((scrambleStuck.get(qid) || 0) < 8) {
            if (await stop.await(500)) break;
            continue;
          }
          d.log(`[문법] 어순 배열에서 '${words[step.placed.length]}' 를 찾지 못했습니다 — 그대로 채점합니다.`);
        }
        scrambleStuck.delete(qid);
        await d.evalBool(CLICK_NEXT_JS);       // 문장 완성 -> 채점하기
        if (await stop.await(pace())) break;
        continue;
      }

      // ---------------------------------------------- 분류형 (줄마다 라디오)
      if (state.type === 'group') {
        if (!wrongByRow.has(qid)) wrongByRow.set(qid, new Map());
        const pick = nextGroupPick(state.rows, answer, wrongByRow.get(qid));
        if (!pick) {
          await d.evalBool(CLICK_NEXT_JS);
          if (await stop.await(pace())) break;
          continue;
        }
        if (CONFIG.debug) d.log(`[문법] (분류) ${pick.row + 1}번째 줄 -> 보기 ${pick.option + 1}`);
        lastGroupPick = { qid, row: pick.row, option: pick.option };
        await clickTagged(d, 'data-cc-rowopt', `${pick.row}_${pick.option}`,
          ignoredClicks >= TRUSTED_AFTER);
        if (await stop.await(400)) break;
        continue;
      }

      // ---------------------------------------------- 짝맞추기
      if (state.type === 'match') {
        if (!failedPairs.has(qid)) failedPairs.set(qid, new Set());
        const pair = nextPairAttempt(state.left, state.right, failedPairs.get(qid));
        if (!pair) {
          failedPairs.delete(qid);
          await d.evalBool(CLICK_NEXT_JS);
          if (await stop.await(pace())) break;
          continue;
        }
        await clickTagged(d, 'data-cc-left', pair.left, ignoredClicks >= TRUSTED_AFTER);
        if (await stop.await(250)) break;
        await clickTagged(d, 'data-cc-right', pair.right, ignoredClicks >= TRUSTED_AFTER);
        if (await stop.await(pace())) break;

        // 짝이 맞으면 두 칸 모두 .end 가 된다. 아니면 실패로 기억한다.
        const afterPair = await readState(d);
        const ok = afterPair && afterPair.kind === 'quiz' &&
          (afterPair.left || []).some((c) => c.index === pair.left && c.done);
        if (!ok) {
          failedPairs.get(qid).add(`${pair.left}_${pair.right}`);
          if (CONFIG.debug) d.log(`[문법] (짝맞추기) ${pair.left}-${pair.right} 실패로 기억`);
        } else {
          if (CONFIG.debug) d.log(`[문법] (짝맞추기) ${pair.left}-${pair.right} 성공`);
        }
        continue;
      }

      // ---------------------------------------------- 보기 선택형

      // 정답이 여러 개인 문제(실전 문제 등)는 **개수만큼 다 골라야** 제출이 된다.
      // 1개짜리는 아래 원래 흐름 그대로 하나만 고른다.
      // '|' 는 카드 종류에 따라 뜻이 다르다:
      //   type 2·3 (객관식)  -> 여러 개를 **다 골라야** 한다
      //   그 밖(빈칸·인라인)  -> 둘 중 아무거나 하나면 된다
      const multiPick = state.cardType === '2' || state.cardType === '3' ||
        (!state.cardType && state.type === 'option');
      const wanted = multiPick ? splitPicks(rawAnswer) : [];
      if (wanted.length > 1) {
        const next = nextPickIndex(state.choices, wanted);
        if (next !== null) {
          const chosen = state.choices.filter((c) => c.on).length;
          if (stage && !answeredQ.has(qid)) {
            answeredQ.add(qid);
            stage.no++;
            stage.solved++;
            d.log(
              `[문법] ⑤ ${stage.no}${stage.total ? `/${stage.total}` : ''}번 문제 ` +
                `'${state.question.slice(0, 30)}' — 정답 ${wanted.length}개를 고릅니다 (${answerFrom})`,
            );
          }
          const ok = await clickTagged(d, 'data-cc-opt', next, ignoredClicks >= TRUSTED_AFTER);
          if (!ok) ignoredClicks++;
          if (await stop.await(400)) break;
          const after = await readState(d);
          if (after && after.kind === 'quiz' &&
              after.choices.filter((c) => c.on).length <= chosen) {
            ignoredClicks++;         // 클릭이 안 먹었다 -> 다음엔 신뢰된 클릭으로
          }
          continue;
        }
        // 다 골랐다 -> 채점하기
        await d.evalBool(CLICK_NEXT_JS);
        if (await stop.await(pace())) break;
        continue;
      }

      // 이미 하나를 골라 둔 상태면 채점하기를 눌러 결과를 받는다.
      if (state.selectedIdx >= 0) {
        await d.evalBool(CLICK_NEXT_JS);
        if (await stop.await(pace())) break;
        continue;
      }

      const wrongSet = wrongByQid.get(qid) || new Set();
      const pick = pickByAnswers(state.choices, answerList, wrongSet)
        ?? pickChoice(state.choices, answer, wrongSet);
      if (pick === null) {
        if (await stop.await(400)) break;
        continue;
      }

      const label = (state.choices.find((c) => c.index === pick) || {}).raw || '';
      if (stage && !answeredQ.has(qid)) {
        answeredQ.add(qid);
        stage.no++;
        stage.solved++;
        d.log(
          `[문법] ⑤ ${stage.no}${stage.total ? `/${stage.total}` : ''}번 문제 ` +
            `'${state.question.slice(0, 30)}' -> ${pick + 1}번 '${label.slice(0, 20)}'` +
            `${answer ? ` (${answerFrom})` : ' (추정)'}`,
        );
      }
      lastNote.set(qid, { q: state.question, picked: `${pick + 1}번 '${label}'`, answer });

      lastPick.set(qid, pick);
      lastQid = qid;

      const clicked = await clickTagged(d, 'data-cc-opt', pick, ignoredClicks >= TRUSTED_AFTER);
      if (!clicked) {
        ignoredClicks++;
        if (await stop.await(400)) break;
        continue;
      }

      if (await stop.await(pace())) break;
      const after = await readState(d);
      // 화면도 그대로고 채점 표시도 없으면 클릭이 먹히지 않은 것으로 본다.
      if (after && after.kind === 'quiz' && after.sig === state.sig && after.feedback === 'none') {
        ignoredClicks++;
        if (ignoredClicks === TRUSTED_AFTER) {
          d.log('[문법] 합성 클릭이 무시됩니다 -> 신뢰된 클릭으로 전환');
        }
      } else {
        ignoredClicks = 0;
      }
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[문법] 오류: ${e.message}`);
  } finally {
    reportStage();
    d.log('[문법] 종료');
  }
}

  return { CONFIG, STAGE_ORDER, splitPicks, nextPickIndex, pickChoice, nextScrambleIndex, nextPairAttempt, nextGroupPick, splitAnswers, pickByAnswers, FIND_ANSWER_JS, pickTalkAnswer, lookupAnswer, nextClassAction, splitBlanks, fillValues, grammar };
})();

// ======================================================== extension/engine/modules/autoall.js
__mod.autoall = (function () {
  const StopFlag = __mod.driver.StopFlag;
  const Basic = __mod.basic;
  const Sentence = __mod.sentence;
  const Games = __mod.games;
/**
 * AutoAll.py 이식 — 단어장 전체 자동화 / 한 세트 자동화.
 *
 * 페이지 이동이 잦지만 이 코드는 백그라운드(서비스 워커)에서 돌기 때문에
 * 탭이 이동해도 상태가 살아 있다. (콘텐츠 스크립트에 넣으면 안 되는 이유)
 */





const SET_ITEM_SELECTOR = '.set-item';
const SET_NAME_LINK_SELECTOR = '.set-item a.set-name-a';
const MEMORIZE_BTN_SELECTOR = '.btn-summary[onclick*="/Memorize/"]';
const RECALL_BTN_SELECTOR = '.btn-summary[onclick*="/Recall/"]';
const MATCH_BTN_SELECTOR = '.btn-summary[onclick*="/Match/"]';
const SPELL_BTN_SELECTOR = '.btn-summary[onclick*="/Spell/"]';
const TEST_BTN_SELECTOR = '.btn-start-speedquiz';

const TEST_NEXT_BTN_SELECTOR = '.btn-condition-next';
const TEST_START_BTN_SELECTOR = '.btn-quiz-start';
const TEST_OK_BTN_SELECTOR = '.modal-content .btn-ok';
const VIEW_TYPE_TOGGLE_SELECTOR = 'a[data-toggle="dropdown"] .str_view_type';
const START_LEARNING_BTN_SELECTOR = '.btn-opt-start';
const FULL_CARDS_DATA_IDX = '6';
const FULL_CARDS_LABEL = '전체 카드 학습';

/** 완료로 간주하는 기준 점수 — 원본 상수 그대로. */
const PASS = {
  test: 90,          // TEST_PASS_SCORE
  sentenceTest: 90,  // SENTENCE_TEST_PASS_SCORE
  // 목표 점수(8500)보다 낮게 두어, 7000 이상 받아 둔 set 은 다시 돌리지 않는다.
  match: 7000,       // 단어 매칭 완료 기준
  scramble: 7000,    // 문장 스크램블 완료 기준
};

function isSentenceSet(setName) {
  return String(setName || '').trim().endsWith('(예문)');
}

/** 매칭/스크램블 버튼 텍스트로 문장 set 판별 (이름의 '(예문)' 보다 확실). */
async function isSentenceSetDetail(d) {
  return d.evalBool(`
    var btn = document.querySelector(${JSON.stringify(MATCH_BTN_SELECTOR)});
    if (!btn) return false;
    return (btn.textContent || '').indexOf('스크램블') >= 0;`);
}

async function getSetItems(d) {
  const arr = await d.eval(`
    var anchors = document.querySelectorAll(${JSON.stringify(SET_NAME_LINK_SELECTOR)});
    var out = [];
    for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        var n = a.firstChild;
        var name = (n ? (n.textContent || '') : '').trim();
        if (!name) name = ((a.textContent || '').split('\\n')[0] || '').trim();
        var si = a.closest('.set-item');
        var sentence = si ? !!si.querySelector('.set-icon.sentence') : false;
        out.push({ idx: a.getAttribute('data-idx'), name: name, sentence: sentence });
    }
    return out;`);
  return Array.isArray(arr) ? arr.filter((s) => s && s.idx) : [];
}

const waitForSetDetail = (d, t, stop) => d.waitForSelector('.btn-summary', t, stop);
const waitForSetList = (d, t, stop) => d.waitForSelector(SET_ITEM_SELECTOR, t, stop);
const waitForTestPage = (d, t, stop) => d.waitForSelector('.flip-card', t, stop);

/** '진행 중인 테스트' 확인 모달(응시 -> 새로 시작)을 최대 3번까지 눌러 준다. */
async function handleTestRestartModals(d, stop, maxClicks = 3, appearTimeoutMs = 2500) {
  for (let i = 0; i < maxClicks; i++) {
    if (!(await d.waitForVisible(TEST_OK_BTN_SELECTOR, appearTimeoutMs, stop))) break;
    if (stop.isSet) return;
    await d.clickFirstVisible(TEST_OK_BTN_SELECTOR);
    d.log('[전체] 테스트 확인 모달 처리 (.btn-ok 클릭)');
    if (await stop.await(700)) return;
  }
}

/** data-rate (학습 완료율) >= 100 이면 완료. */
async function isModeCompleted(d, btnSelector) {
  return d.evalBool(`
    var btn = document.querySelector(${JSON.stringify(btnSelector)});
    if (!btn) return false;
    var el = btn.querySelector('[data-rate]');
    if (!el) return false;
    var rate = parseInt(el.getAttribute('data-rate'), 10);
    if (isNaN(rate)) return false;
    return rate >= 100;`);
}

async function isTestDone(d, passScore) {
  const score = await d.evalIntOrNull(`
    var btn = document.querySelector(${JSON.stringify(TEST_BTN_SELECTOR)});
    if (!btn) return null;
    var m = (btn.textContent || '').match(/(\\d+)\\s*점/);
    return m ? parseInt(m[1], 10) : null;`);
  return score !== null && score >= passScore;
}

async function isMatchDone(d, passScore) {
  const score = await d.evalIntOrNull(`
    var btn = document.querySelector(${JSON.stringify(MATCH_BTN_SELECTOR)});
    if (!btn) return null;
    var m = (btn.textContent || '').match(/([\\d,]+)\\s*점/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;`);
  return score !== null && score >= passScore;
}

/** 스펠이 선생님 지정 '필수'인지 (자율이면 건너뜀). */
async function isSpellRequired(d) {
  return d.evalBool(`
    var btn = document.querySelector(${JSON.stringify(SPELL_BTN_SELECTOR)});
    if (!btn) return false;
    return btn.classList.contains('required');`);
}

async function isFullCardsMode(d) {
  return d.evalBool(`
    var active = document.querySelector('.sel-show-type.active');
    if (!active) return false;
    return active.getAttribute('data-idx') === ${JSON.stringify(FULL_CARDS_DATA_IDX)};`);
}

/** 학습 구간 드롭다운을 '전체 카드 학습'으로 설정. */
async function ensureFullCardsMode(d, stop) {
  if (await isFullCardsMode(d)) return true;

  const toggled = await d.clickSmart(`
    var label = document.querySelector(${JSON.stringify(VIEW_TYPE_TOGGLE_SELECTOR)});
    if (label) el = label.closest('a[data-toggle="dropdown"]');`);
  if (!toggled) {
    d.log('[전체] 학습구간 드롭다운을 찾지 못했습니다.', 'warn');
    return false;
  }

  if (await stop.await(500)) return false;

  const clicked = await d.clickSmart(`
    var opt = document.querySelector('.sel-show-type[data-idx="${FULL_CARDS_DATA_IDX}"]');
    if (!opt) {
        var els = document.querySelectorAll('.sel-show-type');
        for (var i = 0; i < els.length; i++) {
            if ((els[i].textContent || '').trim() === ${JSON.stringify(FULL_CARDS_LABEL)}) {
                opt = els[i];
                break;
            }
        }
    }
    el = opt || null;`);
  if (!clicked) {
    d.log(`[전체] '${FULL_CARDS_LABEL}' 옵션을 찾지 못했습니다.`, 'warn');
    return false;
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await isFullCardsMode(d)) {
      d.log(`[전체] 학습구간 -> '${FULL_CARDS_LABEL}'`);
      return true;
    }
    if (await stop.await(200)) return false;
  }
  d.log('[전체] 학습구간 변경 확인 실패.', 'warn');
  return false;
}

async function clickStartLearning(d, stop) {
  if (!(await d.waitForVisible(START_LEARNING_BTN_SELECTOR, 10000, stop))) {
    d.log(`[전체] 시작 버튼(${START_LEARNING_BTN_SELECTOR})을 찾지 못했습니다.`, 'warn');
    return false;
  }
  if (stop.isSet) return false;
  return d.clickFirstVisible(START_LEARNING_BTN_SELECTOR);
}

/**
 * 모드 함수에는 자식 StopFlag 를 넘겨 모드 종료 시의 stop 이 전체 자동화로
 * 전파되지 않게 격리한다 (원본 run_mode_isolated).
 */
async function runModeIsolated(d, modeFn, answerDict, parentStop) {
  const modeStop = new StopFlag(parentStop);
  try {
    await modeFn(d, answerDict, modeStop);
  } finally {
    modeStop.set();
  }
}

/**
 * 현재 set 상세(셋홈)에서 그 set 의 전체 모드를 순서대로 수행.
 * 순서: 암기 -> 리콜 -> (단어·필수면)스펠 -> 매칭/스크램블 -> 테스트.
 */
async function processSetDetail(d, sentenceMode, stop) {
  const testPass = sentenceMode ? PASS.sentenceTest : PASS.test;
  const spellRequired = !sentenceMode && (await isSpellRequired(d));

  const memorizeDone = await isModeCompleted(d, MEMORIZE_BTN_SELECTOR);
  const recallDone = await isModeCompleted(d, RECALL_BTN_SELECTOR);
  const testDone = await isTestDone(d, testPass);
  const gameDone = sentenceMode
    ? await isMatchDone(d, PASS.scramble)
    : await isMatchDone(d, PASS.match);
  const spellDone = !spellRequired || (await isModeCompleted(d, SPELL_BTN_SELECTOR));

  if (memorizeDone && recallDone && testDone && gameDone && spellDone) {
    d.log('[전체] 모든 모드 완료 — set 스킵');
    return;
  }

  await ensureFullCardsMode(d, stop);
  if (await stop.await(500)) return;
  if (stop.isSet) return;

  const data = await Basic.getData(d);
  if (!data || !data.length) {
    d.log('[전체] 단어장 추출 실패.', 'error');
    return;
  }
  const answerDict = Basic.dictFromCards(data);
  if (!answerDict || !answerDict.size) {
    d.log('[전체] 단어장 생성 실패.', 'error');
    return;
  }

  const steps = [
    ['암기', MEMORIZE_BTN_SELECTOR, sentenceMode ? Sentence.memorizeSentence : Basic.memorize],
    ['리콜', RECALL_BTN_SELECTOR, sentenceMode ? Sentence.recallSentence : Basic.recall],
  ];
  if (sentenceMode) {
    steps.push(['스크램블', MATCH_BTN_SELECTOR, Games.scramble]);
  } else {
    if (spellRequired) steps.push(['스펠', SPELL_BTN_SELECTOR, Basic.spell]);
    steps.push(['매칭', MATCH_BTN_SELECTOR, Games.matching]);
  }
  steps.push(['테스트', TEST_BTN_SELECTOR, sentenceMode ? Games.testSentence : Games.test]);

  for (const [label, btnSelector, modeFn] of steps) {
    if (stop.isSet) break;

    let alreadyDone;
    if (label === '테스트') alreadyDone = await isTestDone(d, testPass);
    else if (label === '매칭') alreadyDone = await isMatchDone(d, PASS.match);
    else if (label === '스크램블') alreadyDone = await isMatchDone(d, PASS.scramble);
    else alreadyDone = await isModeCompleted(d, btnSelector);

    if (alreadyDone) {
      d.log(`[전체] ${label} 이미 완료 — 스킵.`);
      continue;
    }

    if (!(await d.clickFirst(btnSelector))) {
      d.log(`[전체] ${label} 버튼 클릭 실패. 스킵.`, 'warn');
      continue;
    }

    if (await stop.await(1000)) break;

    if (label === '테스트') {
      // 1) '다음'
      if (!(await d.waitForVisible(TEST_NEXT_BTN_SELECTOR, 5000, stop)) ||
          !(await d.clickFirstVisible(TEST_NEXT_BTN_SELECTOR))) {
        d.log("[전체] 테스트 '다음' 버튼 클릭 실패", 'warn');
        continue;
      }
      d.log("[전체] 테스트 '다음' 버튼 클릭 완료");

      if (await stop.await(800)) break;

      // 2) '테스트 시작'
      if (!(await d.waitForVisible(TEST_START_BTN_SELECTOR, 5000, stop)) ||
          !(await d.clickFirstVisible(TEST_START_BTN_SELECTOR))) {
        d.log("[전체] '테스트 시작' 버튼 클릭 실패", 'warn');
        continue;
      }
      d.log("[전체] '테스트 시작' 버튼 클릭 완료");

      // 2.5) 확인 모달
      await handleTestRestartModals(d, stop);
      if (stop.isSet) break;

      // 3) 문제 화면 진입 대기
      if (!(await waitForTestPage(d, 10000, stop))) {
        d.log('[전체] 테스트 페이지 진입 실패. 스킵.', 'warn');
        continue;
      }
    } else if (!(await clickStartLearning(d, stop))) {
      d.log(`[전체] ${label} 시작 버튼 클릭 실패. 스킵.`, 'warn');
      continue;
    }

    if (await stop.await(1000)) break;

    await runModeIsolated(d, modeFn, answerDict, stop);

    if (stop.isSet) break;

    if (!(await waitForSetDetail(d, 15000, stop))) {
      d.log(`[전체] ${label} 후 set 페이지 복귀 실패.`, 'warn');
      break;
    }
  }
}

/** 현재 열려 있는 셋홈의 그 set 만 전체 모드 수행 후 종료. */
async function runSingleSet(d, stop) {
  d.log('[한세트] 시작 ([중지]로 멈춤)');
  if (!(await waitForSetDetail(d, 3000, stop))) {
    d.log('[한세트] set 상세(셋홈) 페이지에서 실행하세요.', 'warn');
    return;
  }
  try {
    const sentenceMode = await isSentenceSetDetail(d);
    const setName = (await d.title()).trim();
    d.log(`[한세트] [${sentenceMode ? '문장' : '단어'}] ${setName}`);
    await processSetDetail(d, sentenceMode, stop);
  } catch (e) {
    if (!stop.isSet) d.log(`[한세트] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[한세트] 종료');
  }
}

/** 단어장 목록 페이지에서 맨 아래 set 부터 위로 순차 처리. */
async function runFullAutomation(d, stop) {
  d.log('[전체] 시작 ([중지]로 멈춤)');

  if (!(await waitForSetList(d, 3000, stop))) {
    d.log('[전체] .set-item을 찾을 수 없습니다. 단어장 목록 페이지에서 시작하세요.', 'warn');
    return;
  }

  // set 목록 URL 저장 (테스트 '나가기' 등으로 히스토리가 오염돼도 확실히 복귀)
  const setListUrl = await d.currentUrl();

  async function backToSetList(timeoutMs = 10000) {
    await d.loadUrl(setListUrl);
    return waitForSetList(d, timeoutMs, stop);
  }

  const processed = new Set();

  try {
    while (!stop.isSet) {
      const sets = await getSetItems(d);
      if (!sets.length) {
        d.log('[전체] set 목록이 비어있습니다. 종료.', 'warn');
        break;
      }

      let target = null;
      for (let i = sets.length - 1; i >= 0; i--) {
        if (!processed.has(sets[i].idx)) {
          target = sets[i];
          break;
        }
      }
      if (!target) {
        d.log('[전체] 모든 set 처리 완료.', 'success');
        break;
      }

      let sentenceMode = target.sentence || isSentenceSet(target.name);

      const clicked = await d.clickSmart(`
        el = document.querySelector(
            '.set-item a.set-name-a[data-idx=' + JSON.stringify(${JSON.stringify(target.idx)}) + ']');`);
      if (!clicked) {
        d.log(`[전체] set 클릭 실패: ${target.name}`, 'warn');
        processed.add(target.idx);
        continue;
      }

      if (!(await waitForSetDetail(d, 10000, stop))) {
        d.log('[전체] set 상세 페이지 진입 실패. 다음 set로 이동.', 'warn');
        processed.add(target.idx);
        await backToSetList(5000);
        continue;
      }

      if (stop.isSet) break;

      sentenceMode = sentenceMode || (await isSentenceSetDetail(d));
      d.log(`[전체] [${sentenceMode ? '문장' : '단어'}] ${target.name}`);

      await processSetDetail(d, sentenceMode, stop);

      if (stop.isSet) break;

      processed.add(target.idx);

      if (!(await backToSetList(10000))) {
        d.log('[전체] 단어장 목록 페이지 복귀 실패. 종료.', 'warn');
        break;
      }

      if (await stop.await(1000)) break;
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[전체] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[전체] 종료');
  }
}

  return { PASS, isSentenceSet, runSingleSet, runFullAutomation };
})();

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
  { id: 'fetch', label: '⤵ 단어장 가져오기', special: 'fetch' },
  { id: 'recall', label: '🔁 리콜', needsTrusted: true },
  { id: 'spell', label: '⌨ 스펠', needsTrusted: true },
  { id: 'memorize_sentence', label: '📖 문장 암기', needsTrusted: true },
  { id: 'recall_sentence', label: '📝 문장 리콜', needsTrusted: true },
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
  <span class="cc-title">클래스카드 자동화</span>
  <span class="cc-ver"></span>
  <button class="cc-x" type="button" aria-label="닫기">✕</button>
</div>
<div class="cc-modes"></div>
<details class="cc-more"><summary>아이폰에서 안 되는 모드 보기</summary><div class="cc-locked"></div></details>
<div class="cc-bar">
  <button class="cc-stop" type="button">■ 정지</button>
  <span class="cc-state">대기 중</span>
</div>
<div class="cc-log" role="log"></div>`;

const style = document.createElement('style');
style.textContent = `
#cc-ios-panel {
  position: fixed; left: 8px; right: 8px; bottom: 8px; z-index: 2147483647;
  background: #1b1c20; color: #f2f2f4; border-radius: 14px;
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif;
  box-shadow: 0 6px 28px rgba(0,0,0,.45); overflow: hidden;
  padding-bottom: env(safe-area-inset-bottom);
}
#cc-ios-panel.cc-min .cc-modes, #cc-ios-panel.cc-min .cc-log, #cc-ios-panel.cc-min .cc-bar { display: none; }
#cc-ios-panel .cc-head {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  background: #26272d; font-weight: 600;
}
#cc-ios-panel .cc-title { flex: 1; }
#cc-ios-panel .cc-ver { opacity: .55; font-weight: 400; font-size: 11px; }
#cc-ios-panel .cc-x {
  background: none; border: 0; color: #f2f2f4; font-size: 16px; padding: 2px 4px;
}
#cc-ios-panel .cc-modes {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; padding: 10px;
}
#cc-ios-panel .cc-modes button {
  appearance: none; border: 1px solid #3a3b42; background: #2c2d33; color: #f2f2f4;
  border-radius: 9px; padding: 11px 8px; font-size: 13px; text-align: left;
  min-height: 44px;
}
#cc-ios-panel .cc-modes button:disabled { opacity: .38; }
#cc-ios-panel .cc-modes button.cc-on { background: #3d6fd6; border-color: #3d6fd6; }
#cc-ios-panel .cc-bar {
  display: flex; align-items: center; gap: 10px; padding: 0 10px 8px;
}
#cc-ios-panel .cc-stop {
  appearance: none; border: 0; background: #b3413f; color: #fff;
  border-radius: 8px; padding: 9px 14px; font-size: 13px; min-height: 40px;
}
#cc-ios-panel .cc-state { opacity: .75; }
#cc-ios-panel .cc-more { padding: 0 10px 8px; font-size: 12px; opacity: .8; }
#cc-ios-panel .cc-more summary { padding: 6px 2px; cursor: pointer; }
#cc-ios-panel .cc-locked {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; padding-top: 4px;
}
#cc-ios-panel .cc-locked button {
  appearance: none; border: 1px dashed #4a4b53; background: transparent; color: inherit;
  border-radius: 8px; padding: 8px; font-size: 12px; text-align: left; opacity: .5;
}
#cc-ios-panel .cc-log {
  max-height: 22vh; overflow-y: auto; padding: 8px 12px 12px;
  border-top: 1px solid #303138; font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap; word-break: break-word;
}
#cc-ios-panel .cc-log div.warn { color: #ffcf6b; }
#cc-ios-panel .cc-log div.error { color: #ff8e8a; }
#cc-ios-panel .cc-log div.success { color: #8fe08a; }
@media (prefers-color-scheme: light) {
  #cc-ios-panel { background: #fbfbfd; color: #17181c; box-shadow: 0 6px 28px rgba(0,0,0,.22); }
  #cc-ios-panel .cc-head { background: #eceef3; }
  #cc-ios-panel .cc-x { color: #17181c; }
  #cc-ios-panel .cc-modes button { background: #fff; border-color: #d3d5dd; color: #17181c; }
  #cc-ios-panel .cc-modes button.cc-on { background: #3d6fd6; border-color: #3d6fd6; color: #fff; }
  #cc-ios-panel .cc-log { border-top-color: #e2e4ea; }
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

addLog('아이폰용 자동화 준비 완료. 학습 화면에서 모드를 누르세요.', 'success');
if (dict) addLog(`저장된 단어장 ${dict.size}개를 불러왔습니다.`);
addLog('리콜·스펠·문장 계열은 iOS 제약으로 동작하지 않습니다.', 'warn');

})();
