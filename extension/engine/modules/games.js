/**
 * Test.py / TestSentence.py / Matching.py / Scramble.py 이식
 * (단어 테스트 · 문장 테스트 · 단어 매칭 · 문장 스크램블).
 */

import * as N from '../norm.js';
import { ratio } from '../similarity.js';

/** 모듈별 목표 점수/기준값 — 원본 상수를 그대로 옮겼고 설정에서 바꿀 수 있다. */
export const CONFIG = {
  testTargetScore: 90,           // Test.py TARGET_SCORE
  testSentenceTargetScore: 100,  // TestSentence.py TARGET_SCORE
  matchExitMin: 3000,            // Matching.py EXIT_SCORE_MIN
  matchExitMax: 5000,            // Matching.py EXIT_SCORE_MAX
  scrambleExitMin: 4000,         // Scramble.py EXIT_SCORE_MIN
  scrambleExitMax: 5000,         // Scramble.py EXIT_SCORE_MAX
};

const GO_RESULT_SELECTOR = 'a.btn-go-result';

/**
 * TARGET_SCORE 이상이 나오도록 일부러 틀릴 문항 순번(1-based) 집합.
 * 틀릴 개수 = floor(total * (100 - target) / 100) — 내림이라 점수는 항상 목표 이상.
 */
export function planWrongIndices(total, targetScore) {
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
export function buildLookups(answerDict) {
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
export function solve(promptRaw, options, lk) {
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
export async function testCheckEndAndStop(d, stop) {
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
export async function test(d, answerDict, stop) {
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
export function buildMaps(answerDict) {
  const m = new Map();
  const mnp = new Map();
  for (const [back, front] of answerDict) {
    if (!back) continue;
    m.set(N.normalizeKor(back), front);
    mnp.set(N.normalizeKor(N.stripParensSimple(back)), front);
  }
  return { m, mnp };
}

export function matchEnglish(promptRaw, maps) {
  const p = N.normalizeKor(promptRaw);
  if (maps.m.has(p)) return maps.m.get(p);
  const pnp = N.normalizeKor(N.stripParensSimple(promptRaw));
  if (maps.mnp.has(pnp)) return maps.mnp.get(pnp);
  return null;
}

const READ_CARD_JS = `
var card = document.querySelector('.flip-card.showing');
if (!card) return { found: false };

var qid = '';
var qi = card.querySelector('input[name="test_question[]"]');
if (qi) qid = qi.value;

var flipped = card.classList.contains('flip');

var prompt = '';
var fh = card.querySelector('.flip-card-front .front-hidden');
if (fh) prompt = (fh.textContent || '').trim();

var words = card.querySelectorAll('.test-sentence-words a.btn').length;
var placed = card.querySelectorAll('.test-sentence-input span').length;

return { found: true, qid: qid, flipped: flipped, prompt: prompt,
         words: words, placed: placed };`;

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
  const locator = `
    var token = ${JSON.stringify(token)};
    var tokLow = token.toLowerCase();
    var tokNorm = token.toLowerCase().replace(/[^a-z0-9]/g, '');

    var btns = document.querySelectorAll('.flip-card.showing .test-sentence-words a.btn');
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
    var btns = document.querySelectorAll('.flip-card.showing .test-sentence-words a.btn');
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
    var card = document.querySelector('.flip-card.showing');
    if (!card) return [];
    var out = [];
    var btns = card.querySelectorAll('.test-sentence-words a.btn');
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
export async function testSentenceCheckEndAndStop(d, stop) {
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
export async function testSentence(d, answerDict, stop) {
  d.log('[문장 테스트] 시작');

  if (!answerDict || !answerDict.size) {
    d.log('[문장 테스트] 단어장 비어있음. 종료', 'error');
    return;
  }

  const maps = buildMaps(answerDict);
  d.log(`[문장 테스트] 매칭 데이터 로드 완료 (카드 ${answerDict.size}개)`);

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
        }
        if (await stop.await(500)) break;
        continue;
      }

      const english = matchEnglish(q.prompt, maps);
      if (!english) {
        d.log(`[문장 테스트] 매칭 실패: '${q.prompt}'`, 'warn');
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
export function findPair(lefts, rights, lk) {
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

async function waitBoardChange(d, stop, prevLeft, timeoutMs = 2500) {
  const prev = prevLeft.map((c) => c.raw).join(' ');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await stop.await(200)) return true;
    const board = await readBoard(d);
    if (!board) continue;
    const cur = board.left.map((c) => c.raw).join(' ');
    if (cur !== prev) return false;
  }
  return false;
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
export async function isSetHome(d) {
  return d.evalBool("return document.querySelectorAll('.btn-summary').length > 0;");
}

/** 점수/랭킹 화면에서 '학습 종료'로 셋홈 복귀 */
export async function returnToSetHome(d, stop, timeoutMs = 8000) {
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
export async function gameCheckEndAndStop(d, stop) {
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
export async function matching(d, answerDict, stop) {
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

      if (await waitBoardChange(d, stop, lefts, 2500)) break;
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
export function alignIndex(targetWords, placed) {
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
export function findNextIndex(targetWords, placed, cands) {
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
export async function scramble(d, answerDict, stop) {
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
