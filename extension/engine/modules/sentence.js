/**
 * MemorizeSentence.py / RecallSentence.py 이식 (문장 암기 · 문장 리콜).
 */

import * as N from '../norm.js';
import { startStudyIfNeeded, reportCardProgress } from './basic.js';

// ============================================================ 공통 종료 판정

/** `.btn-study-end-repeat` 버튼이 보이면 완료. set 페이지로 복귀 후 stop. */
export async function checkStep2SuccessAndStop(d, stop) {
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

/** MemorizeSentence.py — 예전 문장 암기 화면(.sentence-word 타일 + SPACE) 자동화. 지금 사이트가 아니면 이 흐름으로 폴백한다. */
async function memorizeSentenceLegacy(d, answerDict, stop) {
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
export function findSubsequenceEnd(prefixTokens, sentenceTokens) {
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
export function findMatchingSentences(prefixTokens, sentences, tokenizeFn) {
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
export function findMatchingSentenceFallback(prefixTokens, availableTokens, sentences, tokenizeFn) {
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
export function findSentenceByCandidates(availableTokens, sentences, tokenizeFn) {
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

/** RecallSentence.py — 예전 문장 리콜 화면(콘솔 정답 캡처 + .btn-scramble) 자동화. 지금 사이트가 아니면 이 흐름으로 폴백한다. */
async function recallSentenceLegacy(d, answerDict, stop) {
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

// ============================================================ 문장 스펠 (신규 — 파이썬 원본 없음)
//
// 문장 세트(set_type 5)의 /Spell/{set} 은 단어 스펠과 다른 화면이다 (scripts/v3/spell_sentence.js):
//   - 카드: `.study-body .CardItem.active`, 카드 데이터는 jQuery data('item') (front = 정답 문장)
//   - 학습설정 show_type: 2 어순배열(기본) / 0 영작 / 4 딕테이션 / 5·6 첫글자 / 7
//   - 어순배열: `.back .para_item.active` 의 data('arr') 가 정답 낱말 배열(끝 구두점 [!?,.] 을 뗀 것),
//     `.scramble-body .scramble-item` 의 data('input') 과 `==` 비교. 지금까지 놓은 수 = `.front .line span:not(.end)`.
//     (이 타일의 click 핸들러는 isTrusted 를 보지 않는다)
//   - 영작·딕테이션·첫글자: `textarea.input-answer` 의 마지막 keydown 이 isTrusted 여야 채점한다.
//     첫글자 모드는 글자 하나를 치면 keyup 이 낱말을 통째로 채워 준다.
//   - 결과: `.study-wrapper.correct|wrong` + `.study-footer .feedback .btn-retry-card` / `.btn-next-card`.
//     어순배열은 자동으로 넘어가지 않고, 입력형은 자동재생이 켜져 있으면(기본) 소리만 틀고 멈춘다.
//   - 끝: `#study_end.active` (모르는 카드가 있으면 `.btn-study-end-unknow` 로 한 바퀴 더)

/** 화면 상태 한 번에 읽기 (String.raw: 정규식 역슬래시를 그대로 둔다 — Kotlin 미러와 같은 본문) */
const SSPELL_STATE_JS = String.raw`
function vis(el) { return !!el && el.offsetParent !== null; }
var out = { end: false, unknown: 0, round: false, start: false, modal: false, card: false };
var endEl = document.querySelector('#study_end');
if (endEl && endEl.classList.contains('active')) {
    out.end = true;
    var un = endEl.querySelector('.btn-study-end-unknow');
    var cnt = endEl.querySelector('.unknown_count');
    out.unknown = (vis(un) && cnt) ? (parseInt(cnt.textContent, 10) || 0) : 0;
}
var rep = document.querySelectorAll('.btn-study-end-repeat');
for (var i = 0; i < rep.length; i++) if (vis(rep[i])) out.end = true;
out.round = vis(document.querySelector('.round-body.active'));
var sb = document.querySelectorAll('.btn-opt-start, .start-opt-body a.btn');
for (var j = 0; j < sb.length; j++) if (vis(sb[j])) out.start = true;
var modal = document.querySelector('#alertModal');
out.modal = !!modal && window.getComputedStyle(modal).display === 'block';
var wrap = document.querySelector('.study-wrapper');
out.correct = !!wrap && wrap.classList.contains('correct');
out.wrong = !!wrap && wrap.classList.contains('wrong');
out.playing = !!(window.audio && window.audio.src && !window.audio.paused && !window.audio.ended);
out.showType = (typeof show_type !== 'undefined' && show_type !== null) ? parseInt(show_type, 10) : null;
var card = document.querySelector('.study-body .CardItem.active') || document.querySelector('.CardItem.active');
if (!card || !vis(card)) return out;
out.card = true;
var jq = window.jQuery;
var item = jq ? jq(card).data('item') : null;
out.key = String(jq ? jq(card).data('idx') : '') + ':' + Array.prototype.indexOf.call(card.parentNode.children, card);
out.status = card.getAttribute('data-status') || '';
out.step1 = !!card.querySelector('.step.s1.active');                     // 문장 암기 1단계(문장 보기)
var ib = card.querySelector('.front .input-box') || card.querySelector('.input-box');
// 예전 화면: v3 의 표식(카드 안 .scramble-body / 입력창 / input-box 의 arr_answer 데이터)이 없는데 낱말 타일은 있다
var hasArrAnswer = !!(ib && jq && jq(ib).data('arr_answer'));
out.legacy = !card.querySelector('.scramble-body') && !card.querySelector('textarea.input-answer') && !hasArrAnswer
    && !!(card.querySelector('.sentence-word, .btn-scramble, .scramble-item') || document.querySelector('.scramble-body .btn-scramble'));
out.scramble = card.classList.contains('scramble') || !!card.querySelector('.scramble-body');
out.recall = !!ib && !out.scramble;                                        // 문장 리콜(빈칸 채우기)
if (out.recall) {
    var arrA = jq ? jq(ib).data('arr_answer') : null;
    var rw = [];
    if (arrA && arrA.length) for (var q = 0; q < arrA.length; q++) rw.push(String(arrA[q]).trim());
    out.rWords = rw;
    out.rPlaced = ib.querySelectorAll('.btn-scramble:not(.now)').length;
    var rt = document.querySelectorAll('.scramble-body .btn-scramble');
    var rl = [];
    for (var r = 0; r < rt.length; r++) rl.push({ text: (rt[r].textContent || '').trim(), clicked: rt[r].classList.contains('clicked') });
    out.rTiles = rl;
}
if (out.scramble) {
    var para = card.querySelector('.back .para_item.active');
    var arr = (jq && para) ? jq(para).data('arr') : null;
    var words = [];
    if (arr && arr.length) {
        for (var k = 0; k < arr.length; k++) {
            var w = String(arr[k]);
            if (w == '/') continue;
            var s = w.replace(/[!?,.]+$/g, '').trim();
            words.push(s.length ? s : w.trim());
        }
    }
    out.words = words;
    out.done = card.querySelectorAll('.front .line span:not(.end)').length;
    var body = card.querySelector('.scramble-body');
    out.tilesDisabled = !!body && body.classList.contains('disabled');
    var tiles = card.querySelectorAll('.scramble-body .scramble-item');
    var list = [];
    for (var t = 0; t < tiles.length; t++) {
        var inp = jq ? jq(tiles[t]).data('input') : null;
        list.push({ input: inp == null ? (tiles[t].textContent || '').trim() : String(inp),
                    clicked: tiles[t].classList.contains('clicked') });
    }
    out.tiles = list;
} else {
    var ta = card.querySelector('textarea.input-answer');
    out.hasInput = vis(ta);
    out.value = ta ? ta.value : '';
    var front = (item && item.front != null) ? String(item.front) : '';
    var ans = (typeof removeBracket === 'function') ? removeBracket(front)
        : front.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '');
    ans = ans.replace(/<br\s*\/?>/gi, ' ').replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim();
    out.answer = ans;
}
return out;`;

async function sspellState(d) {
  const s = await d.eval(SSPELL_STATE_JS);
  return s && typeof s === 'object' ? s : null;
}

/** 어순배열 타일 하나 클릭 (타일 click 은 isTrusted 를 안 보지만 규칙대로 진짜 클릭을 먼저 쓴다) */
async function sspellClickTile(d, index) {
  return d.clickSmart(`
    var card = document.querySelector('.study-body .CardItem.active') || document.querySelector('.CardItem.active');
    var tiles = card ? card.querySelectorAll('.scramble-body .scramble-item') : [];
    el = tiles[${index}] || null;`);
}

/** 채점 결과 화면의 버튼 ('.btn-next-card' 다음 카드/나중에 다시, '.btn-retry-card' 지금 재시도) */
async function sspellClickFeedback(d, cls) {
  return d.clickSmart(`
    var btns = document.querySelectorAll('.study-footer .feedback ${cls}');
    for (var i = 0; i < btns.length; i++) if (btns[i].offsetParent !== null) { el = btns[i]; break; }
    if (!el) {   // 문장 암기 화면은 feedback 묶음 없이 footer 에 바로 버튼이 있다
        btns = document.querySelectorAll('.study-footer ${cls}');
        for (var j = 0; j < btns.length; j++) if (btns[j].offsetParent !== null) { el = btns[j]; break; }
    }`);
}

async function sspellClickConfirm(d) {
  return d.clickSmart(`
    var btns = document.querySelectorAll('.study-footer .btns .btn-confirm-card');
    for (var i = 0; i < btns.length; i++) if (btns[i].offsetParent !== null) { el = btns[i]; break; }`);
}

/** '대소문자 틀림!' 같은 안내 모달의 확인 버튼 */
async function sspellCloseModal(d) {
  return d.clickSmart(`
    var btns = document.querySelectorAll('#alertModal .btn, #alertModal button');
    for (var i = 0; i < btns.length; i++) if (btns[i].offsetParent !== null) { el = btns[i]; break; }`);
}

/** 입력창(textarea.input-answer)에 포커스를 주고 비운다 (값 지우기는 신뢰된 입력이 필요 없다) */
async function sspellFocusInput(d) {
  return d.evalBool(`
    var card = document.querySelector('.study-body .CardItem.active') || document.querySelector('.CardItem.active');
    var ta = card ? card.querySelector('textarea.input-answer') : null;
    if (!ta || ta.offsetParent === null) return false;
    ta.focus();
    if (ta.value) {
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, '');
        ta.dispatchEvent(new Event('input', {bubbles: true}));
    }
    return true;`);
}

async function sspellRefocusInput(d) {
  return d.evalBool(`
    var card = document.querySelector('.study-body .CardItem.active') || document.querySelector('.CardItem.active');
    var ta = card ? card.querySelector('textarea.input-answer') : null;
    if (!ta) return false;
    if (document.activeElement !== ta) ta.focus();
    return true;`);
}

/** 첫글자 모드(5·6)에서 칠 글자들: 낱말마다 첫 글자·숫자 하나 (기호뿐인 낱말은 사이트가 알아서 채운다) */
export function sspellFirstLetters(answer) {
  const out = [];
  for (const w of String(answer || '').split(/\s+/)) {
    const m = w.match(/[0-9A-Za-zÀ-ɏ가-힣]/);
    if (m) out.push(m[0]);
  }
  return out;
}

/** 카드가 바뀌거나(키 변화) 끝날 때까지 기다린다: 'changed' | 'done' | 'stopped' | 'stuck' */
async function sspellWaitCardChange(d, stop, prevKey, timeout) {
  let elapsed = 0;
  while (elapsed < timeout) {
    if (await stop.await(200)) return 'stopped';
    elapsed += 200;
    const s = await sspellState(d);
    if (!s) continue;
    if (s.end) return 'done';
    if (s.round || s.start) return 'changed';
    if (s.card && s.key !== prevKey && !s.correct && !s.wrong) return 'changed';
  }
  return 'stuck';
}

/** 소리가 나는 중이면 끝까지 듣는다 (최대 maxMs) */
async function sspellWaitAudio(d, stop, maxMs) {
  let waited = 0;
  while (waited < maxMs) {
    const playing = await d.evalBool(
      'return !!(window.audio && window.audio.src && !window.audio.paused && !window.audio.ended);',
    );
    if (!playing) return;
    if (await stop.await(250)) return;
    waited += 250;
  }
}

const SSPELL_MAX_ROUNDS = 3;      // 모르는 카드 다시 학습 최대 횟수
const SSPELL_RETRY_PER_CARD = 2;  // 오답 시 '지금 재시도' 횟수 (그 뒤 '나중에 다시')

/** 문장 스펠 자동화 (어순배열 · 영작 · 딕테이션 · 첫글자 모두) */
export async function spellSentence(d, answerDict, stop) {
  d.log('[문장 스펠] 시작');
  let rounds = 0;
  let retries = 0;
  let retryKey = null;
  let loggedMode = false;
  let warnedTrusted = false;
  let sameCount = 0;
  let lastSig = '';
  try {
    while (!stop.isSet) {
      const s = await sspellState(d);
      if (!s) { if (await stop.await(400)) break; continue; }
      if (s.card) await reportCardProgress(d, '문장 리콜');
      if (s.card) await reportCardProgress(d, '문장 암기');
      if (s.card) await reportCardProgress(d, '문장 스펠');

      if (s.end) {
        if (s.unknown > 0 && rounds < SSPELL_MAX_ROUNDS) {
          rounds += 1;
          d.log(`[문장 스펠] 모르는 카드 ${s.unknown}개 — 다시 학습합니다 (${rounds}/${SSPELL_MAX_ROUNDS})`);
          await d.clickFirstVisible('#study_end .btn-study-end-unknow');
          if (await stop.await(1500)) break;
          continue;
        }
        d.log('[문장 스펠] 학습 완료');
        await d.exec('var a = document.querySelectorAll("#study_end.active .study-header a"); if (a.length) a[0].click();');
        await d.exec('var a = document.querySelectorAll(".btn-top-menu a"); if (a.length) a[0].click();');
        await stop.sleep(500);
        await d.exec('var a = document.querySelectorAll(".close_o"); if (a.length) a[0].click();');
        stop.set();
        break;
      }
      if (s.modal) {            // '대소문자 틀림!' 안내 → 확인 (정답 처리는 이미 됐다)
        await sspellCloseModal(d);
        if (await stop.await(700)) break;
        continue;
      }
      if (s.round) { if (await stop.await(500)) break; continue; }
      if (s.start) {
        await startStudyIfNeeded(d, stop);
        if (await stop.await(800)) break;
        continue;
      }
      if (!s.card) { if (await stop.await(400)) break; continue; }

      // 같은 상태가 오래 이어지면 한 줄 진단 (사이트가 바뀌었을 때 원인을 짚기 위해)
      const sig = `${s.key}|${s.correct}|${s.wrong}|${s.scramble}|${s.done}|${(s.tiles || []).filter((t) => !t.clicked).length}|${s.value || ''}`;
      if (sig === lastSig) {
        sameCount += 1;
        if (sameCount === 40) {
          d.log(`[문장 스펠] 진행이 멈췄습니다 — 화면: ${JSON.stringify({ key: s.key, status: s.status, scramble: s.scramble, done: s.done, words: (s.words || []).length, tiles: (s.tiles || []).length, showType: s.showType }).slice(0, 220)}`, 'warn');
          await sspellClickFeedback(d, '.btn-next-card');
        }
      } else { sameCount = 0; lastSig = sig; }

      if (!loggedMode) {
        loggedMode = true;
        d.log(`[문장 스펠] 학습설정: ${s.scramble ? '어순배열' : (s.showType === 5 || s.showType === 6) ? '첫글자 입력' : (s.showType === 4) ? '딕테이션' : '영작'}`);
      }

      if (s.correct) {          // 정답 → 소리가 나면 끝까지 듣고 다음 카드
        if (!s.scramble) { await stop.sleep(900); await sspellWaitAudio(d, stop, 20000); }
        if (stop.isSet) break;
        await sspellClickFeedback(d, '.btn-next-card');
        const r = await sspellWaitCardChange(d, stop, s.key, 3000);
        if (r === 'stopped') break;
        if (r === 'stuck') { await d.blurActiveElement(); await d.pressSpace(); }
        continue;
      }
      if (s.wrong) {            // 오답 → 몇 번은 지금 재시도, 그 뒤엔 나중에 다시
        if (retryKey !== s.key) { retryKey = s.key; retries = 0; }
        if (retries < SSPELL_RETRY_PER_CARD) {
          retries += 1;
          d.log(`[문장 스펠] 오답 — 지금 재시도 (${retries}/${SSPELL_RETRY_PER_CARD})`, 'warn');
          await sspellClickFeedback(d, '.btn-retry-card');
        } else {
          d.log('[문장 스펠] 오답 — 나중에 다시', 'warn');
          await sspellClickFeedback(d, '.btn-next-card');
          await sspellWaitCardChange(d, stop, s.key, 3000);
        }
        if (await stop.await(500)) break;
        continue;
      }

      if (s.scramble) {
        if (!s.words || !s.words.length || s.tilesDisabled) { if (await stop.await(300)) break; continue; }
        const expected = s.words[s.done];
        if (expected === undefined) { if (await stop.await(300)) break; continue; }  // 다음 묶음/문단으로 넘어가는 중
        let hit = -1;
        for (let i = 0; i < s.tiles.length; i++) {
          if (!s.tiles[i].clicked && s.tiles[i].input === expected) { hit = i; break; }
        }
        if (hit < 0) {
          // 사이트와 같은 비교인데 없다면 화면이 갱신되는 중 — 잠깐 기다렸다 다시
          if (await stop.await(250)) break;
          continue;
        }
        await sspellClickTile(d, hit);
        if (await stop.await(120)) break;
        continue;
      }

      // ---- 입력형 (영작 · 딕테이션 · 첫글자)
      if (!s.hasInput) { if (await stop.await(300)) break; continue; }
      if (!s.answer) {
        d.log('[문장 스펠] 정답 문장을 읽지 못했습니다 — 빈 답으로 넘깁니다', 'warn');
        await sspellClickConfirm(d);
        if (await stop.await(600)) break;
        continue;
      }
      if (!(await sspellFocusInput(d))) { if (await stop.await(300)) break; continue; }
      let typed = true;
      if (s.showType === 5 || s.showType === 6) {
        for (const ch of sspellFirstLetters(s.answer)) {
          if (!(await d.typeText(ch))) { typed = false; break; }
          if (await stop.await(140)) break;
          await sspellRefocusInput(d);      // 사이트가 글자마다 blur → 50ms 뒤 focus 를 한다
        }
      } else {
        typed = await d.typeText(s.answer);
      }
      if (stop.isSet) break;
      if (!typed && !warnedTrusted) {
        warnedTrusted = true;
        d.log('[문장 스펠] 진짜 키 입력을 보낼 수 없어 채점이 거부됩니다 — 학습설정을 "어순배열"로 바꾸면 됩니다', 'error');
      }
      if (await stop.await(150)) break;
      await sspellClickConfirm(d);
      // 채점 결과(correct/wrong) 또는 카드 전환을 기다린다
      let waited = 0;
      while (waited < 3000) {
        if (await stop.await(200)) break;
        waited += 200;
        const t = await sspellState(d);
        if (!t || t.end || t.modal || t.correct || t.wrong || t.key !== s.key) break;
      }
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[문장 스펠] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[문장 스펠] 종료');
  }
}

// ============================================================ 문장 암기 (지금 사이트: scripts/v3/mem_sentence.js)
//
//   - 카드 `.CardItem.active` 는 1단계(.step.s1: 문장·뜻 보기, '영작 연습하기' .btn-go-step1)와
//     2단계(.step.s2: 어순배열 — 문장 스펠의 어순배열과 같은 .para_item data('arr') / .scramble-item data('input'))로 되어 있다.
//   - SPACE 는 1단계에서 2단계로, **2단계에서는 '나중에 다시'(.btn-next-card)** 를 누른다.
//     예전 흐름처럼 SPACE 를 먼저 두 번 누르면 문장을 만들기도 전에 카드를 건너뛴다 (실제 로그의 "안 만들어졌는데 건너뜀").
//   - 다 맞추면 `.study-wrapper.correct` + '다음 카드'(.btn-next-card). 틀린 타일은 0.8초 뒤 다시 제시된다.
//   - 카드가 나오면 0.6초 뒤 문장 소리가 난다 — 끝까지 듣고 2단계로 간다.
//   - 끝: `#study_end.active`, 모르는 카드가 있으면 `.btn-study-end-unknow` 로 그 카드만 다시.

export async function memorizeSentence(d, answerDict, stop) {
  // 사이트가 어느 화면인지 먼저 본다 (카드가 아직 없으면 시작 화면부터)
  d.log('[문장 암기] 시작');
  let rounds = 0;
  let sameCount = 0;
  let lastSig = '';
  let waitedAudioFor = null;
  try {
    while (!stop.isSet) {
      const s = await sspellState(d);
      if (!s) { if (await stop.await(400)) break; continue; }

      if (s.end) {
        if (s.unknown > 0 && rounds < SSPELL_MAX_ROUNDS) {
          rounds += 1;
          d.log(`[문장 암기] 모르는 카드 ${s.unknown}개 — 다시 학습합니다 (${rounds}/${SSPELL_MAX_ROUNDS})`);
          await d.clickFirstVisible('#study_end .btn-study-end-unknow');
          if (await stop.await(1500)) break;
          continue;
        }
        d.log('[문장 암기] 학습 완료');
        await d.exec('var a = document.querySelectorAll("#study_end.active .study-header a"); if (a.length) a[0].click();');
        await d.exec('var a = document.querySelectorAll(".btn-top-menu a"); if (a.length) a[0].click();');
        await stop.sleep(500);
        await d.exec('var a = document.querySelectorAll(".close_o"); if (a.length) a[0].click();');
        stop.set();
        break;
      }
      if (s.modal) { await sspellCloseModal(d); if (await stop.await(700)) break; continue; }
      if (s.round) { if (await stop.await(500)) break; continue; }
      if (s.start) { await startStudyIfNeeded(d, stop); if (await stop.await(800)) break; continue; }
      if (!s.card) { if (await stop.await(400)) break; continue; }

      if (s.legacy) {           // 예전 화면 — 옛 흐름으로
        d.log('[문장 암기] 예전 화면 구조입니다 — 이전 방식으로 진행합니다');
        await memorizeSentenceLegacy(d, answerDict, stop);
        return;
      }

      const sig = `${s.key}|${s.step1}|${s.correct}|${s.done}|${(s.tiles || []).filter((t) => !t.clicked).length}`;
      if (sig === lastSig) {
        sameCount += 1;
        if (sameCount === 60) {
          d.log(`[문장 암기] 진행이 멈췄습니다 — 화면: ${JSON.stringify({ key: s.key, step1: s.step1, done: s.done, words: (s.words || []).length, tiles: (s.tiles || []).length }).slice(0, 200)}`, 'warn');
          await sspellClickFeedback(d, '.btn-next-card');
        }
      } else { sameCount = 0; lastSig = sig; }

      if (s.step1) {            // 1단계: 문장 소리를 끝까지 듣고 '영작 연습하기'
        if (waitedAudioFor !== s.key) {
          waitedAudioFor = s.key;
          await stop.sleep(900);
          await sspellWaitAudio(d, stop, 20000);
          if (stop.isSet) break;
        }
        const clicked = await d.clickSmart(`
          var card = document.querySelector('.study-body .CardItem.active') || document.querySelector('.CardItem.active');
          var b = card ? card.querySelector('.step.s1 .btn-go-step1') : null;
          if (b && b.offsetParent !== null) el = b;`);
        if (!clicked) await d.pressSpace();
        if (await stop.await(500)) break;
        continue;
      }

      if (s.correct) {          // 다 맞춤 → 다음 카드
        await sspellClickFeedback(d, '.btn-next-card');
        const r = await sspellWaitCardChange(d, stop, s.key, 3000);
        if (r === 'stopped') break;
        if (r === 'stuck') { await d.blurActiveElement(); await d.pressSpace(); }
        continue;
      }

      if (!s.scramble || !s.words || !s.words.length || s.tilesDisabled) { if (await stop.await(300)) break; continue; }
      const expected = s.words[s.done];
      if (expected === undefined) { if (await stop.await(300)) break; continue; }
      let hit = -1;
      for (let i = 0; i < s.tiles.length; i++) {
        if (!s.tiles[i].clicked && s.tiles[i].input === expected) { hit = i; break; }
      }
      if (hit < 0) { if (await stop.await(250)) break; continue; }
      await sspellClickTile(d, hit);
      if (await stop.await(120)) break;
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[문장 암기] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[문장 암기] 종료');
  }
}

// ============================================================ 문장 리콜 (지금 사이트: scripts/v3/recall_sentence.js)
//
//   - 카드 `.CardItem.active .front .input-box` 에 앞부분 낱말이 미리 채워져 있고, 빈칸은 `.btn-scramble.now`('?') 로 표시된다.
//     빈칸 정답은 그 input-box 의 jQuery data('arr_answer') (순서대로). 콘솔 캡처가 필요 없다.
//   - 보기 타일은 footer 의 `.scramble-body .btn-scramble` (한 번에 최대 4개). 놓은 수 = `.input-box .btn-scramble:not(.now)`.
//     타일 글과 정답 낱말이 `==` 로 같아야 한다. 한 묶음을 다 놓으면 채점: 틀리면 `.study-wrapper.wrong`(정답 표시), 맞으면 다음 묶음.
//   - 다 맞추면 `.study-wrapper.correct`. 어느 쪽이든 `.feedback .btn-next-card`(다음카드) 로 넘어간다 (재시도 없음 — 틀린 카드는 다음 바퀴에).
//   - 끝: `#study_end.active`, 모르는 카드가 있으면 `.btn-study-end-unknow` 로 그 카드만 다시.

async function rsentClickTile(d, index) {
  return d.clickSmart(`
    var tiles = document.querySelectorAll('.scramble-body .btn-scramble');
    el = tiles[${index}] || null;`);
}

export async function recallSentence(d, answerDict, stop) {
  d.log('[문장 리콜] 시작');
  let rounds = 0;
  let sameCount = 0;
  let lastSig = '';
  let wrongLogged = null;
  try {
    while (!stop.isSet) {
      const s = await sspellState(d);
      if (!s) { if (await stop.await(400)) break; continue; }

      if (s.end) {
        if (s.unknown > 0 && rounds < SSPELL_MAX_ROUNDS) {
          rounds += 1;
          d.log(`[문장 리콜] 모르는 카드 ${s.unknown}개 — 다시 학습합니다 (${rounds}/${SSPELL_MAX_ROUNDS})`);
          await d.clickFirstVisible('#study_end .btn-study-end-unknow');
          if (await stop.await(1500)) break;
          continue;
        }
        d.log('[문장 리콜] 학습 완료');
        await d.exec('var a = document.querySelectorAll("#study_end.active .study-header a"); if (a.length) a[0].click();');
        await d.exec('var a = document.querySelectorAll(".btn-top-menu a"); if (a.length) a[0].click();');
        await stop.sleep(500);
        await d.exec('var a = document.querySelectorAll(".close_o"); if (a.length) a[0].click();');
        stop.set();
        break;
      }
      if (s.modal) { await sspellCloseModal(d); if (await stop.await(700)) break; continue; }
      if (s.round) { if (await stop.await(500)) break; continue; }
      if (s.start) { await startStudyIfNeeded(d, stop); if (await stop.await(800)) break; continue; }
      if (!s.card) { if (await stop.await(400)) break; continue; }

      if (s.legacy) {
        d.log('[문장 리콜] 예전 화면 구조입니다 — 이전 방식으로 진행합니다');
        await recallSentenceLegacy(d, answerDict, stop);
        return;
      }

      const sig = `${s.key}|${s.correct}|${s.wrong}|${s.rPlaced}|${(s.rTiles || []).filter((t) => !t.clicked).length}`;
      if (sig === lastSig) {
        sameCount += 1;
        if (sameCount === 60) {
          d.log(`[문장 리콜] 진행이 멈췄습니다 — 화면: ${JSON.stringify({ key: s.key, recall: s.recall, placed: s.rPlaced, words: (s.rWords || []).length, tiles: (s.rTiles || []).length }).slice(0, 200)}`, 'warn');
          await sspellClickFeedback(d, '.btn-next-card');
        }
      } else { sameCount = 0; lastSig = sig; }

      if (s.correct || s.wrong) {
        if (s.wrong && wrongLogged !== s.key) { wrongLogged = s.key; d.log('[문장 리콜] 오답 처리된 카드 — 다음 바퀴에 다시 나옵니다', 'warn'); }
        await sspellClickFeedback(d, '.btn-next-card');
        const r = await sspellWaitCardChange(d, stop, s.key, 3000);
        if (r === 'stopped') break;
        if (r === 'stuck') { await d.blurActiveElement(); await d.pressSpace(); }
        continue;
      }

      if (!s.recall || !s.rWords || !s.rWords.length) { if (await stop.await(300)) break; continue; }
      const expected = s.rWords[s.rPlaced];
      if (expected === undefined) { if (await stop.await(300)) break; continue; }
      let hit = -1;
      for (let i = 0; i < s.rTiles.length; i++) {
        if (!s.rTiles[i].clicked && s.rTiles[i].text === expected) { hit = i; break; }
      }
      if (hit < 0) {
        // 사이트는 < > 를 &lt; &gt; 로 바꿔 비교한다 — 표시 글자가 다를 수 있으니 공백·기호를 뺀 비교로 한 번 더
        const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
        for (let i = 0; i < s.rTiles.length; i++) {
          if (!s.rTiles[i].clicked && norm(s.rTiles[i].text) === norm(expected) && norm(expected)) { hit = i; break; }
        }
      }
      if (hit < 0) { if (await stop.await(250)) break; continue; }
      await rsentClickTile(d, hit);
      if (await stop.await(150)) break;
    }
  } catch (e) {
    if (!stop.isSet) d.log(`[문장 리콜] 오류: ${e.message}`, 'error');
  } finally {
    d.log('[문장 리콜] 종료');
  }
}
