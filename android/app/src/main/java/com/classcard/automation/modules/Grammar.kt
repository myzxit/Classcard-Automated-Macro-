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

    /** 한 문제에서 이만큼 시도해도 넘어가지 않으면 다음 문제로 넘긴다. */
    var MAX_TRY_PER_QUESTION = 6

    /** 문제도 버튼도 못 찾은 채 이만큼 반복하면(≈12초) 끝난 것으로 보고 종료한다. */
    var IDLE_GIVE_UP = 30

    /** 클래스 페이지에서 유닛/단계를 스스로 눌러 진행할지. */
    var DRIVE_CLASS_PAGE = true

    /** 합성 클릭이 이만큼 무시되면 네이티브(신뢰된) 클릭으로 올린다. */
    private const val TRUSTED_AFTER = 2

    /** 클래스 페이지에서 이 순서로 단계를 진행한다(화면에 나타나는 순서와 같다). */
    val STAGE_ORDER = listOf(
        "개념 톡", "연습 문제 A", "연습 문제 B", "서술형 문제",
        "실전 문제", "누적오답복습", "Scramble",
    )

    /** 보기 하나. */
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

    private data class State(
        val kind: String,                 // "class" | "end" | "quiz" | "idle"
        val type: String = "",
        val qid: String = "",
        val sig: String = "",
        val question: String = "",
        val answer: String = "",
        val choices: List<Choice> = emptyList(),
        val hasInput: Boolean = false,
        val feedback: String = "none",
        val hasNext: Boolean = false,
        val units: List<UnitRow> = emptyList(),
    )

    /** 확장프로그램 grammar.js 의 READ_STATE_JS 와 같은 스크립트. */
    private val READ_STATE_JS = """

        function vis(el) {
            if (!el || el.offsetParent === null) return false;
            var r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        }
        function txt(el) { return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim(); }
        function any(sel) {
            var els = document.querySelectorAll(sel);
            for (var i = 0; i < els.length; i++) if (vis(els[i])) return els[i];
            return null;
        }

        var NEXT_SEL = [".study-bottom .btn-next-box .btn-gclass",".study-bottom .btn-next-box a",".btn-next-box .btn-gclass",".btnNextCard",".btn-condition-next",".btn-next",".btn-continue",".modal-content .btn-ok",".btn-quiz-start",".btn-opt-start"].join(',');
        var END_SEL = [".start-opt-body",".end-opt-body",".result-body",".quiz-result","a.btn-go-result"].join(',');

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
    """

    private val CLICK_NEXT_JS = """
        function vis(el) {
            if (!el || el.offsetParent === null) return false;
            var r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        }
        var sel = [".study-bottom .btn-next-box .btn-gclass",".study-bottom .btn-next-box a",".btn-next-box .btn-gclass",".btnNextCard",".btn-condition-next",".btn-next",".btn-continue",".modal-content .btn-ok",".btn-quiz-start",".btn-opt-start"];
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
        return State(
            kind = data.optString("kind", "idle"),
            type = data.optString("type", ""),
            qid = data.optString("qid", ""),
            sig = data.optString("sig", ""),
            question = data.optString("question", "").trim(),
            answer = data.optString("answer", "").trim(),
            choices = choices,
            hasInput = data.optBoolean("hasInput", false),
            feedback = data.optString("feedback", "none"),
            hasNext = data.optBoolean("next", false),
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
    fun nextClassAction(units: List<UnitRow>, tried: Set<String>): ClassAction {
        for (u in units) {
            if (u.locked) continue
            val open = u.stages.filter { !it.locked && it.key !in tried }
            if (open.isEmpty()) {
                // 아직 펼치지 않은 유닛이면 펼쳐서 단계를 확인한다.
                if (u.stages.isEmpty() && u.hasTitle && "open_${'$'}{u.i}" !in tried) {
                    return ClassAction.Open(u)
                }
                continue
            }
            val best = open.minByOrNull {
                val idx = STAGE_ORDER.indexOf(it.title)
                if (idx < 0) 99 else idx
            }!!
            return ClassAction.Start(u, best)
        }
        return ClassAction.None
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

    private suspend fun clickTagged(
        d: Driver, attr: String, value: String, trusted: Boolean,
    ): Boolean {
        val selector = "[${'$'}attr=\"${'$'}value\"]"
        if (!trusted) return d.clickFirstVisible(selector)

        // 합성 클릭을 무시하는 화면(문장 테스트와 같은 유형)을 위한 네이티브 클릭
        return d.trustedClick(
            """
            var el = document.querySelector('${'$'}selector');
            if (!el) return null;
            el.scrollIntoView({ block: 'center' });
            var r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: window.innerWidth };
            """
        )
    }

    /** 입력형 문제에 정답을 써 넣는다 (값 설정 + input/change 이벤트). */
    private suspend fun fillInput(d: Driver, value: String): Boolean = d.evalBool(
        """
        var el = document.querySelector('[data-cc-input="1"]');
        if (!el) return false;
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
            d.log("[문법] 매칭 데이터 로드 완료 (${'$'}{dict!!.size}개)")
        }

        val wrongByQid = HashMap<String, MutableSet<Int>>()
        val triesByQid = HashMap<String, Int>()
        val lastPick = HashMap<String, Int>()
        val triedStages = HashSet<String>()
        var lastQid = ""
        var idleStreak = 0
        var ignoredClicks = 0

        try {
            while (!stop.isSet) {
                val state = readState(d)
                if (state == null) {
                    if (stop.await(400)) break
                    continue
                }

                // ------------------------------------------ 문법 클래스 페이지
                if (state.kind == "class") {
                    if (!DRIVE_CLASS_PAGE) {
                        d.log("[문법] 클래스 페이지입니다. 학습할 단계를 직접 열고 다시 실행하세요.")
                        stop.set()
                        break
                    }
                    when (val act = nextClassAction(state.units, triedStages)) {
                        is ClassAction.None -> {
                            d.log("[문법] 남은 단계가 없습니다 -> 종료")
                            stop.set()
                        }
                        is ClassAction.Open -> {
                            triedStages.add("open_${'$'}{act.unit.i}")
                            d.clickFirstVisible("[data-cc-unit=\"${'$'}{act.unit.i}\"] .unit-title")
                        }
                        is ClassAction.Start -> {
                            triedStages.add(act.stage.key)
                            d.log("[문법] '${'$'}{act.unit.name}' — ${'$'}{act.stage.title} 시작")
                            clickTagged(d, "data-cc-stage", act.stage.key, false)
                        }
                    }
                    if (stop.isSet) break
                    if (stop.await(1500)) break
                    continue
                }

                if (state.kind == "end") {
                    d.log("[문법] 종료 화면 감지 -> 끝")
                    stop.set()
                    break
                }

                // ------------------------------------------ 문제 화면이 아닌 경우
                if (state.kind == "idle" || (state.choices.isEmpty() && !state.hasInput)) {
                    if ((state.hasNext || state.kind == "idle") && clickNext(d)) {
                        idleStreak = 0
                    } else {
                        idleStreak++
                        if (idleStreak == 15) {
                            d.log("[문법] 문제도 버튼도 찾지 못했습니다. DEBUG 를 켜고 다시 실행해 보세요.")
                        }
                        if (idleStreak >= IDLE_GIVE_UP) {
                            d.log("[문법] 더 이상 풀 문제가 없습니다 -> 종료")
                            stop.set()
                            break
                        }
                    }
                    if (stop.await(400)) break
                    continue
                }
                idleStreak = 0

                // 채점 결과 반영: 직전에 고른 보기가 틀렸으면 기억해 둔다.
                if (state.feedback == "wrong" && lastQid.isNotEmpty()) {
                    lastPick[lastQid]?.let { picked ->
                        wrongByQid.getOrPut(lastQid) { mutableSetOf() }.add(picked)
                        if (DEBUG) d.log("[문법] 오답 기억: 보기 ${'$'}{picked + 1}")
                    }
                }
                // 채점이 끝난 문항이면 다음으로 넘긴다.
                if (state.feedback != "none") {
                    clickNext(d)
                    if (stop.await(600)) break
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

                // 정답: 화면에 들어 있는 것 > 단어장
                val answer = state.answer.ifEmpty { lookupAnswer(state.question, lookups) ?: "" }

                // ------------------------------------------ 입력형
                if (state.choices.isEmpty() && state.hasInput) {
                    if (answer.isEmpty()) {
                        d.log("[문법] 정답을 알 수 없는 입력형 문제 — 건너뜁니다.")
                        clickNext(d)
                        if (stop.await(600)) break
                        continue
                    }
                    fillInput(d, answer)
                    if (stop.await(300)) break
                    clickNext(d)
                    if (stop.await(700)) break
                    continue
                }

                // ------------------------------------------ 보기 선택형
                if (state.type == "match" || state.type == "group") {
                    d.log("[문법] 아직 지원하지 않는 문제 유형(${'$'}{state.type}) — 건너뜁니다.")
                    clickNext(d)
                    if (stop.await(700)) break
                    continue
                }

                val pick = pickChoice(state.choices, answer.ifEmpty { null }, wrongByQid[qid] ?: emptySet())
                if (pick == null) {
                    if (stop.await(400)) break
                    continue
                }

                if (DEBUG) {
                    val label = state.choices.firstOrNull { it.index == pick }?.raw ?: ""
                    d.log(
                        "[문법] (${'$'}{state.type}) '${'$'}{state.question.take(40)}' " +
                            "보기 ${'$'}{state.choices.size}개 -> ${'$'}{pick + 1}번 '${'$'}{label.take(20)}'" +
                            if (answer.isNotEmpty()) " (정답 확인)" else " (추정)"
                    )
                }

                lastPick[qid] = pick
                lastQid = qid

                val clicked = clickTagged(d, "data-cc-opt", pick.toString(), ignoredClicks >= TRUSTED_AFTER)
                if (!clicked) {
                    ignoredClicks++
                    if (stop.await(400)) break
                    continue
                }

                if (stop.await(700)) break
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
            if (!stop.isSet) d.log("[문법] 오류: ${'$'}{e.message}")
        } finally {
            d.log("[문법] 종료")
        }
    }
}
