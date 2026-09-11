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
  loadSettleMs: 600,     // 화면의 항목이 다 로드됐는지 확인할 때 두 번 재는 간격
};

/** 같은 안내 창이 이만큼 연달아 다시 뜨면 그만 누르고 멈춘다. */
const MODAL_REPEAT_LIMIT = 5;

/** 개념 톡 해설 음성을 이만큼(0.7초 단위) 기다려도 안 끝나면 알린다. */
const TALK_WAIT_LIMIT = 60;

/** 해설 음성을 이만큼(0.7초 단위) 기다린 뒤에는 사이트 방식대로 끝내고 진행한다. */
const TALK_AUDIO_SKIP_AFTER = 3;

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
if (vis(any('input[name="login_id"], input[name="login_pwd"], #login_id, #login_pwd'))) {
    return { kind: 'login' };
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
  if (data.kind === 'class' || data.kind === 'end' || data.kind === 'idle') return data;
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
export function splitPicks(raw) {
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
export function nextPickIndex(choices, wanted) {
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
export function nextScrambleIndex(answer, tiles, placed) {
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
export function splitBlanks(raw) {
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
export function fillValues(count, answer, hint) {
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
            if (/학습 ?시작/.test(t)) score = 6;
            else if (/시작/.test(t)) score = 5;
            else if (/재시도|다시/.test(t)) score = 5;   // 소리를 못 받았을 때의 '재시도'
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
 * 개념 톡의 해설 음성을 사이트 방식대로 끝낸다.
 *
 * 사이트 스크립트(grammar_talk.js)를 보면:
 *   - 카드는 소리가 끝날 때까지 'wait' 클래스를 달고 있고, 그 동안 Enter·'계속하기'를 받지 않는다.
 *   - 다음 단계로 넘기는 코드는 오디오의 **pause** 이벤트에 걸려 있다
 *     (재생 위치를 확인하던 부분은 사이트에서 주석 처리되어 있어, 멈추기만 하면 넘어간다).
 *   - 카드나 스피커 아이콘(.talk-audio)을 누르면 사이트가 그 오디오를 잡고 재생/정지를 토글한다.
 * 그래서 스피커를 눌러 사이트가 오디오를 잡게 한 뒤 pause 를 알려 준다.
 * 휴대폰처럼 자동 재생이 막힌 화면에서도 학습이 멈추지 않게 하기 위한 것이다.
 */
async function skipTalkAudio(d) {
  return d.evalBool(`
    var cards = document.querySelectorAll('.talk-card');
    var i = (typeof card_idx !== 'undefined' && card_idx >= 0) ? card_idx : 0;
    var card = cards[i];
    if (!card) return false;
    var done = false;
    var btn = card.querySelector('.talk-audio');
    if (btn) { btn.click(); done = true; }
    try {
      if (window.audio && typeof window.audio.pause === 'function') {
        window.audio.pause();
        window.audio.dispatchEvent(new Event('pause'));
        done = true;
      }
    } catch (e) {}
    return done;
  `);
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
  const modalRetry = new Map();   // 확인 창을 거친 단계를 다시 눌러 본 횟수
  let talkWait = 0;               // 개념 톡 해설 음성을 기다린 횟수
  let talkAudioSkipped = null;    // 소리를 넘긴 카드(같은 카드에서 두 번 넘기지 않는다)
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
          if (talkWait === 1) d.log('[문법] 개념 톡 해설 음성이 끝나기를 기다리는 중…');
          // 잠깐 기다려도 안 끝나면(자동 재생이 막힌 화면 등) 사이트 방식대로 소리를 끝낸다
          if (talkWait >= TALK_AUDIO_SKIP_AFTER && talkAudioSkipped !== state.sig) {
            talkAudioSkipped = state.sig;
            if (await skipTalkAudio(d)) d.log('[문법] 해설 음성을 넘기고 다음으로 진행합니다.');
          }
          if (talkWait > TALK_WAIT_LIMIT) {
            d.log('[문법] 해설 음성이 끝나지 않습니다 — 소리가 나오는지 확인해 주세요.');
            talkWait = 0;
            talkStuck++;
          }
          if (await stop.await(700)) break;
          continue;
        }
        talkWait = 0;

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
