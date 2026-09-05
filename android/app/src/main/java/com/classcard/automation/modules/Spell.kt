package com.classcard.automation.modules

import com.classcard.automation.core.Driver
import com.classcard.automation.core.Norm
import com.classcard.automation.core.StopFlag
import com.classcard.automation.core.jsStr

/** Spell.py 이식 — 스펠(타이핑) 자동화. */
object Spell {

    private const val INPUT_SELECTOR = "input[name=\"input_answer\"]"

    /** 카드 전환 대기 결과. 원본의 'changed' | 'done' | 'stopped' | 'stuck'. */
    private enum class WaitResult { CHANGED, DONE, STOPPED, STUCK }

    /**
     * 현재 카드(.CardItem.current)의 (data-idx, 제시어 텍스트).
     * 제시어는 보이는 `.spell-answer .spell-content` (한국어 의미).
     */
    private suspend fun getActiveCard(d: Driver): Pair<String?, String> {
        val res = d.evalObjectOrNull(
            """
            var card = document.querySelector('.CardItem.current');
            if (!card) return null;
            var conts = card.querySelectorAll('.spell-answer .spell-content');
            var prompt = '';
            for (var i = 0; i < conts.length; i++) {
                var t = (conts[i].textContent || '').trim();
                if (t) { prompt = t; break; }
            }
            return {idx: card.getAttribute('data-idx'), prompt: prompt};
            """
        ) ?: return null to ""
        val idx = if (res.isNull("idx")) null else res.optString("idx")
        return idx to res.optString("prompt", "")
    }

    /**
     * 제시어(prompt)에 해당하는 입력 정답.
     * 기본은 back(의미) -> front(단어). 단어 제시 모드 대비로 front -> back 역방향도 시도.
     */
    fun findAnswer(answerDict: AnswerDict, prompt: String): String? {
        val p = Norm.squeeze(prompt)
        for ((back, front) in answerDict) {
            if (p == Norm.squeeze(back)) return front
        }
        for ((back, front) in answerDict) {
            if (p == Norm.squeeze(front)) return back
        }
        return null
    }

    /** `#study_end.active` 또는 `.btn-study-end-repeat` 가 보이면 완료. set 페이지로 복귀 후 stop. */
    private suspend fun checkStep2SuccessAndStop(d: Driver, stop: StopFlag): Boolean {
        val done = d.evalBool(
            """
            var btns = document.querySelectorAll(".btn-study-end-repeat");
            for (var i = 0; i < btns.length; i++) {
                if (btns[i].offsetParent !== null) return true;
            }
            return document.querySelectorAll("#study_end.active").length > 0;
            """
        )
        if (!done) return false
        d.exec("""var a = document.querySelectorAll("#study_end.active .study-header a"); if (a.length) a[0].click();""")
        d.exec("""var a = document.querySelectorAll(".btn-top-menu a"); if (a.length) a[0].click();""")
        stop.sleep(500)
        d.exec("""var a = document.querySelectorAll(".close_o"); if (a.length) a[0].click();""")
        stop.set()
        return true
    }

    /**
     * 보이는 입력창을 찾아 포커스 + 값 설정.
     * (card-top 의 input 은 hidden 이라 제외해야 한다 — 원본 get_active_input 과 동일 규칙)
     * @return 입력창을 찾았으면 true
     */
    private suspend fun fillActiveInput(d: Driver, text: String): Boolean = d.evalBool(
        """
        function visibleInput(root) {
            var els = root.querySelectorAll(${INPUT_SELECTOR.jsStr()});
            for (var i = 0; i < els.length; i++) {
                if (els[i].offsetParent !== null) return els[i];
            }
            return null;
        }
        var cur = document.querySelector('.CardItem.current');
        var el = cur ? visibleInput(cur) : null;
        if (!el) el = visibleInput(document);
        if (!el) return false;
        el.focus();
        var setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, ${text.jsStr()});
        el.dispatchEvent(new Event('input', {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
        return true;
        """
    )

    /** 보이는 입력창이 있는지만 확인. */
    private suspend fun hasActiveInput(d: Driver): Boolean = d.evalBool(
        """
        var els = document.querySelectorAll(${INPUT_SELECTOR.jsStr()});
        for (var i = 0; i < els.length; i++) {
            if (els[i].offsetParent !== null) return true;
        }
        return false;
        """
    )

    /** 현재 카드(data-idx)가 prevIdx 에서 바뀌거나 완료될 때까지 대기. */
    private suspend fun waitNextCard(
        d: Driver, stop: StopFlag, prevIdx: String?, timeout: Long = 2500,
    ): WaitResult {
        var elapsed = 0L
        while (elapsed < timeout) {
            if (stop.await(200)) return WaitResult.STOPPED
            elapsed += 200
            if (checkStep2SuccessAndStop(d, stop)) return WaitResult.DONE
            val (idx, _) = getActiveCard(d)
            if (idx != null && idx != prevIdx) return WaitResult.CHANGED
        }
        return WaitResult.STUCK
    }

    val run: ModeFn = { d, answerDict, stop ->
        d.log("[스펠] 시작")

        if (answerDict.isNullOrEmpty()) {
            d.log("[스펠] answer_dict가 없습니다. [단어장 가져오기]로 먼저 가져오세요.")
        } else {
            try {
                loop@ while (!stop.isSet) {
                    if (checkStep2SuccessAndStop(d, stop)) break

                    val (idx, prompt) = getActiveCard(d)
                    if (prompt.isEmpty()) {
                        if (checkStep2SuccessAndStop(d, stop)) break
                        if (stop.await(400)) break
                        continue
                    }

                    if (!hasActiveInput(d)) {
                        if (stop.await(300)) break
                        continue
                    }

                    val answer = findAnswer(answerDict, prompt)
                    if (answer != null) {
                        if (!fillActiveInput(d, answer)) {
                            if (stop.await(300)) break
                            continue
                        }
                        if (stop.await(100)) break
                        d.pressEnter()
                    } else {
                        // 정답을 모르면 빈 입력으로 제출 -> 정답 표시 후 다음으로 진행 (무한루프 방지)
                        d.log("[스펠] 매칭 실패(스킵): '$prompt'")
                        fillActiveInput(d, "")
                        d.pressEnter()
                    }

                    // 다음 카드로 넘어갈 때까지 대기. 안 넘어가면 진행 키 한 번 더.
                    when (waitNextCard(d, stop, idx, timeout = 2000)) {
                        WaitResult.STOPPED, WaitResult.DONE -> break@loop
                        WaitResult.STUCK -> {
                            d.blurActiveElement()
                            d.pressSpace()
                            val again = waitNextCard(d, stop, idx, timeout = 2000)
                            if (again == WaitResult.STOPPED || again == WaitResult.DONE) break@loop
                        }
                        WaitResult.CHANGED -> Unit
                    }
                }
            } catch (e: Throwable) {
                if (!stop.isSet) d.log("[스펠] 오류: ${e.message}")
            } finally {
                d.log("[스펠] 종료")
            }
        }
    }
}
