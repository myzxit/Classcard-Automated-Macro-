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
 * 확인하지 못한 화면(매칭·분류 등)을 위해, 이름을 모를 때 쓰는 구조 기반 폴백도 남겨 둔다.
 * 정답을 못 읽는 문제는 찍고 채점 결과를 기억해서 오답을 지워 나간다.
 */

import * as N from '../norm.js';
import { buildLookups } from './games.js';

export const CONFIG = {
  debug: false,          // 진단 로그
  maxTryPerQuestion: 6,  // 한 문제에서 이만큼 시도하면 다음으로 넘어간다
  idleGiveUp: 30,        // 문제도 버튼도 못 찾은 채 이만큼 반복하면(≈12초) 종료
  driveClassPage: true,  // 클래스 페이지에서 유닛/단계를 스스로 눌러 진행할지
};

/** 합성 클릭이 이만큼 무시되면 신뢰된 클릭(CDP)으로 올린다. */
const TRUSTED_AFTER = 2;

/** 클래스 페이지에서 이 순서로 단계를 진행한다(화면에 나타나는 순서와 같다). */
export const STAGE_ORDER = [
  '개념 톡', '연습 문제 A', '연습 문제 B', '서술형 문제',
  '실전 문제', '누적오답복습', 'Scramble',
];

const NEXT_SELECTORS = [
  '.study-bottom .btn-next-box .btn-gclass', '.study-bottom .btn-next-box a',
  '.btn-next-box .btn-gclass', '.btnNextCard',
  '.btn-condition-next', '.btn-next', '.btn-continue',
  '.modal-content .btn-ok', '.btn-quiz-start', '.btn-opt-start',
];

const END_SELECTORS = [
  '.start-opt-body', '.end-opt-body', '.result-body', '.quiz-result', 'a.btn-go-result',
];

const READ_STATE_JS = `
function vis(el) {
    if (!el || el.offsetParent === null) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}
function txt(el) { return ((el && el.textContent) || '').replace(/\\s+/g, ' ').trim(); }
function any(sel) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) if (vis(els[i])) return els[i];
    return null;
}

var NEXT_SEL = ${JSON.stringify(NEXT_SELECTORS)}.join(',');
var END_SEL = ${JSON.stringify(END_SELECTORS)}.join(',');

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
        var stages = [];
        var boxes = u.querySelectorAll('.unit-set-list .set-box');
        for (var j = 0; j < boxes.length; j++) {
            var b = boxes[j];
            b.setAttribute('data-cc-stage', i + '_' + j);
            stages.push({
                key: i + '_' + j,
                title: txt(b.querySelector('.title')) || txt(b),
                locked: b.className.indexOf('lock') >= 0,
                visible: vis(b)
            });
        }
        u.setAttribute('data-cc-unit', String(i));
        units.push({
            i: i,
            name: txt(nameEl),
            locked: u.className.indexOf('lock') >= 0,
            open: !!(title && title.getAttribute('data-open') === '1'),
            hasTitle: !!title,
            stages: stages
        });
    }
    return { kind: 'class', units: units };
}

// ================================================ 2) 종료 화면
if (any(END_SEL)) {
    return { kind: 'end' };
}

// ================================================ 3) 문법 문제 화면
var items = document.querySelectorAll('.gclass-q-item');
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

    // 보기 종류별로 찾는다 (실제 마크업 이름)
    var type = '', found = [];
    var groups = [
        ['object', '.gclass-q-input .object-body .object'],
        ['option', '.gclass-q-input .inline-box .option-box .option-item:not(.hidden)'],
        ['scramble', '.scramble-body .scramble-word'],
        ['match', '.match-content .match-body .match-item'],
        ['group', '.grouping-body .grouping-item .radio-button label']
    ];
    for (var g = 0; g < groups.length; g++) {
        var els = it.querySelectorAll(groups[g][1]);
        var keep = [];
        for (var j = 0; j < els.length; j++) if (vis(els[j]) && txt(els[j])) keep.push(els[j]);
        if (keep.length >= 2) { type = groups[g][0]; found = keep; break; }
    }

    // 입력형(서술형·딕테이션)
    var input = null;
    if (!found.length) {
        var ins = it.querySelectorAll(
            '.gclass-q-input input[type="text"], .inline-input-body input, .dictation-input, textarea');
        for (var j = 0; j < ins.length; j++) if (vis(ins[j]) && !ins[j].disabled) { input = ins[j]; break; }
        if (input) { type = 'input'; input.setAttribute('data-cc-input', '1'); }
    }

    var choices = [];
    for (var j = 0; j < found.length; j++) {
        found[j].setAttribute('data-cc-opt', String(j));
        choices.push({ i: j, text: txt(found[j]) });
    }

    if (done && !choices.length && !input) continue;   // 이미 푼 문항은 건너뛴다

    var sig = question;
    for (var j = 0; j < choices.length; j++) sig += '|' + choices[j].text;

    return {
        kind: 'quiz', type: type, qid: sig, sig: sig,
        question: question, answer: answer,
        choices: choices, hasInput: !!input,
        feedback: cls.indexOf(' correct ') >= 0 ? 'correct'
                : (cls.indexOf(' wrong ') >= 0 ? 'wrong' : 'none'),
        next: !!any(NEXT_SEL)
    };
}

// ================================================ 4) 이름을 모르는 화면 (폴백)
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
  if (data.kind === 'class' || data.kind === 'end' || data.kind === 'idle') return data;
  return {
    kind: 'quiz',
    type: data.type || '',
    qid: data.qid || '',
    sig: data.sig || '',
    question: (data.question || '').trim(),
    answer: (data.answer || '').trim(),
    hasInput: !!data.hasInput,
    feedback: data.feedback || 'none',
    next: !!data.next,
    choices: (data.choices || [])
      .filter((c) => c && (c.text || '').trim())
      .map((c) => ({ index: c.i, raw: c.text.trim(), norm: N.mnorm(c.text.trim()) })),
  };
}

/**
 * 고를 보기 번호. 순수 로직이라 단위 테스트로 검증한다.
 *
 * @param {{index:number, raw:string, norm:string}[]} choices
 * @param {string|null} answer 정답(모르면 null)
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

/**
 * 클래스 페이지에서 다음에 눌러야 할 단계를 고른다.
 * 잠기지 않고, 아직 시도하지 않은 것 중 STAGE_ORDER 순서가 가장 앞선 것.
 *
 * @param {{i:number,name:string,locked:boolean,open:boolean,stages:object[]}[]} units
 * @param {Set<string>} tried  이미 눌러 본 단계 key
 * @returns {{action:'open'|'stage'|'none', unit?:object, stage?:object}}
 */
export function nextClassAction(units, tried) {
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
      const ia = STAGE_ORDER.indexOf(a.title);
      const ib = STAGE_ORDER.indexOf(b.title);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return { action: 'stage', unit: u, stage: open[0] };
  }
  return { action: 'none' };
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

/** 입력형 문제에 정답을 써 넣는다 (값 설정 + input/change 이벤트). */
async function fillInput(d, value) {
  return d.evalBool(`
    var el = document.querySelector('[data-cc-input="1"]');
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

export async function grammar(d, answerDict, stop) {
  d.log('[문법] 시작');

  const dict = answerDict && answerDict.size ? answerDict : await pageDict(d);
  const lookups = buildLookups(dict);
  if (!lookups) d.log('[문법] 단어장이 없습니다 — 화면의 정답 정보와 채점 결과로 진행합니다.');
  else d.log(`[문법] 매칭 데이터 로드 완료 (${dict.size}개)`);

  const wrongByQid = new Map();
  const triesByQid = new Map();
  const lastPick = new Map();
  const triedStages = new Set();
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

      // ---------------------------------------------- 문법 클래스 페이지
      if (state.kind === 'class') {
        if (!CONFIG.driveClassPage) {
          d.log('[문법] 클래스 페이지입니다. 학습할 단계를 직접 열고 다시 실행하세요.');
          stop.set();
          break;
        }
        const act = nextClassAction(state.units, triedStages);
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
          d.log(`[문법] '${act.unit.name}' — ${act.stage.title} 시작`);
          await clickTagged(d, 'data-cc-stage', act.stage.key, false);
        }
        if (await stop.await(1500)) break;
        continue;
      }

      if (state.kind === 'end') {
        d.log('[문법] 종료 화면 감지 -> 끝');
        stop.set();
        break;
      }

      // ---------------------------------------------- 문제 화면이 아닌 경우
      if (state.kind === 'idle' || (!state.choices.length && !state.hasInput)) {
        if ((state.next || state.kind === 'idle') && (await d.evalBool(CLICK_NEXT_JS))) {
          idleStreak = 0;
        } else {
          idleStreak++;
          if (idleStreak === 15) {
            d.log('[문법] 문제도 버튼도 찾지 못했습니다. CONFIG.debug 를 켜고 다시 실행해 보세요.');
          }
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

      // 채점 결과 반영: 직전에 고른 보기가 틀렸으면 기억해 둔다.
      if (state.feedback === 'wrong' && lastQid && lastPick.has(lastQid)) {
        const picked = lastPick.get(lastQid);
        if (!wrongByQid.has(lastQid)) wrongByQid.set(lastQid, new Set());
        wrongByQid.get(lastQid).add(picked);
        if (CONFIG.debug) d.log(`[문법] 오답 기억: 보기 ${picked + 1}`);
      }
      // 채점이 끝난 문항이면 다음으로 넘긴다.
      if (state.feedback !== 'none') {
        await d.evalBool(CLICK_NEXT_JS);
        if (await stop.await(600)) break;
        continue;
      }

      const qid = state.qid;
      const tries = triesByQid.get(qid) || 0;
      if (tries >= CONFIG.maxTryPerQuestion) {
        await d.evalBool(CLICK_NEXT_JS);
        triesByQid.set(qid, 0);
        wrongByQid.delete(qid);
        if (await stop.await(400)) break;
        continue;
      }
      triesByQid.set(qid, tries + 1);

      // 정답: 화면에 들어 있는 것 > 단어장
      const answer = state.answer || lookupAnswer(state.question, lookups);

      // ---------------------------------------------- 입력형
      if (!state.choices.length && state.hasInput) {
        if (!answer) {
          d.log('[문법] 정답을 알 수 없는 입력형 문제 — 건너뜁니다.');
          await d.evalBool(CLICK_NEXT_JS);
          if (await stop.await(600)) break;
          continue;
        }
        await fillInput(d, answer);
        if (await stop.await(300)) break;
        await d.evalBool(CLICK_NEXT_JS);
        if (await stop.await(700)) break;
        continue;
      }

      // ---------------------------------------------- 보기 선택형
      if (state.type === 'match' || state.type === 'group') {
        d.log(`[문법] 아직 지원하지 않는 문제 유형(${state.type}) — 건너뜁니다.`);
        await d.evalBool(CLICK_NEXT_JS);
        if (await stop.await(700)) break;
        continue;
      }

      const pick = pickChoice(state.choices, answer, wrongByQid.get(qid) || new Set());
      if (pick === null) {
        if (await stop.await(400)) break;
        continue;
      }

      if (CONFIG.debug) {
        const label = (state.choices.find((c) => c.index === pick) || {}).raw || '';
        d.log(
          `[문법] (${state.type}) '${state.question.slice(0, 40)}' 보기 ${state.choices.length}개 ` +
            `-> ${pick + 1}번 '${label.slice(0, 20)}'${answer ? ' (정답 확인)' : ' (추정)'}`,
        );
      }

      lastPick.set(qid, pick);
      lastQid = qid;

      const clicked = await clickTagged(d, 'data-cc-opt', pick, ignoredClicks >= TRUSTED_AFTER);
      if (!clicked) {
        ignoredClicks++;
        if (await stop.await(400)) break;
        continue;
      }

      if (await stop.await(700)) break;
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
    d.log('[문법] 종료');
  }
}
