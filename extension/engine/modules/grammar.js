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
  // 문법 문제 화면의 '채점하기' (실제 마크업: .btn.btn-gclass.btn-next-card)
  '.flip-card.showing .btn-next-card', '.btn-next-card',
  '.flip-card.showing .default-btn-body .btn-gclass',
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
        ['scramble', '.scramble-body .scramble-word'],
        ['group', '.grouping-body .grouping-item'],
        ['match', '.match-content .match-body .match-item']
    ];
    for (var g = 0; g < groups.length; g++) {
        var els = it.querySelectorAll(groups[g][1]);
        var keep = [];
        for (var j = 0; j < els.length; j++) if (vis(els[j]) && optTxt(els[j])) keep.push(els[j]);
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
                opts.push({ i: k, key: j + '_' + k, text: txt(labels[k]) });
            }
            // 줄 이름: 라디오 라벨 텍스트를 뺀 나머지
            var name = txt(row);
            for (var k = 0; k < opts.length; k++) name = name.replace(opts[k].text, ' ');
            rows.push({
                i: j,
                text: name.replace(/\s+/g, ' ').trim(),
                options: opts,
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
                bucket.push({
                    i: j,
                    text: txt(cells[j]),
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
            choices.push({ i: j, text: optTxt(found[j]) });
            var scls = ' ' + found[j].className + ' ';
            if (scls.indexOf(' selected ') >= 0 || scls.indexOf(' active ') >= 0
                || scls.indexOf(' checked ') >= 0) {
                selectedIdx = j;
            }
        }
    }

    // 입력형에 이미 답을 써 넣었는지
    var filled = !!(input && (input.value || '').trim());

    if (done && !choices.length && !input && !rows.length && !left.length && !tiles.length) continue;

    var sig = question + '#' + selectedIdx + (filled ? '+' : '');
    for (var j = 0; j < choices.length; j++) sig += '|' + choices[j].text;
    for (var j = 0; j < rows.length; j++) sig += '|r' + rows[j].text;
    for (var j = 0; j < left.length; j++) sig += '|l' + left[j].text + (left[j].done ? '*' : '');
    for (var j = 0; j < right.length; j++) sig += '|R' + right[j].text + (right[j].done ? '*' : '');
    for (var j = 0; j < tiles.length; j++) sig += '|t' + tiles[j].text + (tiles[j].used ? '*' : '');

    var qid = question;
    for (var j = 0; j < choices.length; j++) qid += '|' + choices[j].text;

    return {
        kind: 'quiz', type: type, qid: qid, sig: sig,
        question: question, answer: answer,
        choices: choices, selectedIdx: selectedIdx, filled: filled,
        hasInput: !!input, opening: opening,
        rows: rows, left: left, right: right, tiles: tiles,
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
    selectedIdx: typeof data.selectedIdx === 'number' ? data.selectedIdx : -1,
    filled: !!data.filled,
    opening: !!data.opening,
    feedback: data.feedback || 'none',
    next: !!data.next,
    choices: (data.choices || [])
      .filter((c) => c && (c.text || '').trim())
      .map((c) => ({ index: c.i, raw: c.text.trim(), norm: N.mnorm(c.text.trim()) })),
    rows: (data.rows || []).map((r) => ({
      index: r.i,
      text: (r.text || '').trim(),
      done: !!r.done,
      options: (r.options || []).map((o) => ({
        index: o.i, key: o.key, raw: (o.text || '').trim(), norm: N.mnorm(o.text || ''),
      })),
    })),
    left: (data.left || []).map((c) => ({ index: c.i, raw: (c.text || '').trim(), done: !!c.done })),
    right: (data.right || []).map((c) => ({ index: c.i, raw: (c.text || '').trim(), done: !!c.done })),
    tiles: (data.tiles || []).map((t) => ({
      index: t.i, raw: (t.text || '').trim(), norm: N.mnorm(t.text || ''), used: !!t.used,
    })),
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

/**
 * 어순 배열: 다음에 누를 타일 번호.
 * 정답 문장을 토큰으로 끊어, 지금까지 고른 개수만큼 건너뛴 다음 단어와 같은 타일을 찾는다.
 * 정답을 모르면 아직 안 쓴 첫 타일(왼쪽부터)을 고른다.
 *
 * @param {string|null} answer 정답 문장
 * @param {{index:number, raw:string, norm:string, used:boolean}[]} tiles
 * @param {number[]} clicked 지금까지 누른 타일 번호(순서대로)
 */
export function nextScrambleIndex(answer, tiles, clicked) {
  const open = (tiles || []).filter((t) => !t.used && !clicked.includes(t.index));
  if (!open.length) return null;

  const words = answer ? N.splitTargetWords(answer) : [];
  if (words.length) {
    const need = words[clicked.length];
    if (need === undefined) return null;         // 문장 완성
    const nn = N.wnorm(need);
    const exact = open.find((t) => N.wnorm(t.raw) === nn);
    if (exact) return exact.index;
    // 타일이 여러 토큰을 담는 경우("without." 처럼) 앞부분만 맞아도 받아준다
    const part = open.find((t) => {
      const tn = N.wnorm(t.raw);
      return tn && nn && (tn.startsWith(nn) || nn.startsWith(tn));
    });
    if (part) return part.index;
  }
  return open[0].index;
}

/**
 * 짝맞추기: 다음에 시도할 (왼쪽, 오른쪽) 짝.
 * 이미 맞춘 칸(done)과 이미 틀린 조합(failed)은 건너뛴다.
 *
 * @param {{index:number, raw:string, done:boolean}[]} left
 * @param {{index:number, raw:string, done:boolean}[]} right
 * @param {Set<string>} failed "l_r" 형태로 저장한 실패 조합
 */
export function nextPairAttempt(left, right, failed) {
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
export function nextGroupPick(rows, answer, wrongByRow) {
  for (const row of rows || []) {
    if (row.done || !row.options.length) continue;
    const wrong = (wrongByRow && wrongByRow.get(row.index)) || new Set();
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
  const scrambleClicks = new Map();   // 문제별로 지금까지 누른 타일 순서
  const failedPairs = new Map();      // 문제별로 틀린 짝 조합
  const wrongByRow = new Map();       // 문제별 · 줄별로 틀린 보기
  let lastGroupPick = null;
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
      if (state.opening) {
        // 인라인 보기 상자를 막 열었다 — 다음 바퀴에서 보기를 읽는다
        if (await stop.await(400)) break;
        continue;
      }

      const hasWork = state.choices.length || state.hasInput ||
        (state.rows || []).length || (state.left || []).length || (state.tiles || []).length;
      if (state.kind === 'idle' || !hasWork) {
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

      // 분류형: 방금 고른 줄이 오답으로 표시되면 그 보기를 기억한다.
      if (lastGroupPick && state.type === 'group') {
        const row = (state.rows || []).find((r) => r.index === lastGroupPick.row);
        if (row && row.done) {
          const map = wrongByRow.get(lastGroupPick.qid);
          if (map) {
            if (!map.has(row.index)) map.set(row.index, new Set());
            map.get(row.index).add(lastGroupPick.option);
          }
        }
        lastGroupPick = null;
      }

      // 채점 결과 반영: 직전에 고른 보기가 틀렸으면 기억해 둔다.
      if (state.feedback === 'wrong' && lastQid && lastPick.has(lastQid)) {
        const picked = lastPick.get(lastQid);
        if (!wrongByQid.has(lastQid)) wrongByQid.set(lastQid, new Set());
        wrongByQid.get(lastQid).add(picked);
        if (CONFIG.debug) d.log(`[문법] 오답 기억: 보기 ${picked + 1}`);
      }
      // 채점이 끝난 문항이면 다음으로 넘긴다.
      // (분류·짝맞추기는 줄/칸 단위로 채점되므로 문항 단위 채점만 본다)
      if (state.feedback !== 'none' && state.type !== 'group' && state.type !== 'match') {
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
        if (state.filled) {
          await d.evalBool(CLICK_NEXT_JS);          // 이미 써 넣었다 -> 채점하기
          if (await stop.await(700)) break;
          continue;
        }
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

      // ---------------------------------------------- 어순 배열
      if (state.type === 'scramble') {
        const clicked = scrambleClicks.get(qid) || [];
        const tile = nextScrambleIndex(answer || null, state.tiles, clicked);
        if (tile === null) {
          // 문장 완성 -> 채점/다음
          scrambleClicks.delete(qid);
          await d.evalBool(CLICK_NEXT_JS);
          if (await stop.await(700)) break;
          continue;
        }
        if (CONFIG.debug) {
          const t = state.tiles.find((x) => x.index === tile);
          d.log(`[문법] (어순) ${clicked.length + 1}번째 -> '${(t && t.raw) || ''}'`);
        }
        scrambleClicks.set(qid, clicked.concat([tile]));
        await clickTagged(d, 'data-cc-opt', tile, ignoredClicks >= TRUSTED_AFTER);
        if (await stop.await(400)) break;
        continue;
      }

      // ---------------------------------------------- 분류형 (줄마다 라디오)
      if (state.type === 'group') {
        if (!wrongByRow.has(qid)) wrongByRow.set(qid, new Map());
        const pick = nextGroupPick(state.rows, answer, wrongByRow.get(qid));
        if (!pick) {
          await d.evalBool(CLICK_NEXT_JS);
          if (await stop.await(700)) break;
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
          if (await stop.await(700)) break;
          continue;
        }
        await clickTagged(d, 'data-cc-left', pair.left, ignoredClicks >= TRUSTED_AFTER);
        if (await stop.await(250)) break;
        await clickTagged(d, 'data-cc-right', pair.right, ignoredClicks >= TRUSTED_AFTER);
        if (await stop.await(600)) break;

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

      // 이미 하나를 골라 둔 상태면 채점하기를 눌러 결과를 받는다.
      if (state.selectedIdx >= 0) {
        await d.evalBool(CLICK_NEXT_JS);
        if (await stop.await(800)) break;
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
