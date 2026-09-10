package com.classcard.automation.modules

import com.classcard.automation.core.Driver
import com.classcard.automation.core.StopFlag

/**
 * 단어 리콜 자동화 — 확장 basic.js 의 recall 과 같은 로직.
 *
 * 리콜 화면의 실제 동작 (사이트 스크립트 scripts/v2/recall.js 확인 결과):
 *
 *  - 카드가 바뀌고 0.8초 뒤 `.CardItem.current .card-cover` 에 `down` 이 붙는다.
 *    이때부터 보기(정답 후보)를 고를 수 있다. 그 전에 누르면 덮개에 막힌다.
 *  - 보기 중 **정답에는 `.answer` 클래스**가 붙어 있다(사이트가 data-answer=1 을 함께 넣는다).
 *  - 보기 클릭 처리(setCardQuestItem)는 `e.originalEvent.isTrusted` 가 false 면 **그냥 무시**한다.
 *    -> 합성 클릭은 절대 통하지 않는다. 신뢰된 클릭만 받는다.
 *  - 정답을 고르면 사이트가 1초 뒤 `.btnNextCard` 를 스스로 눌러 다음 카드로 넘어간다.
 *    (오답이면 넘어가지 않으므로 우리가 눌러 준다)
 */
object Recall {

    private val STATE_JS = """
        var card = document.querySelector('.CardItem.current') ||
                   document.querySelector('.CardItem.showing');
        if (!card) return { found: false };

        var cover = card.querySelector('.card-cover');
        var down = !!(cover && cover.className.indexOf('down') >= 0);

        // 이미 채점된 카드인지 (정답/오답 표시가 붙었거나 카드가 active/deactive 가 된다)
        var cls = ' ' + card.className + ' ';
        var answered = cls.indexOf(' active ') >= 0 || cls.indexOf(' deactive ') >= 0 ||
            !!card.querySelector('.card-quest-o, .card-quest-x, .show-answer');

        var target = card.querySelector('.answer');
        var options = card.querySelectorAll('.cc-table').length;

        return {
            found: true,
            idx: card.getAttribute('data-idx') || '',
            down: down,
            answered: answered,
            hasAnswer: !!target,
            options: options
        };
    """

    private val ANSWER_LOCATOR_JS = """
        var card = document.querySelector('.CardItem.current') ||
                   document.querySelector('.CardItem.showing');
        if (!card) return null;
        var t = card.querySelector('.answer');
        if (!t) return null;
        t.scrollIntoView({ block: 'center', inline: 'center' });
        var r = t.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: window.innerWidth };
    """

    private data class State(
        val idx: String,
        val down: Boolean,
        val answered: Boolean,
        val hasAnswer: Boolean,
    )

    private suspend fun readState(d: Driver): State? {
        val v = d.evalObjectOrNull(STATE_JS) ?: return null
        if (!v.optBoolean("found", false)) return null
        return State(
            idx = v.optString("idx", ""),
            down = v.optBoolean("down", false),
            answered = v.optBoolean("answered", false),
            hasAnswer = v.optBoolean("hasAnswer", false),
        )
    }

    /** 원본과 동일한 완료 판정 (Memorize 와 같은 로직을 공유). */
    private suspend fun checkStep2SuccessAndStop(d: Driver, stop: StopFlag): Boolean =
        Memorize.checkStep2SuccessAndStop(d, stop)

    val run: ModeFn = { d, _, stop ->
        d.log("[리콜] 시작")

        var lastIdx: String? = null
        var sameIdx = 0
        var noCard = 0
        var warnedTrusted = false

        try {
            while (!stop.isSet) {
                if (checkStep2SuccessAndStop(d, stop)) break
                if (Memorize.startStudyIfNeeded(d, stop)) continue

                val st = readState(d)
                if (st == null) {
                    noCard++
                    if (noCard == 10) {
                        d.log("[리콜] 카드를 찾지 못했습니다. 리콜 학습 화면이 맞는지 확인하세요.")
                    }
                    if (noCard > 60) {
                        d.log("[리콜] 카드가 없어 종료합니다.")
                        break
                    }
                    if (stop.await(400)) break
                    continue
                }
                noCard = 0

                // 같은 카드에 계속 머물면(정답 클릭이 안 먹는 경우) 다음 카드로 밀어 본다
                if (st.idx.isNotEmpty() && st.idx == lastIdx) sameIdx++ else { sameIdx = 0; lastIdx = st.idx }

                // 이미 채점된 카드 -> 다음 카드로
                if (st.answered) {
                    d.clickFirstVisible(".btnNextCard")
                    if (Memorize.waitWithCheck(d, stop, total = 800)) break
                    continue
                }

                // 덮개가 아직 내려오지 않았다 (카드 전환 후 0.8초). 내려올 때까지 기다린다.
                if (!st.down) {
                    if (Memorize.waitWithCheck(d, stop, total = 400)) break
                    continue
                }

                if (!st.hasAnswer) {
                    d.log("[리콜] 이 카드에서 정답 보기를 찾지 못했습니다 — 다음 카드로 넘어갑니다.")
                    d.clickFirstVisible(".btnNextCard")
                    if (Memorize.waitWithCheck(d, stop, total = 800)) break
                    continue
                }

                // 정답 보기를 신뢰된 클릭으로 누른다. (합성 클릭은 사이트가 무시한다)
                val clicked = d.trustedClick(ANSWER_LOCATOR_JS)
                if (!clicked && !warnedTrusted) {
                    warnedTrusted = true
                    d.log("[리콜] 신뢰된 클릭을 보내지 못했습니다 — 화면이 보이는 상태인지 확인하세요.")
                }

                // 정답이면 사이트가 1초 뒤 스스로 다음 카드로 넘어간다.
                if (Memorize.waitWithCheck(d, stop, total = 1800)) break

                val after = readState(d)
                if (after != null && after.idx == st.idx && !after.answered && sameIdx >= 3) {
                    // 세 번 눌러도 그대로면 다음 카드로 밀어 진행을 계속한다
                    d.clickFirstVisible(".btnNextCard")
                    if (Memorize.waitWithCheck(d, stop, total = 800)) break
                } else if (after != null && after.answered) {
                    // 채점됐는데 자동으로 안 넘어가면(오답) 다음 카드를 눌러 준다
                    if (Memorize.waitWithCheck(d, stop, total = 700)) break
                    val still = readState(d)
                    if (still != null && still.idx == st.idx) d.clickFirstVisible(".btnNextCard")
                }
            }
        } catch (e: Throwable) {
            if (!stop.isSet) d.log("[리콜] 오류: ${e.message}")
        } finally {
            d.log("[리콜] 종료")
        }
    }
}
