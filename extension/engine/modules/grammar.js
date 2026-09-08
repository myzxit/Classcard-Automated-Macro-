/**
 * 문법훈련(문법 학습/리뷰테스트) 자동 풀이 — 안드로이드 Grammar.kt 와 같은 로직.
 *
 * 다른 모듈과 달리 이식할 원본 파이썬 코드가 없다. 문법훈련 화면의 정확한 마크업을
 * 확인할 수 없었기 때문에, 특정 클래스 이름에 의존하지 않도록 두 가지를 겹쳐 놓았다.
 *
 *  1) 지문/보기 찾기 — 클래스카드가 쓰는 이름들을 후보 목록으로 차례로 시도하고,
 *     전부 실패하면 "보이는 형제 2~6개짜리 클릭 가능한 묶음"이라는 구조로 찾는다.
 *  2) 정답 고르기 — 단어장·study_data 로 답을 알면 그걸 고르고,
 *     모르면 찍고 채점 결과를 기억한다. 틀린 보기는 그 문제에서 다시 고르지 않으므로
 *     보기가 4개면 최대 4번 안에 정답에 도달한다. 정답표가 없어도 풀린다.
 *
 * 화면 구조가 예상과 다르면 CONFIG.debug 를 켜고 한 번 돌려 로그를 확인하면 된다.
 */

import * as N from '../norm.js';
import { buildLookups } from './games.js';

export const CONFIG = {
  debug: false,          // 진단 로그
  maxTryPerQuestion: 6,  // 한 문제에서 이만큼 시도하면 다음으로 넘어간다
  idleGiveUp: 30,        // 문제도 버튼도 못 찾은 채 이만큼 반복하면(≈12초) 종료
};

/** 합성 클릭이 이만큼 무시되면 신뢰된 클릭(CDP)으로 올린다. */
const TRUSTED_AFTER = 2;

const READ_STATE_JS = `
function vis(el) {
    if (!el || el.offsetParent === null) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}
function txt(el) { return ((el && el.textContent) || '').replace(/\\s+/g, ' ').trim(); }

// ---- 종료(결과/랭킹) 화면
var endSel = ['.start-opt-body', '.end-opt-body', '.result-body',
              '.quiz-result', 'a.btn-go-result'];
for (var i = 0; i < endSel.length; i++) {
    if (vis(document.querySelector(endSel[i]))) {
        return { ended: true, qid: '', question: '', choices: [], next: false, feedback: 'none' };
    }
}

// ---- 지문
var qSel = ['.quest-front', '.quest-back', '.quest-body', '.question-body',
            '.quiz-question', '.txt-question', '.card-question', '.grammar-question'];
var question = '';
for (var i = 0; i < qSel.length; i++) {
    var qs = document.querySelectorAll(qSel[i]);
    for (var j = 0; j < qs.length; j++) {
        if (vis(qs[j]) && txt(qs[j])) { question = txt(qs[j]); break; }
    }
    if (question) break;
}
if (!question) {
    var all = document.querySelectorAll('[class*="quest"],[class*="question"]');
    for (var i = 0; i < all.length; i++) {
        var t = txt(all[i]);
        if (vis(all[i]) && t && t.length <= 400 && (!question || t.length < question.length)) {
            question = t;
        }
    }
}

// ---- 보기
var optSel = ['.quiz-opt-body .opt-box', '.opt-body .opt-item', '.opt-list .opt-item',
              'label[for^="radio_"]:not(.hidden)', '.answer-box .answer-item',
              '.btn-answer', '.list-choice li', 'ul.choice li', '.choice-item'];
var found = [];
for (var i = 0; i < optSel.length; i++) {
    var els = document.querySelectorAll(optSel[i]);
    var keep = [];
    for (var j = 0; j < els.length; j++) if (vis(els[j]) && txt(els[j])) keep.push(els[j]);
    if (keep.length >= 2) { found = keep; break; }
}
if (!found.length) {
    var cand = document.querySelectorAll('[class*="opt"],[class*="choice"],[class*="answer"]');
    var byParent = {};
    for (var i = 0; i < cand.length; i++) {
        var el = cand[i];
        if (!vis(el)) continue;
        var t = txt(el);
        if (!t || t.length > 300) continue;
        if (el.querySelector('[class*="opt"],[class*="choice"],[class*="answer"]')) continue;
        var p = el.parentElement;
        if (!p) continue;
        if (!p.__ccKey) p.__ccKey = 'p' + (Math.random() + '').slice(2);
        (byParent[p.__ccKey] = byParent[p.__ccKey] || []).push(el);
    }
    for (var k in byParent) {
        var g = byParent[k];
        if (g.length >= 2 && g.length <= 6 && g.length > found.length) found = g;
    }
}

if (!found.length) {
    // 2차 폴백: 이름을 전혀 모를 때 — 한 부모 아래 같은 태그로 나란히 있는
    //           2~6개의 "누를 수 있어 보이는" 짧은 요소 묶음
    var all = document.querySelectorAll('button, li, label, a, div, span');
    var groups = {};
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
        (groups[key] = groups[key] || []).push(el);
    }
    for (var k in groups) {
        var g = groups[k];
        if (g.length >= 2 && g.length <= 6 && g.length > found.length) found = g;
    }
}

var choices = [];
for (var i = 0; i < found.length; i++) {
    found[i].setAttribute('data-cc-opt', String(i));
    choices.push({ i: i, text: txt(found[i]) });
}

// ---- 채점 표시
var feedback = 'none';
var wrongSel = ['[class*="wrong"]', '[class*="incorrect"]', '.x-mark', '.mark-x'];
var rightSel = ['[class*="correct"]', '[class*="right"]', '.o-mark', '.mark-o'];
for (var i = 0; i < wrongSel.length && feedback === 'none'; i++) {
    var w = document.querySelectorAll(wrongSel[i]);
    for (var j = 0; j < w.length; j++) if (vis(w[j])) { feedback = 'wrong'; break; }
}
for (var i = 0; i < rightSel.length && feedback === 'none'; i++) {
    var c = document.querySelectorAll(rightSel[i]);
    for (var j = 0; j < c.length; j++) if (vis(c[j])) { feedback = 'correct'; break; }
}

// ---- 다음/확인 버튼
var nextSel = ['.btn-condition-next', '.btn-next', '.btn-continue',
               '.modal-content .btn-ok', '.btn-quiz-start', '.btn-opt-start'];
var hasNext = false;
for (var i = 0; i < nextSel.length && !hasNext; i++) {
    var n = document.querySelectorAll(nextSel[i]);
    for (var j = 0; j < n.length; j++) if (vis(n[j])) { hasNext = true; break; }
}

// 화면 지문(sig): 문제가 바뀌었는지 판단하는 기준.
// 클래스 이름이 달라 지문을 못 읽는 화면에서도 보기 묶음으로 문제를 구분할 수 있다.
var sig = question;
for (var i = 0; i < choices.length; i++) sig += '|' + choices[i].text;

var qid = '';
var qi = document.querySelector('input[name="test_question[]"], input[name="question_id"], [data-question-id]');
if (qi) qid = qi.value || qi.getAttribute('data-question-id') || '';
if (!qid) qid = sig;

return {
    ended: false, qid: qid, question: question, sig: sig,
    choices: choices, next: hasNext, feedback: feedback
};
`;

const CLICK_NEXT_JS = `
function vis(el) { return el && el.offsetParent !== null; }
var sel = ['.btn-condition-next', '.btn-next', '.btn-continue',
           '.modal-content .btn-ok', '.btn-quiz-start', '.btn-opt-start'];
for (var i = 0; i < sel.length; i++) {
    var els = document.querySelectorAll(sel[i]);
    for (var j = 0; j < els.length; j++) {
        if (vis(els[j])) { els[j].click(); return true; }
    }
}
return false;
`;

async function readState(d) {
  const data = await d.eval(READ_STATE_JS);
  if (!data || typeof data !== 'object') return null;
  const choices = (data.choices || [])
    .filter((c) => c && (c.text || '').trim())
    .map((c) => ({ index: c.i, raw: c.text.trim(), norm: N.mnorm(c.text.trim()) }));
  return {
    ended: !!data.ended,
    qid: data.qid || '',
    question: (data.question || '').trim(),
    sig: data.sig || '',
    choices,
    hasNext: !!data.next,
    feedback: data.feedback || 'none',
  };
}

/**
 * 고를 보기 번호. 순수 로직이라 단위 테스트로 검증한다.
 *
 * @param {{index:number, raw:string, norm:string}[]} choices
 * @param {string|null} answer 단어장에서 찾은 정답(모르면 null)
 * @param {Set<number>} wrong  이 문제에서 이미 틀린 보기 번호
 */
export function pickChoice(choices, answer, wrong) {
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

/** 단어장에서 지문에 대한 정답을 찾는다. 없으면 null. */
export function lookupAnswer(question, lookups) {
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

async function clickChoice(d, index, trusted) {
  const selector = `[data-cc-opt="${index}"]`;
  if (!trusted) return d.clickFirstVisible(selector);

  // 합성 클릭을 무시하는 화면(문장 테스트와 같은 유형)을 위한 신뢰된 클릭
  return d.trustedClick(`
    var el = document.querySelector('[data-cc-opt="${index}"]');
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: window.innerWidth };
  `);
}

export async function grammar(d, answerDict, stop) {
  d.log('[문법] 시작');

  const dict = answerDict && answerDict.size ? answerDict : await pageDict(d);
  const lookups = buildLookups(dict);
  if (!lookups) d.log('[문법] 단어장이 없습니다 — 보기를 하나씩 확인하며 진행합니다.');
  else d.log(`[문법] 매칭 데이터 로드 완료 (${dict.size}개)`);

  const wrongByQid = new Map();
  const triesByQid = new Map();
  const lastPick = new Map();
  let lastQid = '';
  let idleStreak = 0;
  let ignoredClicks = 0;

  try {
    while (!stop.isSet) {
      const state = await readState(d);
      if (!state) {
        if (await stop.await(400)) break;
        continue;
      }

      if (state.ended) {
        d.log('[문법] 종료 화면 감지 -> 끝');
        stop.set();
        break;
      }

      // 채점 결과 반영: 직전에 고른 보기가 틀렸으면 기억해 둔다.
      if (state.feedback === 'wrong' && lastQid && lastPick.has(lastQid)) {
        const picked = lastPick.get(lastQid);
        if (!wrongByQid.has(lastQid)) wrongByQid.set(lastQid, new Set());
        wrongByQid.get(lastQid).add(picked);
        if (CONFIG.debug) d.log(`[문법] 오답 기억: 보기 ${picked + 1}`);
      }

      if (!state.choices.length) {
        // 보기가 없으면 설명/해설 화면 — 다음으로 넘긴다.
        if (state.hasNext && (await d.evalBool(CLICK_NEXT_JS))) {
          idleStreak = 0;
        } else {
          idleStreak++;
          if (idleStreak === 15) {
            d.log('[문법] 문제도 버튼도 찾지 못했습니다. CONFIG.debug 를 켜고 다시 실행해 보세요.');
          }
          // 결과 화면의 클래스 이름을 모르는 경우까지 대비한 종료 조건
          if (idleStreak >= CONFIG.idleGiveUp) {
            d.log('[문법] 더 이상 풀 문제가 없습니다 -> 종료');
            stop.set();
            break;
          }
        }
        if (await stop.await(400)) break;
        continue;
      }
      idleStreak = 0;

      const qid = state.qid;
      const tries = triesByQid.get(qid) || 0;
      if (tries >= CONFIG.maxTryPerQuestion) {
        // 이 문제는 포기하고 다음으로 (무한 루프 방지)
        await d.evalBool(CLICK_NEXT_JS);
        triesByQid.set(qid, 0);
        wrongByQid.delete(qid);
        if (await stop.await(400)) break;
        continue;
      }

      const answer = lookupAnswer(state.question, lookups);
      const pick = pickChoice(state.choices, answer, wrongByQid.get(qid) || new Set());
      if (pick === null) {
        if (await stop.await(400)) break;
        continue;
      }

      if (CONFIG.debug) {
        const label = (state.choices.find((c) => c.index === pick) || {}).raw || '';
        d.log(
          `[문법] 문제 '${state.question.slice(0, 40)}' 보기 ${state.choices.length}개 ` +
            `-> ${pick + 1}번 '${label.slice(0, 20)}'${answer ? ' (단어장)' : ' (추정)'}`,
        );
      }

      lastPick.set(qid, pick);
      lastQid = qid;
      triesByQid.set(qid, tries + 1);

      const clicked = await clickChoice(d, pick, ignoredClicks >= TRUSTED_AFTER);
      if (!clicked) {
        ignoredClicks++;
        if (await stop.await(400)) break;
        continue;
      }

      if (await stop.await(700)) break;
      const after = await readState(d);
      // 화면도 그대로고 채점 표시도 없으면 클릭이 먹히지 않은 것으로 본다.
      if (after && !after.ended && after.sig === state.sig && after.feedback === 'none') {
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
    d.log('[문법] 종료');
  }
}
