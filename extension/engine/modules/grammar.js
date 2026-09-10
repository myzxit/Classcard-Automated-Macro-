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
  loadSettleMs: 600,     // 화면의 항목이 다 로드됐는지 확인할 때 두 번 재는 간격
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
// 설명 카드(.talk-card)를 Enter 로 한 장씩 넘기는 화면. 중간에 객관식/빈칸이 섞여 있다.
var talkCards = document.querySelectorAll('.talk-card');
var shown = [];
for (var i = 0; i < talkCards.length; i++) if (vis(talkCards[i])) shown.push(talkCards[i]);
// 카드가 하나도 안 보이면 개념 톡 화면이 아니다(끝났거나 다른 화면).
// 여기서 걸러 두지 않으면 종료 화면을 개념 톡으로 오인한다.
if (shown.length) {
    var last = shown[shown.length - 1];

    // 빈칸 채우기: 아래 .select-body 에서 고른다
    var picks = [];
    var sopts = document.querySelectorAll('.select-body .select-option');
    for (var i = 0; i < sopts.length; i++) if (vis(sopts[i])) picks.push(sopts[i]);

    // 객관식: 마지막(현재) 카드 안의 보기
    var talkType = picks.length ? 'talk-select' : '';
    if (!picks.length && last) {
        var oi = last.querySelectorAll('.content-row.option-item');
        for (var i = 0; i < oi.length; i++) if (vis(oi[i])) picks.push(oi[i]);
        if (picks.length) talkType = 'talk-option';
    }

    var tchoices = [];
    for (var i = 0; i < picks.length; i++) {
        picks[i].setAttribute('data-cc-opt', String(i));
        tchoices.push({ i: i, text: txt(picks[i]) });
    }

    // 지금 채워야 할 빈칸의 번호 (페이지 정답 데이터의 인덱스로 쓰인다)
    // 보기가 없고 직접 써 넣어야 하는 빈칸(키보드가 올라오는 화면)도 여기서 모은다.
    var cnt = -1;
    var tinputs = [];
    var blanks = document.querySelectorAll('.talk-card .user-text, .talk-card input[type="text"], .talk-card textarea');
    for (var i = 0; i < blanks.length; i++) {
        if (!vis(blanks[i]) || blanks[i].disabled || blanks[i].readOnly) continue;
        var dc = blanks[i].getAttribute('data-cnt');
        var bn = dc === null ? -1 : parseInt(dc, 10);
        var filled = !!(blanks[i].value || '').trim();
        blanks[i].setAttribute('data-cc-tinput', String(tinputs.length));
        tinputs.push({ i: tinputs.length, cnt: bn, filled: filled });
        if (!filled && cnt < 0) cnt = bn;                  // 이미 채워진 칸은 건너뛴다
    }

    // 빈칸에 무엇이 써졌는지 / 고른 표시가 났는지 — 클릭이 먹혔는지 판단하는 근거
    var written = '';
    var uts = document.querySelectorAll('.talk-card .user-text');
    for (var i = 0; i < uts.length; i++) {
        if (vis(uts[i])) written += '|' + (uts[i].value || '') + (uts[i].className || '');
    }
    for (var i = 0; i < picks.length; i++) written += '#' + (picks[i].className || '');

    // 바로 다음 카드의 해설에 정답 단서가 들어 있다.
    // (예: 빈칸 '___를 강조' -> 다음 카드 "…해석해서 동사의 뜻을 강조해 줘요.")
    var upcoming = '';
    if (last) {
        var nx = last.nextElementSibling;
        while (nx && !(nx.className || '').match(/talk-card/)) nx = nx.nextElementSibling;
        if (nx) {
            var cr = nx.querySelector('.content-row.correct');
            upcoming = txt(cr || nx);
        }
    }

    // 카드 아래의 '계속하기 (Enter)' 링크. Enter 가 안 먹는 기기(폰)에서는 이걸 누른다.
    var cont = false;
    var links = document.querySelectorAll('a, .btn-next-talk, .talk-next, .btn-talk-next');
    for (var i = 0; i < links.length; i++) {
        if (!vis(links[i])) continue;
        var lt = (links[i].textContent || '');
        if (lt.indexOf('계속하기') < 0 && lt.indexOf('다음으로') < 0) continue;
        links[i].setAttribute('data-cc-cont', '1');
        cont = true;
    }

    var talkKey = shown.length + '|' + (last ? (last.getAttribute('data-idx') || '') : '');
    return {
        kind: 'talk', type: talkType,
        qid: talkKey,
        sig: talkKey + '|' + tchoices.length + written,
        choices: tchoices, cards: talkCards.length, shown: shown.length,
        upcoming: upcoming, cnt: cnt, cont: cont, inputs: tinputs
    };
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
                opts.push({ i: k, key: j + '_' + k, text: txt(labels[k]) });
            }
            // 줄 이름: 라디오 라벨 텍스트를 뺀 나머지
            var name = txt(row);
            for (var k = 0; k < opts.length; k++) name = name.replace(opts[k].text, ' ');
            rows.push({
                i: j,
                text: name.replace(/\\s+/g, ' ').trim(),
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

    return {
        kind: 'quiz', type: type, qid: qid, sig: sig,
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
  if (data.kind === 'class' || data.kind === 'end' || data.kind === 'idle') return data;
  if (data.kind === 'talk') {
    return {
      ...data,
      choices: (data.choices || [])
        .filter((c) => c && (c.text || '').trim())
        .map((c) => ({ index: c.i, raw: c.text.trim(), norm: N.mnorm(c.text.trim()) })),
    };
  }
  return {
    kind: 'quiz',
    type: data.type || '',
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
var out = [];
var ALL = null;
try { ALL = (window.__ccGAll && typeof window.__ccGAll === 'object') ? window.__ccGAll : null; } catch (e) {}

// 빈칸이 들어 있는 카드의 정답을 그 카드 번호로 찾는다 (사이트가 채점에 쓰는 arr_card).
var cards = document.querySelectorAll('.talk-card');
function answerFor(card) {
    var idx = -1;
    for (var i = 0; i < cards.length; i++) if (cards[i] === card) idx = i;
    if (idx < 0) return null;
    if (typeof arr_card !== 'undefined' && arr_card && arr_card[idx] && arr_card[idx].answer != null) {
        return String(arr_card[idx].answer);
    }
    if (ALL && ALL.talk[idx] != null) return String(ALL.talk[idx]);
    return null;
}

var boxes = document.querySelectorAll('[data-cc-tinput]');
for (var i = 0; i < boxes.length; i++) {
    var el = boxes[i];
    if ((el.value || '').trim()) continue;                 // 이미 쓴 칸은 그대로 둔다
    var card = el.closest ? el.closest('.talk-card') : null;
    var raw = card ? answerFor(card) : null;
    if (raw == null) continue;
    var parts = String(raw).split(/[|;]/).map(function (x) {
        return x.replace(/\\s*\\/\\s*/g, ' ').replace(/\\s+/g, ' ').trim();
    }).filter(Boolean);
    var dc = el.getAttribute('data-cnt');
    var n = dc === null ? -1 : parseInt(dc, 10);
    var v = (n >= 0 ? parts[n] : null) || parts[i] || parts[0];
    if (!v) continue;
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    out.push({ i: Number(el.getAttribute('data-cc-tinput')), value: v });
}
return out;
`;

/** 페이지 정답 문자열을 조각으로 나눈다 (빈칸별 ';', 복수정답 '|'). */
export function splitAnswers(raw) {
  return String(raw == null ? '' : raw)
    .split(/[|;]/)
    .map((x) => x.replace(/\s*\/\s*/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** 정답 후보들 중 하나와 실제로 맞는 보기를 고른다. 맞는 게 없으면 null. */
export function pickByAnswers(choices, answers, wrong) {
  const open = (choices || []).filter((c) => !wrong || !wrong.has(c.index));
  const list = (answers || []).map((a) => N.mnorm(a).toLowerCase()).filter(Boolean);
  if (!open.length || !list.length) return null;

  // 1) 정확히 같은 보기부터. ('동사' 정답이 '동사원형' 보기에 걸리면 안 된다)
  for (const am of list) {
    const hit = open.find((c) => c.norm.toLowerCase() === am);
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
export const FIND_ANSWER_JS = (options, cnt) => `
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
export function pickTalkAnswer(choices, upcoming) {
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
export function nextClassAction(units, tried, prefer) {
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
export function fillValues(count, answer, hint) {
  if (count <= 0) return [];
  if (answer) {
    const words = N.splitTargetWords(answer).filter((w) => w.trim());
    if (count === 1) return [answer];
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
        }
        if (await stop.await(CONFIG.stepDelayMs)) break;
        continue;
      }

      // 새 화면(단계)에 들어왔으면 그 화면의 정답을 전부 한 번에 읽어 둔다.
      // 읽어 뒀으면(fastScreen) 문제마다 찍어 볼 필요가 없으므로 기다리지 않고 바로 푼다.
      if (state.kind === 'talk' || state.kind === 'quiz') {
        const screen = state.kind + '|' + (await d.currentUrl());
        if (screen !== checkedScreen) {
          checkedScreen = screen;
          const label = state.kind === 'talk' ? '개념 톡' : '문제 화면';
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
          if (stop.isSet) break;

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
        }
      }

      // ---------------------------------------------- 개념 톡 (설명 카드)
      if (state.kind === 'talk') {
        if (state.choices.length) {
          const tried = wrongByQid.get(state.qid) || new Set();
          const open = state.choices.filter((c) => !tried.has(c.index));

          // 1순위: 사이트가 채점에 쓰는 정답(arr_card), 2순위: 전역 훑기,
          // 3순위: 다음 카드 해설, 4순위: 안 해 본 보기
          let pick = null;
          let how = '추정';

          const page = await readPageAnswer(d);
          if (page) {
            // 빈칸이 여러 개면 지금 채울 칸의 정답부터 본다
            const ordered = state.cnt >= 0 && page.answers[state.cnt]
              ? [page.answers[state.cnt]].concat(page.answers)
              : page.answers;
            const hit = pickByAnswers(state.choices, ordered, tried);
            if (hit !== null) { pick = hit; how = `사이트 정답(${page.src})`; }
          }

          if (pick === null) {
            const scanned = await findAnswerInPage(
              d, state.choices.map((c) => c.raw), typeof state.cnt === 'number' ? state.cnt : -1,
            );
            if (scanned) {
              const hit = state.choices.find((c) => N.mnorm(c.raw) === N.mnorm(scanned));
              if (hit && !tried.has(hit.index)) { pick = hit.index; how = '페이지 정답 데이터'; }
            }
          }
          if (pick === null) {
            pick = pickTalkAnswer(open, state.upcoming);
            if (pick !== null) how = '해설에서 정답 확인';
          }
          if (pick === null) pick = pickChoice(state.choices, null, tried);
          const byHint = how !== '추정';

          if (pick !== null) {
            const key = `${state.qid}#${pick}`;
            const tries = (talkTries.get(key) || 0) + 1;
            talkTries.set(key, tries);
            const trusted = tries >= 2;   // 첫 시도가 먹히지 않으면 신뢰된 클릭으로

            if (CONFIG.debug) {
              const label = (state.choices.find((c) => c.index === pick) || {}).raw || '';
              d.log(`[문법] (개념 톡) 보기 ${pick + 1} '${label.slice(0, 20)}' (${how})` +
                `${trusted ? ' [신뢰된 클릭]' : ''}`);
            }
            await clickTagged(d, 'data-cc-opt', pick, trusted);
            if (await stop.await(pace())) break;

            const after = await readState(d);
            if (after && after.kind === 'talk' && after.sig === state.sig) {
              // 화면이 그대로다. 두 번(합성·신뢰된)까지 눌러 봤으면 오답으로 보고 다음 보기로.
              if (tries >= 2) {
                if (!wrongByQid.has(state.qid)) wrongByQid.set(state.qid, new Set());
                wrongByQid.get(state.qid).add(pick);
                talkStuck = 0;
              } else {
                talkStuck++;
                if (talkStuck === 1) d.log('[문법] 개념 톡 클릭이 한 번 무시됨 -> 신뢰된 클릭으로 재시도');
              }
              if (wrongByQid.get(state.qid) && wrongByQid.get(state.qid).size >= state.choices.length) {
                if (await backToClass('개념 톡에서 더 진행되지 않습니다')) continue;
                d.log('[문법] 개념 톡 보기를 모두 눌러도 넘어가지 않습니다 -> 종료');
                stop.set();
                break;
              }
            } else {
              // 화면이 바뀌었다 = 진행됐다
              talkStuck = 0;
              if (!wrongByQid.has(state.qid)) wrongByQid.set(state.qid, new Set());
              wrongByQid.get(state.qid).add(pick);
            }
            continue;
          }
        }

        // 직접 써 넣어야 하는 빈칸(키보드가 올라오는 화면) — 정답을 써 넣고 확인한다.
        const empty = (state.inputs || []).filter((x) => !x.filled);
        if (empty.length) {
          // 그 칸이 들어 있는 카드의 사이트 정답으로 빈칸을 한 번에 채운다.
          const written = (await d.eval(TALK_FILL_JS)) || [];
          for (const w of written) {
            d.log(`[문법] (개념 톡 입력) ${w.i + 1}번 칸 -> '${w.value}' (사이트 정답)`);
          }
          if (written.length) {
            // 써 넣었으면 Enter(또는 '계속하기')로 확인한다.
            if (state.cont) {
              const hit = await clickTagged(d, 'data-cc-cont', 1, talkStuck >= 1);
              if (!hit) await d.pressEnter();
            } else {
              await d.pressEnter();
            }
            if (await stop.await(pace())) break;
            const afterFill = await readState(d);
            if (afterFill && afterFill.kind === 'talk' && afterFill.sig === state.sig) {
              talkStuck++;
              if (talkStuck >= CONFIG.idleGiveUp) {
                if (await backToClass('개념 톡 입력이 넘어가지 않습니다')) continue;
                d.log('[문법] 개념 톡 입력이 넘어가지 않습니다 -> 종료');
                stop.set();
                break;
              }
            } else {
              talkStuck = 0;
            }
            continue;
          }
          if (!written.length) {
            d.log('[문법] 개념 톡 빈칸의 정답을 찾지 못했습니다 — 그대로 넘깁니다.');
          }
        }

        // 보기가 없으면 다음 설명 카드로 넘긴다.
        // 화면에 '계속하기 (Enter)' 링크가 있으면 그걸 누른다 —
        // 폰에서는 키보드 포커스가 없어 Enter 만으로는 넘어가지 않는 화면이 있다.
        if (state.cont) {
          const hit = await clickTagged(d, 'data-cc-cont', 1, talkStuck >= 1);
          if (!hit) await d.pressEnter();
        } else {
          await d.pressEnter();
        }
        if (await stop.await(pace())) break;

        const after = await readState(d);
        if (after && after.kind === 'talk' && after.sig === state.sig) {
          talkStuck++;
          if (talkStuck === 2) {
            // Enter 가 안 먹는 화면일 수 있어 카드를 눌러 본다
            await d.evalBool(`
              var cards = document.querySelectorAll('.talk-card');
              for (var i = cards.length - 1; i >= 0; i--) {
                if (cards[i].offsetParent !== null) { cards[i].click(); return true; }
              }
              return false;
            `);
          }
          if (talkStuck === 4) {
            // 그래도 안 되면 화면 가운데를 신뢰된 클릭으로 눌러 포커스를 준 뒤 Enter
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
          if (talkStuck) talkStuck = 0;
          if (after && after.kind === 'talk' && CONFIG.debug) {
            d.log(`[문법] (개념 톡) ${after.shown}/${after.cards}장`);
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
      if (tries >= CONFIG.maxTryPerQuestion) {
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
      if (page) {
        answerList = page.answers;
        answer = page.answers[0];
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

      // ---------------------------------------------- 입력형
      if (!state.choices.length && state.hasInput) {
        if (state.filled) {
          await d.evalBool(CLICK_NEXT_JS);          // 이미 다 써 넣었다 -> 채점하기
          if (await stop.await(pace())) break;
          continue;
        }
        const values = (answerList.length === state.inputs.length)
          ? answerList                                   // 빈칸 수와 정답 조각 수가 같으면 그대로
          : fillValues(state.inputs.length, answer, state.hint);
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
        await d.evalBool(CLICK_NEXT_JS);
        if (await stop.await(pace())) break;
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
          if (await stop.await(pace())) break;
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
