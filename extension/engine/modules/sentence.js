/**
 * MemorizeSentence.py / RecallSentence.py 이식 (문장 암기 · 문장 리콜).
 */

import * as N from '../norm.js';

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

  const find = `
    var DASH = ${isDash};
    var target = ${JSON.stringify(cleaned)};
    var items = document.querySelectorAll('.active .scramble-item:not(.clicked)');
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
export async function memorizeSentence(d, answerDict, stop) {
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

/** RecallSentence.py — 문장 리콜 자동화 */
export async function recallSentence(d, answerDict, stop) {
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
