package com.classcard.automation.modules

import com.classcard.automation.core.AntiBlur
import com.classcard.automation.core.Driver
import com.classcard.automation.core.Norm
import com.classcard.automation.core.StopFlag
import com.classcard.automation.core.jsStr
import org.json.JSONArray
import org.json.JSONObject

/**
 * 문법훈련(GClass) 자동 풀이 — 확장프로그램 grammar.js 와 같은 로직.
 *
 * 셀렉터는 사용자가 저장해 준 실제 문법 클래스 페이지(www.classcard.net/GClass/…)의
 * HTML 과 style_v2.css 에서 확인한 이름을 그대로 쓴다.
 *
 *  클래스 페이지 : .unit-list > .unit-item[data-idx] > .unit-title
 *                 .unit-content .unit-set-list .set-box (.lock 이면 잠김, .ing 이면 진행중)
 *                 -> 개념 톡 · 연습 문제 A/B · 서술형 문제 · 실전 문제 · 누적오답복습 · Scramble
 *  문제 화면     : .gclass-q-item (+ .correct / .wrong 이 채점 결과)
 *                 .gclass-q-quest                              지문
 *                 .gclass-q-answer-box .gclass-q-answer-text   정답(숨겨져 있어도 읽는다)
 *                 .gclass-q-input .object-body .object         객관식 보기
 *                 .gclass-q-input .inline-box .option-box .option-item   인라인 선택
 *                 .gclass-q-input input / .inline-input-body input       입력형
 *
 * 확인하지 못한 화면(매칭·분류 등)을 위해, 이름을 모를 때 쓰는 구조 기반 폴백도 남겨 둔다.
 * 정답을 못 읽는 문제는 찍고 채점 결과를 기억해서 오답을 지워 나간다.
 */
object Grammar {

    /** 진단용: true 면 문제별 파싱 결과와 클릭 판단을 로그에 출력. */
    var DEBUG = false

    /**
     * 한 동작(보기 클릭·채점하기·Enter·화면 이동) 뒤에 기다리는 시간(ms).
     * 문법훈련은 소리를 읽어 주고 카드가 애니메이션으로 나타나므로, 빨리 누르면
     * 페이지가 아직 못 받는다. 넉넉히 3초를 기다린다.
     */
    var STEP_DELAY_MS = 3000L

    /**
     * 사이트 정답 데이터를 미리 다 읽어 둔 화면에서 쓰는 대기 시간(ms).
     * 찍을 필요가 없으므로 기다리지 않고 바로바로 눌러 한 번에 다 맞춘다.
     */
    var KNOWN_STEP_MS = 700L

    /** 한 문제에서 이만큼 시도해도 넘어가지 않으면 다음 문제로 넘긴다. */
    var MAX_TRY_PER_QUESTION = 6

    /** 문제도 버튼도 못 찾은 채 이만큼 반복하면(≈12초) 끝난 것으로 보고 종료한다. */
    var IDLE_GIVE_UP = 30

    /** 클래스 페이지에서 유닛/단계를 스스로 눌러 진행할지. */
    var DRIVE_CLASS_PAGE = true

    /** 오답이 있으면 '누적오답복습'(틀린 문제만 다시 학습)을 먼저 할지. */
    var REVIEW_WRONG = true

    /** 화면의 항목이 다 로드됐는지 확인할 때 두 번 재는 간격(ms). */
    var LOAD_SETTLE_MS = 600L

    /** 같은 안내 창이 이만큼 연달아 다시 뜨면 그만 누르고 멈춘다. */
    private const val MODAL_REPEAT_LIMIT = 5

    /** 개념 톡 해설 음성을 이만큼(0.7초 단위) 기다려도 안 끝나면 알린다. */
    private const val TALK_WAIT_LIMIT = 60

    /** 해설 음성을 이만큼(0.7초 단위) 기다린 뒤에는 사이트 방식대로 끝내고 진행한다. */
    private const val TALK_AUDIO_SKIP_AFTER = 3

    /** 합성 클릭이 이만큼 무시되면 네이티브(신뢰된) 클릭으로 올린다. */
    private const val TRUSTED_AFTER = 2

    /** 클래스 페이지에서 이 순서로 단계를 진행한다(화면에 나타나는 순서와 같다). */
    val STAGE_ORDER = listOf(
        "개념 톡", "연습 문제 A", "연습 문제 B", "서술형 문제",
        "실전 문제", "누적오답복습", "Scramble",
    )

    /** 보기 하나. */
    /** 개념 톡에서 직접 써 넣어야 하는 빈칸. cnt 는 정답 조각 번호(data-cnt). */
    data class TalkInput(val i: Int, val cnt: Int, val filled: Boolean)

    /** 개념 톡 어순 배열 낱말. */
    data class OrderItem(val index: Int, val raw: String, val picked: Boolean) {
        val norm: String get() = Norm.mnorm(raw)
    }

    /** 개념 톡 빈칸. current 면 지금 채울 칸(.choice). */
    data class TalkBlank(val i: Int, val cnt: Int, val filled: Boolean, val current: Boolean)

    data class Choice(val index: Int, val raw: String) {
        val norm: String = Norm.mnorm(raw)
    }

    /** 클래스 페이지의 단계 한 칸 (개념 톡 / 연습 문제 A …). */
    data class Stage(val key: String, val title: String, val locked: Boolean)

    /** 클래스 페이지의 유닛 한 줄. */
    data class UnitRow(
        val i: Int,
        val name: String,
        val locked: Boolean,
        val hasTitle: Boolean,
        val stages: List<Stage>,
    )

    /** 클래스 페이지에서 다음에 할 일. */
    sealed class ClassAction {
        data class Open(val unit: UnitRow) : ClassAction()
        data class Start(val unit: UnitRow, val stage: Stage) : ClassAction()
        object None : ClassAction()
    }

    /** 분류형 한 줄의 보기. */
    data class RowOption(val index: Int, val raw: String) {
        val norm: String = Norm.mnorm(raw)
    }

    /** 분류형 한 줄. */
    data class Row(
        val index: Int,
        val text: String,
        val done: Boolean,
        val options: List<RowOption>,
    )

    /** 짝맞추기 칸 하나. */
    data class MatchCell(val index: Int, val raw: String, val done: Boolean)

    /** 어순 배열 타일 하나. */
    data class Tile(val index: Int, val raw: String, val used: Boolean) {
        val norm: String = Norm.mnorm(raw)
    }

    private data class State(
        val kind: String,                 // "class" | "end" | "quiz" | "idle" | "login"
        val type: String = "",
        val qid: String = "",
        val sig: String = "",
        val question: String = "",
        val answer: String = "",
        val choices: List<Choice> = emptyList(),
        val hasInput: Boolean = false,
        val blanks: Int = 0,        // 빈칸 수 (배열형은 여러 개)
        val talkInputs: List<TalkInput> = emptyList(),  // 개념 톡에서 직접 써 넣어야 하는 빈칸
        val hint: String = "",      // 화면에 주어진 힌트 단어들
        val selectedIdx: Int = -1,
        val filled: Boolean = false,
        val opening: Boolean = false,
        val feedback: String = "none",
        val hasNext: Boolean = false,
        val units: List<UnitRow> = emptyList(),
        val cards: Int = 0,      // 개념 톡 전체 카드 수
        val shown: Int = 0,      // 개념 톡에서 지금까지 나온 카드 수
        val upcoming: String = "",  // 다음 설명 카드 (정답 단서)
        val cnt: Int = -1,          // 지금 채울 빈칸 번호 (페이지 정답 데이터의 인덱스)
        val cont: Boolean = false,  // '계속하기 (Enter)' 링크가 있는가
        // --- 개념 톡 (grammar_talk.js 기준)
        val talkIdx: Int = -1,               // 지금 카드 번호 (전역 card_idx)
        val ctype: String = "",              // 카드 종류 (data-type)
        val answers: List<String> = emptyList(),   // arr_card[card_idx].answer 를 나눈 것
        val options: List<Choice> = emptyList(),   // 객관식 보기 (.option-item)
        val orders: List<OrderItem> = emptyList(), // 어순 배열 낱말 (.order-item)
        val picks: List<Choice> = emptyList(),     // 빈칸 고르기 보기 (.select-option)
        val talkBlanks: List<TalkBlank> = emptyList(),
        val talkDone: Boolean = false,
        val talkWrong: Boolean = false,
        val talkWaiting: Boolean = false,   // 해설 음성이 끝나기를 기다리는 중
        val rows: List<Row> = emptyList(),
        val left: List<MatchCell> = emptyList(),
        val right: List<MatchCell> = emptyList(),
        val tiles: List<Tile> = emptyList(),
    )

    /** 확장프로그램 grammar.js 의 READ_STATE_JS 와 같은 스크립트. */
    private val READ_STATE_JS = """

        function vis(el) {
            if (!el || el.offsetParent === null) return false;
            var r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        }
        function txt(el) { return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim(); }
        // 보기 텍스트: .option-answer 는 화면에 안 보이는 사본이라 빼고 읽는다
        function optTxt(el) {
            if (!el) return '';
            var c = el.cloneNode(true);
            var dup = c.querySelectorAll('.option-answer');
            for (var i = 0; i < dup.length; i++) dup[i].parentNode.removeChild(dup[i]);
            return (c.textContent || '').replace(/\s+/g, ' ').trim();
        }
        function any(sel) {
            var els = document.querySelectorAll(sel);
            for (var i = 0; i < els.length; i++) if (vis(els[i])) return els[i];
            return null;
        }

        var NEXT_SEL = [".flip-card.showing .btn-next-card",".btn-next-card",".flip-card.showing .default-btn-body .btn-gclass",".study-bottom .btn-next-box .btn-gclass",".study-bottom .btn-next-box a",".btn-next-box .btn-gclass",".btnNextCard",".btn-condition-next",".btn-next",".btn-continue",".btn-quiz-start",".btn-opt-start"].join(',');
        var END_SEL = [".start-opt-body",".end-opt-body",".result-body",".quiz-result","a.btn-go-result"].join(',');

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
        //   - 지금 푸는 카드는 전역 card_idx 가 가리키는 ${'$'}('.talk-card').eq(card_idx) 다.
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
                hint = (hc.textContent || '').replace(/\s+/g, ' ').trim();
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
    """

    private val CLICK_NEXT_JS = """
        function vis(el) {
            if (!el || el.offsetParent === null) return false;
            var r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        }
        var sel = [".flip-card.showing .btn-next-card",".btn-next-card",".flip-card.showing .default-btn-body .btn-gclass",".study-bottom .btn-next-box .btn-gclass",".study-bottom .btn-next-box a",".btn-next-box .btn-gclass",".btnNextCard",".btn-condition-next",".btn-next",".btn-continue",".btn-quiz-start",".btn-opt-start"];
        for (var i = 0; i < sel.length; i++) {
            var els = document.querySelectorAll(sel[i]);
            for (var j = 0; j < els.length; j++) {
                if (vis(els[j]) && els[j].className.indexOf('disabled') < 0) {
                    els[j].click();
                    return true;
                }
            }
        }
        return false;
    """

    private fun parseUnits(arr: JSONArray?): List<UnitRow> {
        if (arr == null) return emptyList()
        val out = mutableListOf<UnitRow>()
        for (i in 0 until arr.length()) {
            val u = arr.optJSONObject(i) ?: continue
            val stages = mutableListOf<Stage>()
            val sarr = u.optJSONArray("stages")
            if (sarr != null) {
                for (j in 0 until sarr.length()) {
                    val s = sarr.optJSONObject(j) ?: continue
                    stages.add(
                        Stage(
                            key = s.optString("key", ""),
                            title = s.optString("title", "").trim(),
                            locked = s.optBoolean("locked", false),
                        )
                    )
                }
            }
            out.add(
                UnitRow(
                    i = u.optInt("i", i),
                    name = u.optString("name", "").trim(),
                    locked = u.optBoolean("locked", false),
                    hasTitle = u.optBoolean("hasTitle", false),
                    stages = stages,
                )
            )
        }
        return out
    }

    private suspend fun readState(d: Driver): State? {
        val data: JSONObject = d.evalObjectOrNull(READ_STATE_JS) ?: return null
        when (data.optString("kind", "")) {
            "class" -> return State(kind = "class", units = parseUnits(data.optJSONArray("units")))
            "end" -> return State(kind = "end")
            "login" -> return State(kind = "login")
        }

        // --- 개념 톡 (grammar_talk.js 기준)
        fun choiceList(key: String): List<Choice> {
            val a = data.optJSONArray(key) ?: return emptyList()
            val out = mutableListOf<Choice>()
            for (i in 0 until a.length()) {
                val o = a.optJSONObject(i) ?: continue
                val raw = o.optString("text", "").trim()
                if (raw.isNotEmpty()) out.add(Choice(o.optInt("i", i), raw))
            }
            return out
        }
        val orders = mutableListOf<OrderItem>()
        data.optJSONArray("orders")?.let { a ->
            for (i in 0 until a.length()) {
                val o = a.optJSONObject(i) ?: continue
                orders.add(
                    OrderItem(o.optInt("i", i), o.optString("text", "").trim(), o.optBoolean("picked", false))
                )
            }
        }
        val talkBlanks = mutableListOf<TalkBlank>()
        data.optJSONArray("blanks")?.let { a ->
            for (i in 0 until a.length()) {
                val o = a.optJSONObject(i) ?: continue
                talkBlanks.add(
                    TalkBlank(
                        i = o.optInt("i", i),
                        cnt = o.optInt("cnt", -1),
                        filled = o.optBoolean("filled", false),
                        current = o.optBoolean("current", false),
                    )
                )
            }
        }

        val choices = mutableListOf<Choice>()
        val arr = data.optJSONArray("choices")
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val raw = o.optString("text", "").trim()
                if (raw.isNotEmpty()) choices.add(Choice(o.optInt("i", i), raw))
            }
        }
        val rows = mutableListOf<Row>()
        data.optJSONArray("rows")?.let { rarr ->
            for (i in 0 until rarr.length()) {
                val r = rarr.optJSONObject(i) ?: continue
                val opts = mutableListOf<RowOption>()
                r.optJSONArray("options")?.let { oarr ->
                    for (j in 0 until oarr.length()) {
                        val o = oarr.optJSONObject(j) ?: continue
                        opts.add(RowOption(o.optInt("i", j), o.optString("text", "").trim()))
                    }
                }
                rows.add(
                    Row(
                        index = r.optInt("i", i),
                        text = r.optString("text", "").trim(),
                        done = r.optBoolean("done", false),
                        options = opts,
                    )
                )
            }
        }

        fun cells(key: String): List<MatchCell> {
            val arr2 = data.optJSONArray(key) ?: return emptyList()
            val out = mutableListOf<MatchCell>()
            for (i in 0 until arr2.length()) {
                val c = arr2.optJSONObject(i) ?: continue
                out.add(MatchCell(c.optInt("i", i), c.optString("text", "").trim(), c.optBoolean("done", false)))
            }
            return out
        }

        val tiles = mutableListOf<Tile>()
        data.optJSONArray("tiles")?.let { tarr ->
            for (i in 0 until tarr.length()) {
                val t = tarr.optJSONObject(i) ?: continue
                tiles.add(Tile(t.optInt("i", i), t.optString("text", "").trim(), t.optBoolean("used", false)))
            }
        }

        return State(
            kind = data.optString("kind", "idle"),
            cards = data.optInt("cards", 0),
            shown = data.optInt("shown", 0),
            upcoming = data.optString("upcoming", "").trim(),
            cnt = data.optInt("cnt", -1),
            cont = data.optBoolean("cont", false),
            talkIdx = data.optInt("idx", -1),
            ctype = data.optString("ctype", ""),
            answers = splitAnswers(data.optString("answer", "")),
            options = choiceList("options"),
            orders = orders,
            picks = choiceList("picks"),
            talkBlanks = talkBlanks,
            talkDone = data.optBoolean("done", false),
            talkWrong = data.optBoolean("wrong", false),
            talkWaiting = data.optBoolean("waiting", false),
            type = data.optString("type", ""),
            qid = data.optString("qid", ""),
            sig = data.optString("sig", ""),
            question = data.optString("question", "").trim(),
            answer = data.optString("answer", "").trim(),
            choices = choices,
            hasInput = data.optBoolean("hasInput", false),
            blanks = data.optJSONArray("inputs")?.length() ?: 0,
            talkInputs = run {
                val arr = data.optJSONArray("inputs")
                val out = ArrayList<TalkInput>()
                if (data.optString("kind", "") == "talk" && arr != null) {
                    for (i in 0 until arr.length()) {
                        val o = arr.optJSONObject(i) ?: continue
                        out.add(
                            TalkInput(
                                i = o.optInt("i", i),
                                cnt = o.optInt("cnt", -1),
                                filled = o.optBoolean("filled", false),
                            )
                        )
                    }
                }
                out
            },
            hint = data.optString("hint", "").trim(),
            selectedIdx = data.optInt("selectedIdx", -1),
            filled = data.optBoolean("filled", false),
            opening = data.optBoolean("opening", false),
            feedback = data.optString("feedback", "none"),
            hasNext = data.optBoolean("next", false),
            rows = rows,
            left = cells("left"),
            right = cells("right"),
            tiles = tiles,
        )
    }

    /**
     * 고를 보기 번호. 순수 로직이라 단위 테스트로 검증한다.
     *
     * @param answer 정답 문자열(모르면 null)
     * @param wrong  이 문제에서 이미 틀린 보기 번호
     */
    fun pickChoice(choices: List<Choice>, answer: String?, wrong: Set<Int>): Int? {
        if (choices.isEmpty()) return null
        val open = choices.filter { it.index !in wrong }
        val pool = open.ifEmpty { choices }   // 전부 틀렸다면(오판) 처음부터 다시

        if (!answer.isNullOrEmpty()) {
            val am = Norm.mnorm(answer)
            if (am.isNotEmpty()) {
                pool.firstOrNull { it.norm == am }?.let { return it.index }
                // 문장 첫 글자 대문자처럼 대소문자만 다른 경우까지 받아준다.
                val lower = am.lowercase()
                pool.firstOrNull { it.norm.lowercase() == lower }?.let { return it.index }
                pool.firstOrNull {
                    val cn = it.norm.lowercase()
                    cn.isNotEmpty() && (lower.contains(cn) || cn.contains(lower))
                }?.let { return it.index }
            }
        }
        return pool.first().index
    }

    /**
     * 어순 배열: 다음에 누를 타일 번호.
     * 정답 문장을 토큰으로 끊어, 지금까지 고른 개수만큼 건너뛴 다음 단어와 같은 타일을 찾는다.
     * 정답을 모르면 아직 안 쓴 첫 타일(왼쪽부터)을 고른다.
     */
    fun nextScrambleIndex(answer: String?, tiles: List<Tile>, clicked: List<Int>): Int? {
        val open = tiles.filter { !it.used && it.index !in clicked }
        if (open.isEmpty()) return null

        val words = if (answer.isNullOrEmpty()) emptyList() else Norm.splitTargetWords(answer)
        if (words.isNotEmpty()) {
            if (clicked.size >= words.size) return null   // 문장 완성
            val need = Norm.wnorm(words[clicked.size])
            open.firstOrNull { Norm.wnorm(it.raw) == need }?.let { return it.index }
            // 타일이 여러 토큰을 담는 경우("without." 처럼) 앞부분만 맞아도 받아준다
            open.firstOrNull {
                val tn = Norm.wnorm(it.raw)
                tn.isNotEmpty() && need.isNotEmpty() && (tn.startsWith(need) || need.startsWith(tn))
            }?.let { return it.index }
        }
        return open.first().index
    }

    /** 짝맞추기에서 다음에 시도할 (왼쪽, 오른쪽) 짝. 없으면 null. */
    fun nextPairAttempt(
        left: List<MatchCell>, right: List<MatchCell>, failed: Set<String>,
    ): Pair<Int, Int>? {
        for (l in left) {
            if (l.done) continue
            for (r in right) {
                if (r.done) continue
                if ("${l.index}_${r.index}" in failed) continue
                return l.index to r.index
            }
        }
        return null
    }

    /**
     * 분류형: 아직 답하지 않은 줄과 그 줄에서 고를 보기.
     * 정답 문장에 "줄이름 - 보기" 가 들어 있으면 그것을 쓰고, 없으면 안 틀린 보기를 고른다.
     */
    fun nextGroupPick(
        rows: List<Row>, answer: String?, wrongByRow: Map<Int, Set<Int>>,
    ): Pair<Int, Int>? {
        for (row in rows) {
            if (row.done || row.options.isEmpty()) continue
            val wrong = wrongByRow[row.index] ?: emptySet()
            var hint: String? = null
            if (!answer.isNullOrEmpty() && row.text.isNotEmpty()) {
                val am = Norm.mnorm(answer)
                val rm = Norm.mnorm(row.text)
                val at = if (rm.isEmpty()) -1 else am.indexOf(rm)
                if (at >= 0) {
                    // 줄 이름 바로 뒤에 '가장 먼저' 나오는 보기가 그 줄의 답이다.
                    // (뒤쪽에 다른 줄의 답이 이어져 있어도 앞선 것을 고른다)
                    val from = at + rm.length
                    val rest = am.substring(from, minOf(am.length, from + 40))
                    hint = row.options
                        .mapNotNull { o ->
                            val at2 = if (o.norm.isEmpty()) -1 else rest.indexOf(o.norm)
                            if (at2 >= 0) at2 to o else null
                        }
                        .minByOrNull { it.first }?.second?.raw
                }
            }
            val pick = pickChoice(row.options.map { Choice(it.index, it.raw) }, hint, wrong)
            if (pick != null) return row.index to pick
        }
        return null
    }

    /**
     * 사이트가 채점에 쓰는 정답 데이터를 그대로 읽는다.
     *
     * 실제 소스(classcard.net/scripts/v2/gclass_test.js, grammar_talk.js)를 확인한 결과:
     *   문제 화면 : var answer = obj_answer['q' + card_idx]  <- arr_answer[{card_idx, answer}]
     *   개념 톡   : var card_obj = arr_card[card_idx]; card_obj.answer
     * 즉 정답은 페이지 전역 arr_answer / arr_card 에 들어 있다. 그것을 그대로 쓴다.
     */
    private val READ_PAGE_ANSWER_JS = """

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
    """

    /**
     * 이 화면에 정답 데이터가 실려 있는지 확인한다.
     * 단계(개념 톡·연습 문제·서술형·실전·누적오답복습)마다 페이지가 새로 열리고
     * 정답 데이터도 새로 실리므로, 새 화면에 들어갈 때마다 한 번 확인해 로그에 남긴다.
     */
    private val CHECK_ANSWER_SOURCE_JS = """

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
    """

    /**
     * 개념 톡에서 직접 써 넣어야 하는 빈칸을, 그 카드의 사이트 정답으로 한 번에 채운다.
     * 어떤 칸에 무엇을 썼는지 [{i, value}] 로 돌려준다.
     */
    private val TALK_FILL_JS = """

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
        return x.replace(/\s*\/\s*/g, ' ').replace(/\s+/g, ' ').trim();
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
    """

    /** 정답 문자열을 조각으로 나눈다 (빈칸별 ';', 복수정답 '|'). */
    fun splitAnswers(raw: String?): List<String> =
        (raw ?: "").split(Regex("[|;]"))
            .map { it.replace(Regex("\\s*/\\s*"), " ").replace(Regex("\\s+"), " ").trim() }
            .filter { it.isNotEmpty() }

    /** 정답 후보들 중 하나와 실제로 맞는 보기를 고른다. 맞는 게 없으면 null. */
    fun pickByAnswers(choices: List<Choice>, answers: List<String>, wrong: Set<Int>): Int? {
        val open = choices.filter { it.index !in wrong }
        val list = answers.map { Norm.mnorm(it).lowercase() }.filter { it.isNotEmpty() }
        if (open.isEmpty() || list.isEmpty()) return null

        // 1) 정확히 같은 보기부터. ('동사' 정답이 '동사원형' 보기에 걸리면 안 된다)
        for (am in list) {
            open.firstOrNull { it.norm.lowercase() == am }?.let { return it.index }
        }
        // 2) 정확히 같은 게 없을 때만 포함 관계로
        for (am in list) {
            open.firstOrNull {
                val cn = it.norm.lowercase()
                cn.isNotEmpty() && (cn.contains(am) || am.contains(cn))
            }?.let { return it.index }
        }
        return null
    }

    /** 사이트 정답 데이터. (어디서 읽었는지, 정답 조각들) */
    private data class PageAnswer(val src: String, val answers: List<String>)

    private suspend fun readPageAnswer(d: Driver): PageAnswer? {
        val o = d.evalObjectOrNull(READ_PAGE_ANSWER_JS) ?: return null
        val answers = splitAnswers(o.optString("answer", ""))
        if (answers.isEmpty()) return null
        return PageAnswer(o.optString("src", "arr"), answers)
    }

    /** 새 화면에 들어갈 때마다 정답 데이터를 확인해 로그에 남긴다. */
    private suspend fun checkAnswerSource(d: Driver, label: String): Boolean {
        val v = d.evalObjectOrNull(CHECK_ANSWER_SOURCE_JS) ?: return false
        val quiz = v.optInt("quiz", 0)
        val talk = v.optInt("talk", 0)
        if (quiz > 0) {
            val w = v.optInt("quizWith", 0)
            d.log("[문법] $label 정답 데이터 확인 — 문항 ${quiz}개 중 정답 ${w}개를 한 번에 읽었습니다.")
            return w > 0
        }
        if (talk > 0) {
            val w = v.optInt("talkWith", 0)
            d.log("[문법] $label 정답 데이터 확인 — 카드 ${talk}장 중 정답 ${w}개를 한 번에 읽었습니다.")
            return w > 0
        }
        d.log("[문법] $label 정답 데이터를 찾지 못했습니다 — 화면 정보와 채점 결과로 풉니다.")
        return false
    }

    /**
     * 페이지가 들고 있는 정답 데이터를 실행 중에 찾아낸다.
     *
     * 개념 톡은 정답을 화면에 그리지 않지만, 채점을 브라우저에서 하므로
     * 정답이 페이지의 전역 변수 어딘가에 들어 있다. 그래서 전역을 훑어
     * "지금 보기 중 하나와 정확히 같은 문자열"을 찾는다.
     * (확장프로그램 grammar.js 의 FIND_ANSWER_JS 와 같은 스크립트)
     */
    private fun findAnswerJs(options: List<String>, cnt: Int): String {
        val arr = JSONArray()
        for (o in options) arr.put(o)
        return FIND_ANSWER_TEMPLATE
            .replace("__OPTIONS__", arr.toString())
            .replace("__CNT__", cnt.toString())
    }

    private val FIND_ANSWER_TEMPLATE = """

        var OPT = __OPTIONS__;
        var CNT = __CNT__;
        // 보기 텍스트에는 번호가 붙어 있다('4인칭'). 숫자·공백·문장부호를 떼고 비교한다.
        var norm = function (s) {
            return String(s == null ? '' : s).replace(/[^A-Za-z\\uac00-\\ud7a3]/g, '');
        };
        var optSet = {};
        for (var i = 0; i < OPT.length; i++) optSet[norm(OPT[i])] = true;

        var hits = {}, namedHits = {}, nodes = 0, indexedOnly = false;
        // 이름이 정답을 뜻하는 자리(answer, ans, correct …)에서 나온 값은 따로 모아 우선한다.
        var ANSWER_KEY = /(^|[^a-z])(ans|answer|correct|right|solution)([^a-z]|${'$'})|정답/i;

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
    """

    /** 테스트용: 만들어지는 스크립트를 확인한다. */
    fun findAnswerJsForTest(options: List<String>, cnt: Int): String = findAnswerJs(options, cnt)

    /** 페이지 전역에서 이번 문제의 정답 문자열을 찾는다. 못 찾거나 애매하면 null. */
    private suspend fun findAnswerInPage(d: Driver, options: List<String>, cnt: Int): String? {
        val v = d.evalStringOrNull(findAnswerJs(options, cnt)) ?: return null
        return v.trim().ifEmpty { null }
    }

    /**
     * 개념 톡의 정답 고르기.
     *
     * 개념 톡은 정답 데이터를 화면에 두지 않지만, **바로 다음 설명 카드가 정답을 풀어서 말해 준다.**
     *   빈칸  "do(does,did)를 사용해서 ___를 강조" -> 다음 카드 "…해석해서 동사의 뜻을 강조해 줘요."
     *   객관식 "동사를 강조하는 문장은?"          -> 다음 카드 "'정말'을 붙여 '싫어한다'는 동사의 의미를…"
     * 그래서 보기마다 그 해설과 얼마나 겹치는지 점수를 매겨 가장 높은 것을 고른다.
     * 모든 보기에 공통으로 나오는 말(예: '정말')은 변별력이 없으므로 점수에서 뺀다.
     *
     * @return 고를 보기 번호. 단서가 없으면 null.
     */
    fun pickTalkAnswer(choices: List<Choice>, upcoming: String?): Int? {
        if (choices.isEmpty() || upcoming.isNullOrEmpty()) return null
        val hay = Norm.mnorm(upcoming)
        if (hay.isEmpty()) return null

        fun tokensOf(text: String): Set<String> =
            text.split(Regex("[\\s,./·\"'()\\[\\]?!~]+"))
                .map { Norm.mnorm(it) }
                .filter { it.length >= 2 }
                .toSet()

        // 여러 보기에 공통으로 들어간 토큰은 변별력이 없다
        val seen = HashMap<String, Int>()
        for (c in choices) for (t in tokensOf(c.raw)) seen[t] = (seen[t] ?: 0) + 1

        var best: Int? = null
        var bestScore = 0
        for (c in choices) {
            val whole = c.norm
            var score = 0
            if (whole.length >= 2 && hay.contains(whole)) score += whole.length * 3
            for (t in tokensOf(c.raw)) {
                if ((seen[t] ?: 0) > 1) continue     // 공통 토큰은 제외
                if (hay.contains(t)) score += t.length
            }
            if (score > bestScore) { bestScore = score; best = c.index }
        }
        return if (bestScore > 0) best else null
    }

    /** 단어장/페이지 데이터에서 지문에 대한 정답을 찾는다. 없으면 null. */
    fun lookupAnswer(question: String, lookups: Test.Lookups?): String? {
        if (lookups == null || question.isEmpty()) return null
        val qm = Norm.mnorm(question)
        if (qm.isEmpty()) return null
        lookups.fwd[qm]?.let { return it }
        lookups.bwd[qm]?.let { return it }
        // 지문이 문장이라 정확히 일치하지 않는 경우: 지문이 키를 포함하는지 확인
        for ((k, v) in lookups.fwd) {
            if (k.length >= 4 && qm.contains(k)) return v
        }
        return null
    }

    /**
     * 클래스 페이지에서 다음에 눌러야 할 단계를 고른다.
     * 잠기지 않고, 아직 시도하지 않은 것 중 STAGE_ORDER 순서가 가장 앞선 것.
     */
    fun nextClassAction(units: List<UnitRow>, tried: Set<String>, prefer: String? = null): ClassAction {
        for (u in units) {
            if (u.locked) continue
            val open = u.stages.filter { !it.locked && it.key !in tried }
            if (open.isEmpty()) {
                // 아직 펼치지 않은 유닛이면 펼쳐서 단계를 확인한다.
                if (u.stages.isEmpty() && u.hasTitle && "open_${u.i}" !in tried) {
                    return ClassAction.Open(u)
                }
                continue
            }
            // prefer 로 지정된 단계(예: 오답이 있었을 때의 '누적오답복습')를 맨 앞으로
            val best = open.minByOrNull {
                val idx = STAGE_ORDER.indexOf(it.title)
                val base = if (idx < 0) 99 else idx
                if (prefer != null && it.title == prefer) -1 else base
            }!!
            return ClassAction.Start(u, best)
        }
        return ClassAction.None
    }

    /**
     * 빈칸(여러 개일 수 있음)에 넣을 값 목록.
     *
     * 정답을 알면 정답 문장을 빈칸 수에 맞춰 나눠 넣고,
     * 모르면 화면에 주어진 힌트 단어("the, tallest, student, …")를 순서대로 넣는다.
     * 둘 다 없으면 빈 목록(=풀 수 없음).
     */
    fun fillValues(count: Int, answer: String?, hint: String): List<String> {
        if (count <= 0) return emptyList()
        if (!answer.isNullOrEmpty()) {
            val words = Norm.splitTargetWords(answer).filter { it.isNotBlank() }
            if (count == 1) return listOf(answer)
            if (words.size == count) return words
            if (words.size > count) {
                // 빈칸보다 단어가 많으면 마지막 칸에 남은 단어를 몰아 넣는다
                return words.take(count - 1) + words.drop(count - 1).joinToString(" ")
            }
        }
        if (hint.isNotEmpty()) {
            val words = hint.split(Regex("[,،]|\\s{2,}")).map { it.trim() }.filter { it.isNotEmpty() }
            if (words.size >= count) return words.take(count)
            if (words.isNotEmpty()) return words + List(count - words.size) { "" }
        }
        return emptyList()
    }

    /** 페이지 전역 study_data 를 단어장 형태로 읽는다(있을 때만). */
    private suspend fun pageDict(d: Driver): AnswerDict? {
        val cards = d.evalArrayOrNull(
            "return (typeof study_data !== 'undefined' && study_data) ? study_data : null;"
        ) ?: return null
        val dict = AnswerDict()
        for (i in 0 until cards.length()) {
            val c = cards.optJSONObject(i) ?: continue
            val front = Norm.stripTags(c.optString("front", "")).trim()
            val back = Norm.stripTags(c.optString("back", "")).trim()
            if (front.isNotEmpty() && back.isNotEmpty()) dict[back] = front
        }
        return if (dict.isEmpty()) null else dict
    }

    /**
     * 사이트 모달(#alertModal / #confirmModal)이 떠 있으면 알맞은 버튼을 눌러 준다.
     *
     * 사이트 스크립트(homer.js 의 showAlert/showConfirm)를 확인한 결과:
     *   - 두 모달 모두 `.btn-ok`(확인) 와 `.btn-cancel` 을 쓰고, **버튼 글자는 호출할 때 바뀐다**.
     *   - 특히 '누적오답복습'(scripts/v3/gclass_main_std.js)은
     *       showConfirm('… 복습을 시작할까요?', …, btn_ok_text='학습 생략', btn_cancel_text='학습 시작')
     *     이라서, `.btn-ok` 를 그냥 누르면 **복습을 건너뛴다**.
     * 그래서 클래스 이름이 아니라 **버튼에 적힌 글자**로 고른다.
     *
     * @return 누른 버튼의 글자 (모달이 없으면 null)
     */
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
    private suspend fun skipTalkAudio(d: Driver): Boolean = d.evalBool(
        """
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
        """
    )

    private suspend fun handleModal(d: Driver): String? {
        val label = d.evalStringOrNull(
            """
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

            var btns = modal.querySelectorAll('button, a, .btn');
            var best = null, bestScore = -1, bestText = '';
            for (var i = 0; i < btns.length; i++) {
                var b = btns[i];
                if (!vis(b)) continue;
                var t = ((b.textContent || '') + '').replace(/\s+/g, ' ').trim();
                // 학습을 건너뛰거나 닫는 버튼은 절대 고르지 않는다
                if (/생략|취소|나중|닫기|아니/.test(t)) continue;
                var score = 0;
                if (/학습 ?시작/.test(t)) score = 6;
                else if (/시작/.test(t)) score = 5;
                else if (/계속/.test(t)) score = 4;
                else if (/확인|예|네/.test(t)) score = 3;
                else if (b.className.indexOf('btn-ok') >= 0) score = 2;
                else continue;
                if (score > bestScore) { bestScore = score; best = b; bestText = t; }
            }
            if (!best) return null;
            best.setAttribute('data-cc-modal-btn', '1');
            return bestText;
            """
        )?.trim()?.ifEmpty { null } ?: return null
        d.clickFirstVisible("[data-cc-modal-btn=\"1\"]")
        return label
    }

    private suspend fun clickTagged(
        d: Driver, attr: String, value: String, trusted: Boolean,
    ): Boolean {
        val selector = "[$attr=\"$value\"]"
        if (!trusted) return d.clickFirstVisible(selector)

        // 합성 클릭을 무시하는 화면(문장 테스트와 같은 유형)을 위한 네이티브 클릭
        return d.trustedClick(
            """
            var el = document.querySelector('$selector');
            if (!el) return null;
            el.scrollIntoView({ block: 'center' });
            var r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: window.innerWidth };
            """
        )
    }

    /** 입력형 문제의 index 번째 빈칸에 값을 써 넣는다 (값 설정 + input/change 이벤트). */
    private suspend fun fillInput(
        d: Driver, index: Int, value: String, attr: String = "data-cc-input",
    ): Boolean = d.evalBool(
        """
        var el = document.querySelector('[${attr}="${index}"]');
        if (!el) return false;
        el.focus();
        var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, ${value.jsStr()});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
        """
    )

    private suspend fun clickNext(d: Driver): Boolean = d.evalBool(CLICK_NEXT_JS)

    val run: ModeFn = { d, answerDict, stop ->
        d.log("[문법] 시작")

        AntiBlur.inject(d) // 백그라운드 실행 시 '이탈 감지' 우회

        val dict = if (!answerDict.isNullOrEmpty()) answerDict else pageDict(d)
        val lookups = if (dict.isNullOrEmpty()) null else Test.buildLookups(null, dict)
        if (lookups == null) {
            d.log("[문법] 단어장이 없습니다 — 화면의 정답 정보와 채점 결과로 진행합니다.")
        } else {
            d.log("[문법] 매칭 데이터 로드 완료 (${dict!!.size}개)")
        }

        val wrongByQid = HashMap<String, MutableSet<Int>>()
        val triesByQid = HashMap<String, Int>()
        val lastPick = HashMap<String, Int>()
        val triedStages = HashSet<String>()
        val modalRetry = HashMap<String, Int>()   // 확인 창을 거친 단계를 다시 눌러 본 횟수
        var talkWait = 0                          // 개념 톡 해설 음성을 기다린 횟수
        var talkAudioSkipped: String? = null      // 소리를 넘긴 카드(같은 카드에서 두 번 넘기지 않는다)
        var lastModal: String? = null             // 직전에 누른 안내 창의 글자
        var sameModal = 0                         // 같은 안내 창이 연달아 뜬 횟수
        val scrambleClicks = HashMap<String, MutableList<Int>>()           // 문제별로 누른 타일 순서
        val failedPairs = HashMap<String, MutableSet<String>>()            // 문제별로 틀린 짝
        val wrongByRow = HashMap<String, HashMap<Int, MutableSet<Int>>>()  // 문제별·줄별 오답
        var lastGroupPick: Triple<String, Int, Int>? = null
        var lastQid = ""
        var idleStreak = 0
        var ignoredClicks = 0
        var talkStuck = 0      // 개념 톡에서 Enter 가 먹히지 않은 연속 횟수
        var checkedScreen = ""  // 정답 데이터를 확인한 화면 (단계가 바뀌면 다시 확인한다)

        // 지금 진행 중인 단계의 학습 기록 (①열기 ②읽기 ③로드 ④확인완료 ⑤풀이 ⑨오답노트 ⑫결과 ⑬재학습)
        var stgUnit = ""
        var stgTitle = ""
        var stgTotal = 0
        var stgCards = 0
        var stgWithAnswer = 0
        var stgSolved = 0
        var stgNo = 0
        var stgDone = true
        val stgWrong = ArrayList<Array<String>>()     // [qid, 문제, 고른 답, 정답]
        var wrongLastStage = false
        val answeredQ = HashSet<String>()             // 이미 번호를 매겨 로그한 문항
        val lastNote = HashMap<String, Array<String>>()  // qid -> [문제, 고른 답, 정답]

        fun startStage(unitName: String, title: String) {
            stgUnit = unitName; stgTitle = title
            stgTotal = 0; stgCards = 0; stgWithAnswer = 0; stgSolved = 0; stgNo = 0
            stgWrong.clear(); stgDone = false
        }

        /** ⑫ 단계 결과(점수 + 오답 목록)를 로그에 남긴다. */
        fun reportStage() {
            if (stgDone) return
            stgDone = true
            val right = maxOf(0, stgSolved - stgWrong.size)
            val totalTxt = if (stgTotal > 0) "/$stgTotal" else ""
            d.log(
                "[문법] ⑪ '$stgUnit' — $stgTitle 완료. " +
                    "⑫ 푼 문제 $stgSolved${totalTxt}개, 정답 ${right}개, 오답 ${stgWrong.size}개"
            )
            if (stgWrong.isNotEmpty()) {
                d.log("[문법] ⑨ 오답노트 (${stgWrong.size}개)")
                stgWrong.forEachIndexed { i, w ->
                    val ans = if (w[3].isNotEmpty()) " / 정답 '${w[3]}'" else ""
                    d.log("[문법]   ${i + 1}) '${w[1].take(40)}' — 고른 답 '${w[2]}'$ans")
                }
            }
            wrongLastStage = stgWrong.isNotEmpty()
        }
        var fastScreen = false  // 이 화면의 정답을 전부 읽어 뒀는가 (읽어 뒀으면 빠르게 진행)

        /** 한 동작 뒤에 기다릴 시간. 정답을 다 아는 화면은 짧게. */
        fun pace(): Long = if (fastScreen) KNOWN_STEP_MS else STEP_DELAY_MS
        val talkTries = HashMap<String, Int>()   // 개념 톡 보기별 시도 횟수 (합성 -> 신뢰된 클릭 승격)
        var classUrl = ""                        // 문법 클래스 페이지 주소 (단계가 끝나면 여기로 돌아온다)

        /**
         * 한 단계(개념 톡·연습 문제 …)가 끝났을 때 클래스 페이지로 돌아간다.
         * 돌아가면 다음 단계를 이어서 진행한다. 돌아갈 곳이 없으면 false.
         */
        suspend fun backToClass(why: String): Boolean {
            if (classUrl.isEmpty()) return false
            reportStage()
            d.log("[문법] $why -> 클래스 페이지로 돌아가 다음 단계를 진행합니다.")
            d.loadUrl(classUrl)
            d.waitForLoad(15000)
            talkTries.clear()
            checkedScreen = ""
            fastScreen = false
            stop.await(STEP_DELAY_MS)
            return true
        }

        try {
            while (!stop.isSet) {
                val state = readState(d)
                if (state == null) {
                    if (stop.await(400)) break
                    continue
                }

                // ------------------------------------------ 로그인 화면(세션 끊김)
                if (state.kind == "login") {
                    d.log("[문법] 클래스카드에서 로그아웃된 상태입니다 — 로그인한 뒤 다시 실행하세요.")
                    stop.set()
                    break
                }

                // ------------------------------------------ 안내 창이 떠 있으면 먼저 닫는다
                if (state.kind != "class") {
                    val picked = handleModal(d)
                    if (picked != null) {
                        // 같은 안내 창이 계속 다시 뜨면(눌러도 화면이 안 넘어가면) 무한히 누르지 않는다
                        sameModal = if (picked == lastModal) sameModal + 1 else 0
                        lastModal = picked
                        if (sameModal >= MODAL_REPEAT_LIMIT) {
                            d.log("[문법] 안내 창('$picked')이 계속 다시 떠서 멈춥니다 — 화면에서 직접 확인해 주세요.")
                            stop.set()
                            break
                        }
                        d.log("[문법] 안내 창의 '$picked' 를 눌렀습니다.")
                        if (stop.await(700)) break
                        continue
                    }
                    lastModal = null
                    sameModal = 0
                }

                // ------------------------------------------ 문법 클래스 페이지
                if (state.kind == "class") {
                    d.currentUrl().let { if (it.isNotEmpty()) classUrl = it }
                    if (!DRIVE_CLASS_PAGE) {
                        d.log("[문법] 클래스 페이지입니다. 학습할 단계를 직접 열고 다시 실행하세요.")
                        stop.set()
                        break
                    }
                    // ⑬ 직전 단계에 오답이 있으면 '누적오답복습'(틀린 문제만 다시 학습)을 먼저 한다.
                    val prefer = if (REVIEW_WRONG && wrongLastStage) "누적오답복습" else null
                    when (val act = nextClassAction(state.units, triedStages, prefer)) {
                        is ClassAction.None -> {
                            d.log("[문법] 남은 단계가 없습니다 -> 종료")
                            stop.set()
                        }
                        is ClassAction.Open -> {
                            triedStages.add("open_${act.unit.i}")
                            d.clickFirstVisible("[data-cc-unit=\"${act.unit.i}\"] .unit-title")
                        }
                        is ClassAction.Start -> {
                            triedStages.add(act.stage.key)
                            checkedScreen = ""        // 새 단계 -> 정답 데이터를 다시 확인한다
                            fastScreen = false
                            reportStage()
                            startStage(act.unit.name, act.stage.title)
                            if (prefer != null && act.stage.title == prefer) {
                                d.log("[문법] ⑬ 직전 단계에 오답이 있어 틀린 문제부터 다시 학습합니다.")
                            }
                            d.log("[문법] ① '${act.unit.name}' — ${act.stage.title} 열기")
                            clickTagged(d, "data-cc-stage", act.stage.key, false)
                            stop.await(700)
                            // '누적오답복습'처럼 확인 창이 먼저 뜨는 단계가 있다.
                            // (사이트가 '학습 생략'을 확인 버튼에 달아 두므로 글자를 보고 고른다)
                            val picked = handleModal(d)
                            if (picked != null) {
                                d.log("[문법] 확인 창의 '$picked' 를 눌렀습니다.")
                                val again = (modalRetry[act.stage.key] ?: 0) + 1
                                modalRetry[act.stage.key] = again
                                if (again <= 2) triedStages.remove(act.stage.key)
                            }
                        }
                    }
                    if (stop.isSet) break
                    if (stop.await(STEP_DELAY_MS)) break
                    continue
                }

                // 새 화면(단계)에 들어왔으면 그 화면의 정답을 전부 한 번에 읽어 둔다.
                // 읽어 뒀으면(fastScreen) 문제마다 찍어 볼 필요가 없으므로 기다리지 않고 바로 푼다.
                if (state.kind == "talk" || state.kind == "quiz") {
                    val screen = state.kind + "|" + d.currentUrl()
                    if (screen != checkedScreen) {
                        checkedScreen = screen
                        val label = if (state.kind == "talk") "개념 톡" else "문제 화면"
                        if (stgDone) startStage(stgUnit, label)

                        // ② 페이지의 문제·설명을 처음부터 끝까지 읽는다
                        d.log("[문법] ② ${label}의 내용을 처음부터 끝까지 읽는 중…")

                        // ③ 모든 항목이 로드될 때까지 대기 (두 번 재서 개수가 같아지면 로드 완료)
                        var prev: String? = null
                        var quiz = 0; var talk = 0; var withAnswer = 0
                        for (i in 0 until 12) {
                            val v = d.evalObjectOrNull(CHECK_ANSWER_SOURCE_JS)
                            quiz = v?.optInt("quiz", 0) ?: 0
                            talk = v?.optInt("talk", 0) ?: 0
                            withAnswer = maxOf(v?.optInt("quizWith", 0) ?: 0, v?.optInt("talkWith", 0) ?: 0)
                            val sig = "$quiz/$talk"
                            if (prev != null && sig == prev && (quiz > 0 || talk > 0)) break
                            prev = sig
                            if (stop.await(LOAD_SETTLE_MS)) break
                        }
                        if (stop.isSet) break

                        stgTotal = quiz
                        stgCards = talk
                        stgWithAnswer = withAnswer
                        stgNo = 0
                        d.log(
                            "[문법] ③ 로드 완료 — " +
                                if (stgTotal > 0) "문항 ${stgTotal}개" else "카드 ${stgCards}장"
                        )

                        // ④ 학습 내용 확인 완료 (정답 데이터를 미리 다 읽어 둔다)
                        fastScreen = stgWithAnswer > 0
                        if (fastScreen) {
                            d.log(
                                "[문법] ④ 학습 내용 확인 완료 — 정답 ${stgWithAnswer}개를 미리 읽었습니다. " +
                                    "⑤ 1번 문제부터 순서대로 풉니다."
                            )
                        } else {
                            d.log("[문법] ④ 학습 내용 확인 완료 — 정답 데이터가 없어 화면 정보로 풉니다.")
                        }
                    }
                }

                // ------------------------------------------ 개념 톡 (설명 카드)
                if (state.kind == "talk") {
                    // 개념 톡: 사이트 스크립트대로 '지금 카드(card_idx)' 에서만 조작한다.
                    val ans = state.answers
                    val talkKey = state.qid
                    val tried = wrongByQid[talkKey] ?: emptySet<Int>()

                    // 1) 객관식 — 정답 글자와 같은 보기를 고른다 (.option-txt 로 비교)
                    if (state.options.isNotEmpty() && !state.talkDone) {
                        var pick = pickByAnswers(state.options, ans, tried)
                        if (pick == null) {
                            // 정답을 모르면 다음 카드 해설 -> 전역 훑기 -> 안 해 본 보기 순으로 고른다
                            val open = state.options.filter { it.index !in tried }
                            pick = pickTalkAnswer(open, state.upcoming)
                            if (pick == null) {
                                val scanned = findAnswerInPage(d, state.options.map { it.raw }, -1)
                                if (scanned != null) {
                                    pick = open.firstOrNull { Norm.mnorm(it.raw) == Norm.mnorm(scanned) }?.index
                                }
                            }
                            if (pick == null) pick = open.firstOrNull()?.index
                            if (pick != null && ans.isNotEmpty()) {
                                d.log("[문법] (개념 톡) 정답과 같은 보기를 못 찾아 ${pick + 1}번을 고릅니다.")
                            }
                        }
                        if (pick == null) {
                            if (backToClass("개념 톡 보기를 모두 눌러 봤습니다")) continue
                            d.log("[문법] 개념 톡 보기를 모두 눌러도 넘어가지 않습니다 -> 종료")
                            stop.set()
                            break
                        }

                        val label = state.options.firstOrNull { it.index == pick }?.raw ?: ""
                        if (talkKey !in answeredQ) {
                            answeredQ.add(talkKey)
                            stgNo++
                            stgSolved++
                            d.log(
                                "[문법] ⑤ ${stgNo}번 (개념 톡 객관식) -> ${pick + 1}번 '${label.take(20)}'" +
                                    (if (ans.isNotEmpty()) " (사이트 정답)" else " (추정)")
                            )
                        }
                        clickTagged(d, "data-cc-opt", pick.toString(), talkStuck >= 1)
                        if (stop.await(pace())) break

                        val after = readState(d)
                        if (after != null && after.kind == "talk" && after.sig == state.sig) {
                            talkStuck++
                            wrongByQid.getOrPut(talkKey) { mutableSetOf() }.add(pick)   // 이 보기는 아니었다
                            if (talkStuck == 1) {
                                d.log("[문법] 개념 톡 클릭이 한 번 무시됨 -> 신뢰된 클릭으로 재시도")
                            }
                        } else {
                            talkStuck = 0
                            if (after != null && after.kind == "talk" && after.talkWrong &&
                                stgWrong.none { it[0] == talkKey }
                            ) {
                                stgWrong.add(arrayOf(talkKey, "개념 톡 객관식", label, ans.joinToString(" / ")))
                                d.log("[문법] ⑨ 오답 -> 오답노트에 저장 (${stgWrong.size}번째)")
                            }
                        }
                        continue
                    }

                    // 2) 어순 배열 — 정답 순서대로 낱말을 누른다
                    if (state.orders.isNotEmpty() && state.orders.any { !it.picked }) {
                        val picked = state.orders.count { it.picked }
                        var target: Int? = null
                        val want = ans.getOrNull(picked)
                        if (want != null) {
                            val w = Norm.mnorm(want).lowercase()
                            target = state.orders.firstOrNull { !it.picked && it.norm.lowercase() == w }?.index
                        }
                        if (target == null) target = state.orders.firstOrNull { !it.picked }?.index
                        if (target == null) {
                            if (stop.await(400)) break
                            continue
                        }
                        if (talkKey !in answeredQ) {
                            answeredQ.add(talkKey)
                            stgNo++
                            stgSolved++
                            d.log("[문법] ⑤ ${stgNo}번 (개념 톡 어순 배열) — 정답 순서대로 놓습니다.")
                        }
                        clickTagged(d, "data-cc-order", target.toString(), talkStuck >= 1)
                        if (stop.await(400)) break
                        val after = readState(d)
                        if (after != null && after.kind == "talk" && after.sig == state.sig) talkStuck++
                        else talkStuck = 0
                        continue
                    }

                    // 3) 빈칸 — 보기가 있으면 고르고, 없으면 직접 써 넣는다
                    val emptyBlank = state.talkBlanks.filter { !it.filled }
                    if (emptyBlank.isNotEmpty()) {
                        val cur = emptyBlank.firstOrNull { it.current } ?: emptyBlank.first()
                        val want = (if (cur.cnt >= 0) ans.getOrNull(cur.cnt) else null)
                            ?: ans.getOrNull(cur.i) ?: ans.firstOrNull() ?: ""

                        if (state.picks.isNotEmpty()) {
                            val pkey = talkKey + "_p" + cur.i
                            val ptried = wrongByQid[pkey] ?: emptySet<Int>()
                            var pick = if (want.isNotEmpty()) {
                                pickByAnswers(state.picks, listOf(want), ptried)
                            } else null
                            if (pick == null) {
                                // 정답을 모르면 다음 카드 해설 -> 전역 훑기 -> 안 해 본 보기 순으로 고른다
                                val open = state.picks.filter { it.index !in ptried }
                                pick = pickTalkAnswer(open, state.upcoming)
                                if (pick == null) {
                                    val scanned = findAnswerInPage(
                                        d, state.picks.map { it.raw }, if (cur.cnt >= 0) cur.cnt else -1,
                                    )
                                    if (scanned != null) {
                                        pick = open.firstOrNull { Norm.mnorm(it.raw) == Norm.mnorm(scanned) }?.index
                                    }
                                }
                                if (pick == null) pick = open.firstOrNull()?.index
                            }
                            if (pick == null) {
                                if (backToClass("개념 톡 빈칸 보기를 모두 눌러 봤습니다")) continue
                                d.log("[문법] 개념 톡 빈칸 보기를 모두 눌러도 넘어가지 않습니다 -> 종료")
                                stop.set()
                                break
                            }
                            val key = talkKey + "_" + cur.i
                            if (key !in answeredQ) {
                                answeredQ.add(key)
                                stgNo++
                                stgSolved++
                                val lab = state.picks.firstOrNull { it.index == pick }?.raw ?: ""
                                d.log(
                                    "[문법] ⑤ ${stgNo}번 (개념 톡 빈칸) -> '${lab.take(20)}'" +
                                        (if (want.isNotEmpty()) " (사이트 정답)" else " (추정)")
                                )
                            }
                            clickTagged(d, "data-cc-sel", pick.toString(), talkStuck >= 1)
                            if (stop.await(pace())) break
                            val after = readState(d)
                            if (after != null && after.kind == "talk" && after.sig == state.sig) {
                                talkStuck++
                                wrongByQid.getOrPut(pkey) { mutableSetOf() }.add(pick)   // 이 보기는 아니었다
                            } else {
                                talkStuck = 0
                            }
                            continue
                        }

                        // 직접 입력 (사이트가 값 비교만 하므로 값 설정으로 충분하다)
                        val written = d.evalArrayOrNull(TALK_FILL_JS)
                        val wrote = written?.length() ?: 0
                        for (i in 0 until wrote) {
                            val w = written?.optJSONObject(i) ?: continue
                            d.log(
                                "[문법] ⑤ (개념 톡 입력) ${w.optInt("i", i) + 1}번 칸 -> " +
                                    "'${w.optString("value", "")}' (사이트 정답)"
                            )
                        }
                        if (wrote > 0) {
                            stgNo++
                            stgSolved++
                            if (!clickTagged(d, "data-cc-next", "1", false)) d.pressEnter()
                            if (stop.await(pace())) break
                            val after = readState(d)
                            if (after != null && after.kind == "talk" && after.sig == state.sig) talkStuck++
                            else talkStuck = 0
                            continue
                        }
                        d.log("[문법] 개념 톡 빈칸의 정답을 찾지 못했습니다 — 그대로 넘깁니다.")
                    }

                    // 3-b) 소리(해설 음성)가 아직 재생 중이면 사이트가 아무 입력도 받지 않는다.
                    //      이때 누르면 헛손질이므로 끝날 때까지 조용히 기다린다.
                    if (state.talkWaiting && state.options.isEmpty() &&
                        state.orders.isEmpty() && state.talkBlanks.isEmpty()
                    ) {
                        talkWait++
                        if (talkWait == 1) d.log("[문법] 개념 톡 해설 음성이 끝나기를 기다리는 중…")
                        // 잠깐 기다려도 안 끝나면(자동 재생이 막힌 화면 등) 사이트 방식대로 소리를 끝낸다
                        if (talkWait >= TALK_AUDIO_SKIP_AFTER && talkAudioSkipped != state.sig) {
                            talkAudioSkipped = state.sig
                            if (skipTalkAudio(d)) d.log("[문법] 해설 음성을 넘기고 다음으로 진행합니다.")
                        }
                        if (talkWait > TALK_WAIT_LIMIT) {
                            d.log("[문법] 해설 음성이 끝나지 않습니다 — 소리가 나오는지 확인해 주세요.")
                            talkWait = 0
                            talkStuck++
                        }
                        if (stop.await(700)) break
                        continue
                    }
                    talkWait = 0

                    // 4) 고를 것이 없으면 '계속하기'(next-btn) 또는 Enter 로 다음 카드
                    if (state.hasNext) {
                        if (!clickTagged(d, "data-cc-next", "1", talkStuck >= 2)) d.pressEnter()
                    } else {
                        d.pressEnter()
                    }
                    if (stop.await(pace())) break

                    val after = readState(d)
                    if (after != null && after.kind == "talk" && after.sig == state.sig) {
                        talkStuck++
                        if (talkStuck == 3) {
                            d.trustedClick(
                                "return { x: window.innerWidth / 2, y: window.innerHeight / 2, " +
                                    "w: window.innerWidth };"
                            )
                            d.pressEnter()
                        }
                        if (talkStuck >= IDLE_GIVE_UP) {
                            if (backToClass("개념 톡이 끝났거나 더 넘어가지 않습니다")) continue
                            d.log("[문법] 개념 톡이 더 넘어가지 않습니다 -> 종료")
                            stop.set()
                            break
                        }
                    } else {
                        talkStuck = 0
                        if (after != null && after.kind == "talk" && DEBUG) {
                            d.log("[문법] (개념 톡) ${after.talkIdx + 1}/${after.cards}장")
                        }
                    }
                    continue
                }

                if (state.kind == "end") {
                    if (backToClass("한 단계를 마쳤습니다")) continue
                    d.log("[문법] 종료 화면 감지 -> 끝")
                    stop.set()
                    break
                }

                if (state.opening) {
                    // 인라인 보기 상자를 막 열었다 — 다음 바퀴에서 보기를 읽는다
                    if (stop.await(400)) break
                    continue
                }

                // ------------------------------------------ 문제 화면이 아닌 경우
                val hasWork = state.choices.isNotEmpty() || state.hasInput ||
                    state.rows.isNotEmpty() || state.left.isNotEmpty() || state.tiles.isNotEmpty()
                if (state.kind == "idle" || !hasWork) {
                    if ((state.hasNext || state.kind == "idle") && clickNext(d)) {
                        idleStreak = 0
                    } else {
                        idleStreak++
                        if (idleStreak == 15) {
                            d.log("[문법] 문제도 버튼도 찾지 못했습니다. DEBUG 를 켜고 다시 실행해 보세요.")
                        }
                        if (idleStreak >= IDLE_GIVE_UP) {
                            if (backToClass("이 단계에서 더 풀 문제가 없습니다")) { idleStreak = 0; continue }
                            d.log("[문법] 더 이상 풀 문제가 없습니다 -> 종료")
                            stop.set()
                            break
                        }
                    }
                    if (stop.await(400)) break
                    continue
                }
                idleStreak = 0

                // 분류형: 방금 고른 줄이 채점되면 그 보기를 오답으로 기억한다.
                lastGroupPick?.let { (gq, rowIdx, optIdx) ->
                    if (state.type == "group") {
                        val row = state.rows.firstOrNull { it.index == rowIdx }
                        if (row != null && row.done) {
                            wrongByRow.getOrPut(gq) { HashMap() }
                                .getOrPut(rowIdx) { mutableSetOf() }.add(optIdx)
                        }
                        lastGroupPick = null
                    }
                }

                // 채점 결과 반영: 직전에 고른 보기가 틀렸으면 기억해 둔다.
                // ⑧ 채점 결과 확인 -> ⑨ 틀린 문제는 오답노트에 저장
                if (state.feedback == "wrong" && lastQid.isNotEmpty()) {
                    lastPick[lastQid]?.let { picked ->
                        wrongByQid.getOrPut(lastQid) { mutableSetOf() }.add(picked)
                        if (stgWrong.none { it[0] == lastQid }) {
                            val note = lastNote[lastQid]
                            stgWrong.add(
                                arrayOf(
                                    lastQid,
                                    note?.get(0) ?: state.question,
                                    note?.get(1) ?: "보기 ${picked + 1}",
                                    note?.get(2) ?: state.answer,
                                )
                            )
                            d.log("[문법] ⑨ 오답 -> 오답노트에 저장 (${stgWrong.size}번째)")
                        }
                    }
                }
                // 채점이 끝난 문항이면 다음으로 넘긴다.
                // (분류·짝맞추기는 줄/칸 단위로 채점되므로 문항 단위 채점만 본다)
                if (state.feedback != "none" && state.type != "group" && state.type != "match") {
                    clickNext(d)
                    if (stop.await(pace())) break
                    continue
                }

                val qid = state.qid
                val tries = triesByQid.getOrDefault(qid, 0)
                if (tries >= MAX_TRY_PER_QUESTION) {
                    clickNext(d)
                    triesByQid[qid] = 0
                    wrongByQid.remove(qid)
                    if (stop.await(400)) break
                    continue
                }
                triesByQid[qid] = tries + 1

                // 정답: 사이트가 채점에 쓰는 정답(arr_answer) > 화면의 정답 > 단어장 > 전역 훑기
                var answer = ""
                var answerFrom = ""
                var answerList: List<String> = emptyList()

                val pageAns = readPageAnswer(d)
                if (pageAns != null) {
                    answerList = pageAns.answers
                    answer = pageAns.answers.first()
                    answerFrom = "사이트 정답(${pageAns.src})"
                }
                if (answer.isEmpty()) {
                    answer = state.answer.ifEmpty { lookupAnswer(state.question, lookups) ?: "" }
                    answerFrom = when {
                        state.answer.isNotEmpty() -> "화면의 정답"
                        answer.isNotEmpty() -> "단어장"
                        else -> ""
                    }
                    if (answer.isNotEmpty()) answerList = listOf(answer)
                }
                if (answer.isEmpty() && state.choices.isNotEmpty()) {
                    findAnswerInPage(d, state.choices.map { it.raw }, -1)?.let {
                        answer = it
                        answerList = listOf(it)
                        answerFrom = "페이지 정답 데이터"
                    }
                }

                // ⑤ 보기형이 아닌 문제도 번호를 매겨 진행 상황을 남긴다
                if (state.choices.isEmpty() && qid !in answeredQ &&
                    (state.hasInput || state.tiles.isNotEmpty() || state.rows.isNotEmpty() ||
                        state.left.isNotEmpty())
                ) {
                    answeredQ.add(qid)
                    stgNo++
                    stgSolved++
                    val kind = when {
                        state.hasInput -> "입력형"
                        state.tiles.isNotEmpty() -> "어순 배열"
                        state.rows.isNotEmpty() -> "분류형"
                        else -> "짝맞추기"
                    }
                    val totalTxt = if (stgTotal > 0) "/$stgTotal" else ""
                    d.log(
                        "[문법] ⑤ $stgNo${totalTxt}번 문제 ($kind) '${state.question.take(30)}'" +
                            (if (answerFrom.isNotEmpty()) " ($answerFrom)" else " (추정)")
                    )
                }

                // ------------------------------------------ 입력형
                if (state.choices.isEmpty() && state.hasInput) {
                    if (state.filled) {
                        clickNext(d)          // 이미 다 써 넣었다 -> 채점하기
                        if (stop.await(pace())) break
                        continue
                    }
                    val values = if (answerList.size == state.blanks) answerList
                        else fillValues(state.blanks, answer.ifEmpty { null }, state.hint)
                    if (values.isEmpty()) {
                        d.log("[문법] 답을 알 수 없는 입력형 문제(빈칸 ${state.blanks}칸) — 비운 채 넘어갑니다.")
                        clickNext(d)
                        if (stop.await(pace())) break
                        continue
                    }
                    if (DEBUG) {
                        d.log("[문법] (입력) 빈칸 ${values.size}칸 -> ${values.joinToString(" / ").take(60)}")
                    }
                    var stopped = false
                    for ((i, v) in values.withIndex()) {
                        fillInput(d, i, v)
                        if (stop.await(120)) { stopped = true; break }
                    }
                    if (stopped) break
                    clickNext(d)
                    if (stop.await(pace())) break
                    continue
                }

                // ------------------------------------------ 어순 배열
                if (state.type == "scramble") {
                    val clicked = scrambleClicks.getOrPut(qid) { mutableListOf() }
                    val tile = nextScrambleIndex(answer.ifEmpty { null }, state.tiles, clicked)
                    if (tile == null) {
                        scrambleClicks.remove(qid)
                        clickNext(d)
                        if (stop.await(pace())) break
                        continue
                    }
                    if (DEBUG) {
                        val t = state.tiles.firstOrNull { it.index == tile }
                        d.log("[문법] (어순) ${clicked.size + 1}번째 -> '${t?.raw ?: ""}'")
                    }
                    clicked.add(tile)
                    clickTagged(d, "data-cc-opt", tile.toString(), ignoredClicks >= TRUSTED_AFTER)
                    if (stop.await(400)) break
                    continue
                }

                // ------------------------------------------ 분류형 (줄마다 라디오)
                if (state.type == "group") {
                    val pick = nextGroupPick(
                        state.rows, answer.ifEmpty { null }, wrongByRow[qid] ?: emptyMap(),
                    )
                    if (pick == null) {
                        clickNext(d)
                        if (stop.await(pace())) break
                        continue
                    }
                    val (rowIdx, optIdx) = pick
                    if (DEBUG) d.log("[문법] (분류) ${rowIdx + 1}번째 줄 -> 보기 ${optIdx + 1}")
                    lastGroupPick = Triple(qid, rowIdx, optIdx)
                    clickTagged(d, "data-cc-rowopt", "${rowIdx}_${optIdx}", ignoredClicks >= TRUSTED_AFTER)
                    if (stop.await(400)) break
                    continue
                }

                // ------------------------------------------ 짝맞추기
                if (state.type == "match") {
                    val failed = failedPairs.getOrPut(qid) { mutableSetOf() }
                    val pair = nextPairAttempt(state.left, state.right, failed)
                    if (pair == null) {
                        failedPairs.remove(qid)
                        clickNext(d)
                        if (stop.await(pace())) break
                        continue
                    }
                    val (l, r) = pair
                    clickTagged(d, "data-cc-left", l.toString(), ignoredClicks >= TRUSTED_AFTER)
                    if (stop.await(250)) break
                    clickTagged(d, "data-cc-right", r.toString(), ignoredClicks >= TRUSTED_AFTER)
                    if (stop.await(pace())) break

                    // 짝이 맞으면 두 칸 모두 .end 가 된다. 아니면 실패로 기억한다.
                    val afterPair = readState(d)
                    val ok = afterPair != null && afterPair.kind == "quiz" &&
                        afterPair.left.any { it.index == l && it.done }
                    if (!ok) {
                        failed.add("${l}_${r}")
                        if (DEBUG) d.log("[문법] (짝맞추기) $l-$r 실패로 기억")
                    } else if (DEBUG) {
                        d.log("[문법] (짝맞추기) $l-$r 성공")
                    }
                    continue
                }

                // ------------------------------------------ 보기 선택형

                // 이미 하나를 골라 둔 상태면 채점하기를 눌러 결과를 받는다.
                if (state.selectedIdx >= 0) {
                    clickNext(d)
                    if (stop.await(pace())) break
                    continue
                }

                val wrongSet = wrongByQid[qid] ?: emptySet()
                val pick = pickByAnswers(state.choices, answerList, wrongSet)
                    ?: pickChoice(state.choices, answer.ifEmpty { null }, wrongSet)
                if (pick == null) {
                    if (stop.await(400)) break
                    continue
                }

                val label = state.choices.firstOrNull { it.index == pick }?.raw ?: ""
                if (qid !in answeredQ) {
                    answeredQ.add(qid)
                    stgNo++
                    stgSolved++
                    val totalTxt = if (stgTotal > 0) "/$stgTotal" else ""
                    d.log(
                        "[문법] ⑤ $stgNo${totalTxt}번 문제 '${state.question.take(30)}' -> " +
                            "${pick + 1}번 '${label.take(20)}'" +
                            (if (answerFrom.isNotEmpty()) " ($answerFrom)" else " (추정)")
                    )
                }
                lastNote[qid] = arrayOf(state.question, "${pick + 1}번 '$label'", answer)

                lastPick[qid] = pick
                lastQid = qid

                val clicked = clickTagged(d, "data-cc-opt", pick.toString(), ignoredClicks >= TRUSTED_AFTER)
                if (!clicked) {
                    ignoredClicks++
                    if (stop.await(400)) break
                    continue
                }

                if (stop.await(pace())) break
                val after = readState(d)
                // 화면도 그대로고 채점 표시도 없으면 클릭이 먹히지 않은 것으로 본다.
                if (after != null && after.kind == "quiz" &&
                    after.sig == state.sig && after.feedback == "none"
                ) {
                    ignoredClicks++
                    if (ignoredClicks == TRUSTED_AFTER) {
                        d.log("[문법] 합성 클릭이 무시됩니다 -> 네이티브 클릭으로 전환")
                    }
                } else {
                    ignoredClicks = 0
                }
            }
        } catch (e: Throwable) {
            if (!stop.isSet) d.log("[문법] 오류: ${e.message}")
        } finally {
            reportStage()
            d.log("[문법] 종료")
        }
    }
}
