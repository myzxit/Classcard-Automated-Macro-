package com.classcard.automation.modules

import com.classcard.automation.core.Driver
import com.classcard.automation.core.StopFlag

/** 모든 자동화 모드의 공통 시그니처. 파이썬 `run_automation_loop(driver, answer_dict, stop_event)` 대응. */
typealias ModeFn = suspend (Driver, AnswerDict?, StopFlag) -> Unit

/** Memorize.py 이식 — 단어 암기 자동화. */
object Memorize {

    /**
     * 완료 종료 판단: `.btn-study-end-repeat` / `.next-repeat-percent` >= 100 /
     * `#study_end.active` 중 하나.
     *
     * 주의: 학습 페이지는 결과 패널(#study_end)을 처음부터 DOM 에 넣어 둔다. 그 안에
     * '<span class="next-repeat-percent">200</span>% 도전' 버튼이 있어서, 그냥 찾으면
     * **학습을 시작하자마자 '끝났다'고 판단해 버린다**(실제 페이지에서 확인).
     * 그래서 결과 패널 안의 것은 패널이 active 일 때만 인정한다.
     */
    suspend fun checkStep2SuccessAndStop(d: Driver, stop: StopFlag): Boolean {
        val done = d.evalBool(
            """
            function shown(el) {
                if (!el) return false;
                var r = el.getBoundingClientRect();
                if (!(r.width > 0 && r.height > 0)) return false;
                var s = window.getComputedStyle(el);
                return s.display !== "none" && s.visibility !== "hidden";
            }
            function endReady(el) {
                var p = el.closest ? el.closest("#study_end") : null;
                if (!p) return true;
                return (" " + p.className + " ").indexOf(" active ") >= 0;
            }
            var btns = document.querySelectorAll(".btn-study-end-repeat");
            for (var i = 0; i < btns.length; i++) {
                if (shown(btns[i]) && endReady(btns[i])) return true;
            }
            var ps = document.querySelectorAll(".next-repeat-percent");
            for (var i = 0; i < ps.length; i++) {
                if (shown(ps[i]) && endReady(ps[i]) && parseInt(ps[i].textContent) >= 100) return true;
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
     * 학습 페이지는 **시작 화면**으로 열린다 (실제 페이지에서 확인:
     * `<a class="btn btn-primary btn-block btn-opt-start">리콜 학습 시작 (1구간)</a>`).
     * 이 버튼을 누르기 전에는 `.CardItem.current` 가 없어 어떤 모드도 아무것도 할 수 없다.
     * 시작 화면이면 눌러 주고 true, 이미 학습 중이면 false.
     */
    /**
     * 카드 학습 화면(암기·리콜·스펠·문장 모드 공통)의 진행률을 화면에서 읽어 보고한다 (확장 reportCardProgress 와 같은 JS).
     *   전체 = .CardItem 수, 현재 = 보이는 카드의 순번, 성공 = data-status k, 실패 = data-status x
     */
    suspend fun reportCardProgress(d: Driver, label: String = "") {
        val p = d.evalObjectOrNull(
            """
            var items = document.querySelectorAll('.study-body .CardItem, .CardItem');
            if (!items.length) return null;
            var cur = document.querySelector('.CardItem.active') || document.querySelector('.CardItem.current');
            var idx = cur ? Array.prototype.indexOf.call(items, cur) + 1 : 0;
            var ok = 0, fail = 0;
            for (var i = 0; i < items.length; i++) {
                var st = items[i].getAttribute('data-status') || '';
                if (st === 'k' || st === 'xk') ok++; else if (st === 'x') fail++;
            }
            return { total: items.length, current: Math.max(idx, ok + fail), ok: ok, fail: fail };
            """
        ) ?: return
        val total = p.optInt("total"); val ok = p.optInt("ok"); val fail = p.optInt("fail")
        d.progress(p.optInt("current"), total, ok, fail, maxOf(0, total - ok - fail), label)
    }

    suspend fun startStudyIfNeeded(d: Driver, stop: StopFlag): Boolean {
        val need = d.evalBool(
            """
            function vis(el) { return el && el.offsetParent !== null; }
            if (vis(document.querySelector('.CardItem.current'))) return false;
            var btns = document.querySelectorAll('.btn-opt-start, .start-opt-body a.btn, .btn-quiz-start');
            for (var i = 0; i < btns.length; i++) if (vis(btns[i])) return true;
            return false;
            """
        )
        if (!need) return false

        d.log("학습 시작 화면입니다 — 시작 버튼을 누릅니다.")
        d.clickSmart(
            """
            function vis(el) { return el && el.offsetParent !== null; }
            var btns = document.querySelectorAll('.btn-opt-start, .start-opt-body a.btn, .btn-quiz-start');
            for (var i = 0; i < btns.length; i++) if (vis(btns[i])) { el = btns[i]; break; }
            """
        )
        stop.await(1500)
        return true
    }

    /** total 밀리초 동안 interval 간격으로 종료 체크하며 대기. 종료 발견 시 true. */
    suspend fun waitWithCheck(d: Driver, stop: StopFlag, total: Long, interval: Long = 200): Boolean {
        var elapsed = 0L
        while (elapsed < total) {
            val slice = minOf(interval, total - elapsed)
            if (stop.await(slice)) return true
            elapsed += slice
            if (checkStep2SuccessAndStop(d, stop)) return true
        }
        return false
    }

    /**
     * 현재 보이는 카드의 식별자(전환 감지용). data-idx 만 사용한다.
     * (flip 등으로 텍스트가 바뀌어도 같은 카드면 동일해야 하므로 textContent 폴백 금지.)
     */
    suspend fun getCardKey(d: Driver): String? = d.evalStringOrNull(
        """
        var c = document.querySelector('.CardItem.current')
             || document.querySelector('.CardItem.active')
             || document.querySelector('.showing');
        if (!c) return null;
        return c.getAttribute('data-idx') || c.getAttribute('data-card-idx') || null;
        """
    )

    /**
     * 현재 보이는 `.next-repeat-percent` 중 최댓값. 못 읽으면 null.
     * (원본 get_repeat_percent — 1회독 종료 판단에 쓰인다.)
     */
    suspend fun getRepeatPercent(d: Driver): Int? = d.evalIntOrNull(
        """
        var ps = document.querySelectorAll(".next-repeat-percent");
        var max = -1;
        for (var i = 0; i < ps.length; i++) {
            if (ps[i].offsetParent === null) continue;
            var v = parseInt(ps[i].textContent);
            if (!isNaN(v) && v > max) max = v;
        }
        return max < 0 ? null : max;
        """
    )

    /**
     * 종료 버튼(2회독 후에야 뜸) 없이 학습 화면을 빠져나가 set 홈으로 복귀.
     * 1회독 완료 시점에 중도 종료하기 위해 사용.
     */
    suspend fun exitStudyToSet(d: Driver, stop: StopFlag) {
        d.exec("""var a = document.querySelectorAll(".btn-top-menu a"); if (a.length) a[0].click();""")
        stop.sleep(500)
        d.exec("""var a = document.querySelectorAll(".close_o"); if (a.length) a[0].click();""")
        stop.set()
    }

    /** total 동안 카드 전환/완료/중지를 감지. 감지 시 true (재시도 종료). */
    private suspend fun waitChangeOrStop(
        d: Driver, stop: StopFlag, prevKey: String?, total: Long, interval: Long = 200,
    ): Boolean {
        var elapsed = 0L
        while (elapsed < total) {
            val slice = minOf(interval, total - elapsed)
            if (stop.await(slice)) return true
            elapsed += slice
            if (checkStep2SuccessAndStop(d, stop)) return true
            val cur = getCardKey(d)
            if (cur != null && cur != prevKey) return true
        }
        return false
    }

    val run: ModeFn = run@{ d, _, stop ->
        d.log("[암기] 시작")
        try {
            while (!stop.isSet) {
                reportCardProgress(d, "암기")
                if (checkStep2SuccessAndStop(d, stop)) break
                if (startStudyIfNeeded(d, stop)) continue

                val prev = getCardKey(d)

                if (prev == null) {
                    // 카드 식별 불가(페이지 구조 차이) -> 기존 타이머 방식
                    d.pressSpace()
                    if (waitWithCheck(d, stop, total = 600)) break
                    d.pressShiftSpace()
                    if (waitWithCheck(d, stop, total = 1300)) break
                    continue
                }

                // 카드가 실제로 넘어갈 때까지 SPACE -> SHIFT+SPACE 재시도 (씹힘 대비, 최대 8회)
                for (i in 0 until 8) {
                    d.pressSpace()
                    if (waitChangeOrStop(d, stop, prev, total = 600)) break
                    d.pressShiftSpace()
                    if (waitChangeOrStop(d, stop, prev, total = 1300)) break
                }
                if (stop.isSet) break
            }
        } catch (e: Throwable) {
            if (!stop.isSet) d.log("[암기] 오류: ${e.message}")
        } finally {
            d.log("[암기] 종료")
        }
    }
}
