package com.classcard.automation.modules

import com.classcard.automation.core.Driver
import com.classcard.automation.core.StopFlag

/** Recall.py 이식 — 단어 리콜 자동화. */
object Recall {

    /**
     * 원본 `click_answer`.
     * `.card-cover.down` 이 사라지길 기다린 뒤, 보이는 `.showing` 안의 `.answer` 를 클릭한다.
     */
    private suspend fun clickAnswer(d: Driver, stop: StopFlag) {
        // .card-cover.down 이 안 보일 때까지 대기 (원본 timeout 10초, 타임아웃은 무시하고 진행)
        val deadline = System.currentTimeMillis() + 10_000
        while (System.currentTimeMillis() < deadline) {
            val covered = d.evalBool(
                """
                var els = document.querySelectorAll('.card-cover.down');
                for (var i = 0; i < els.length; i++) {
                    if (els[i].offsetParent !== null) return true;
                }
                return false;
                """
            )
            if (!covered) break
            if (stop.await(200)) return
        }

        // 보이는 .showing 안의 .answer 클릭
        d.evalBool(
            """
            var cards = document.querySelectorAll('.showing');
            for (var i = 0; i < cards.length; i++) {
                if (cards[i].offsetParent === null) continue;
                var t = cards[i].querySelector('.answer');
                if (t) { t.click(); return true; }
            }
            return false;
            """
        )
    }

    /** 원본과 동일한 완료 판정 (Memorize 와 같은 로직을 공유). */
    private suspend fun checkStep2SuccessAndStop(d: Driver, stop: StopFlag): Boolean =
        Memorize.checkStep2SuccessAndStop(d, stop)

    val run: ModeFn = { d, _, stop ->
        d.log("[리콜] 시작")
        try {
            while (!stop.isSet) {
                if (checkStep2SuccessAndStop(d, stop)) break
                clickAnswer(d, stop)
                if (Memorize.waitWithCheck(d, stop, total = 1500)) break
            }
        } catch (e: Throwable) {
            if (!stop.isSet) d.log("[리콜] 오류: ${e.message}")
        } finally {
            d.log("[리콜] 종료")
        }
    }
}
