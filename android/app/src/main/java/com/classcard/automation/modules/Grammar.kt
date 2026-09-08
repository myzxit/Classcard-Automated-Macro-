package com.classcard.automation.modules

import com.classcard.automation.core.AntiBlur
import com.classcard.automation.core.Driver
import com.classcard.automation.core.Norm
import com.classcard.automation.core.StopFlag

/**
 * 문법훈련(문법 학습/리뷰테스트) 자동 풀이.
 *
 * 다른 모듈과 달리 이식할 원본 파이썬 코드가 없다. 문법훈련 화면의 정확한 마크업을
 * 확인할 수 없었기 때문에, 특정 클래스 이름에 의존하지 않도록 두 가지를 겹쳐 놓았다.
 *
 *  1) 지문/보기 찾기 — 클래스카드가 쓰는 이름들을 후보 목록으로 차례로 시도하고,
 *     전부 실패하면 "보이는 형제 2~6개짜리 클릭 가능한 묶음"이라는 구조로 찾는다.
 *  2) 정답 고르기 — 단어장·study_data 로 답을 알면 그걸 고르고,
 *     모르면 **찍고 채점 결과를 기억**한다. 틀린 보기는 그 문제에서 다시 고르지 않으므로
 *     보기가 4개면 최대 4번 안에 반드시 정답에 도달한다. 정답표가 없어도 풀린다.
 *
 * 화면 구조가 예상과 다르면 [DEBUG] 를 켜고 한 번 돌려 로그를 확인하면 된다.
 * (진단 로그에 실제로 찾은 지문/보기/버튼이 그대로 찍힌다.)
 */
object Grammar {

    /** 진단용: true 면 문제별 파싱 결과와 클릭 판단을 로그에 출력. */
    var DEBUG = false

    /** 한 문제에서 이만큼 시도해도 넘어가지 않으면 다음 문제로 넘긴다. */
    var MAX_TRY_PER_QUESTION = 6

    /** 문제도 버튼도 못 찾은 채 이만큼 반복하면(≈12초) 끝난 것으로 보고 종료한다. */
    var IDLE_GIVE_UP = 30

    /** 합성 클릭이 이만큼 무시되면 네이티브(신뢰된) 클릭으로 올린다. */
    private const val TRUSTED_AFTER = 2

    /** 보기 하나. */
    data class Choice(val index: Int, val raw: String) {
        val norm: String = Norm.mnorm(raw)
    }

    private data class State(
        val ended: Boolean,
        val qid: String,
        val question: String,
        /** 지문+보기로 만든 화면 지문 — 문제가 바뀌었는지 판단하는 기준. */
        val sig: String,
        val choices: List<Choice>,
        val hasNext: Boolean,
        val feedback: String,   // "none" | "correct" | "wrong"
    )

    /**
     * 페이지에서 현재 문제를 읽어 온다.
     *
     * 찾은 보기에는 `data-cc-opt` 속성을 붙여 두어, 클릭할 때 같은 요소를 다시
     * 찾지 않아도 되게 한다(보기 목록이 매번 새로 그려져도 안전).
     */
    private val READ_STATE_JS = """
        function vis(el) {
            if (!el || el.offsetParent === null) return false;
            var r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        }
        function txt(el) { return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim(); }

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
            // 폴백: 클래스 이름에 quest/question 이 들어간 보이는 요소 중 가장 짧은 것
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
            // 폴백: opt/choice/answer 가 이름에 들어간 보이는 잎 요소들 중
            //       같은 부모를 공유하는 2~6개 묶음
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

        // 문제 식별자: 서버가 주는 값이 있으면 그것, 없으면 지문 자체
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
    """

    private suspend fun readState(d: Driver): State? {
        val data = d.evalObjectOrNull(READ_STATE_JS) ?: return null
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
            ended = data.optBoolean("ended", false),
            qid = data.optString("qid", ""),
            question = data.optString("question", "").trim(),
            sig = data.optString("sig", ""),
            choices = choices,
            hasNext = data.optBoolean("next", false),
            feedback = data.optString("feedback", "none"),
        )
    }

    /**
     * 고를 보기 번호. 순수 로직이라 단위 테스트로 검증한다.
     *
     * @param answer 단어장에서 찾은 정답 문자열(모르면 null)
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

    private suspend fun clickChoice(d: Driver, index: Int, trusted: Boolean): Boolean {
        val selector = "[data-cc-opt=\"$index\"]"
        if (!trusted) return d.clickFirstVisible(selector)

        // 합성 클릭을 무시하는 화면(문장 테스트와 같은 유형)을 위한 네이티브 클릭
        return d.trustedClick(
            """
            var el = document.querySelector('[data-cc-opt="$index"]');
            if (!el) return null;
            el.scrollIntoView({ block: 'center' });
            var r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: window.innerWidth };
            """
        )
    }

    private suspend fun clickNext(d: Driver): Boolean = d.evalBool(
        """
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
        """
    )

    val run: ModeFn = { d, answerDict, stop ->
        d.log("[문법] 시작")

        AntiBlur.inject(d) // 백그라운드 실행 시 '이탈 감지' 우회

        // 정답표가 있으면 쓰고, 없으면 찍어서 맞춘다(틀린 보기는 기억).
        val dict = if (!answerDict.isNullOrEmpty()) answerDict else pageDict(d)
        val lookups = if (dict.isNullOrEmpty()) null else Test.buildLookups(null, dict)
        if (lookups == null) {
            d.log("[문법] 단어장이 없습니다 — 보기를 하나씩 확인하며 진행합니다.")
        } else {
            d.log("[문법] 매칭 데이터 로드 완료 (${dict!!.size}개)")
        }

        val wrongByQid = HashMap<String, MutableSet<Int>>()
        val triesByQid = HashMap<String, Int>()
        var lastQid = ""
        var idleStreak = 0     // 문제도 버튼도 못 찾은 연속 횟수
        var ignoredClicks = 0  // 클릭했는데 화면이 그대로인 연속 횟수

        try {
            while (!stop.isSet) {
                val state = readState(d)
                if (state == null) {
                    if (stop.await(400)) break
                    continue
                }

                if (state.ended) {
                    d.log("[문법] 종료 화면 감지 -> 끝")
                    stop.set()
                    break
                }

                // 채점 결과 반영: 직전에 고른 보기가 틀렸으면 기억해 둔다.
                if (state.feedback == "wrong" && lastQid.isNotEmpty()) {
                    lastPick[lastQid]?.let { picked ->
                        wrongByQid.getOrPut(lastQid) { mutableSetOf() }.add(picked)
                        if (DEBUG) d.log("[문법] 오답 기억: '$lastQid' -> 보기 ${picked + 1}")
                    }
                }

                if (state.choices.isEmpty()) {
                    // 보기가 없으면 설명/해설 화면 — 다음으로 넘긴다.
                    if (state.hasNext && clickNext(d)) {
                        idleStreak = 0
                    } else {
                        idleStreak++
                        if (idleStreak == 15) {
                            d.log("[문법] 문제도 버튼도 찾지 못했습니다. DEBUG 를 켜고 다시 실행해 보세요.")
                        }
                        // 결과 화면의 클래스 이름을 모르는 경우까지 대비한 종료 조건
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

                val qid = state.qid
                val tries = triesByQid.getOrDefault(qid, 0)
                if (tries >= MAX_TRY_PER_QUESTION) {
                    // 이 문제는 포기하고 다음으로 (무한 루프 방지)
                    if (!clickNext(d)) {
                        if (stop.await(500)) break
                    }
                    triesByQid[qid] = 0
                    wrongByQid.remove(qid)
                    if (stop.await(400)) break
                    continue
                }

                val answer = lookupAnswer(state.question, lookups)
                val pick = pickChoice(state.choices, answer, wrongByQid[qid] ?: emptySet())
                if (pick == null) {
                    if (stop.await(400)) break
                    continue
                }

                if (DEBUG) {
                    d.log(
                        "[문법] 문제 '${state.question.take(40)}' 보기 ${state.choices.size}개 " +
                            "-> ${pick + 1}번 '${state.choices.getOrNull(pick)?.raw?.take(20)}'" +
                            if (answer != null) " (단어장)" else " (추정)"
                    )
                }

                lastPick[qid] = pick
                lastQid = qid
                triesByQid[qid] = tries + 1

                val clicked = clickChoice(d, pick, trusted = ignoredClicks >= TRUSTED_AFTER)
                if (!clicked) {
                    ignoredClicks++
                } else {
                    if (stop.await(700)) break
                    val after = readState(d)
                    // 화면도 그대로고 채점 표시도 없으면 클릭이 먹히지 않은 것으로 본다.
                    if (after != null && !after.ended &&
                        after.sig == state.sig && after.feedback == "none"
                    ) {
                        ignoredClicks++
                        if (ignoredClicks == TRUSTED_AFTER) {
                            d.log("[문법] 합성 클릭이 무시됩니다 -> 네이티브 클릭으로 전환")
                        }
                    } else {
                        ignoredClicks = 0
                    }
                    continue
                }
                if (stop.await(400)) break
            }
        } catch (e: Throwable) {
            if (!stop.isSet) d.log("[문법] 오류: ${e.message}")
        } finally {
            lastPick.clear()
            d.log("[문법] 종료")
        }
    }

    /** 문제별로 마지막에 고른 보기 (채점 결과를 다음 루프에서 반영하기 위한 것). */
    private val lastPick = HashMap<String, Int>()
}
