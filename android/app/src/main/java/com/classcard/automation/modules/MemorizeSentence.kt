package com.classcard.automation.modules

import com.classcard.automation.core.Driver
import com.classcard.automation.core.Norm
import com.classcard.automation.core.StopFlag
import com.classcard.automation.core.jsStr

/** MemorizeSentence.py 이식 — 문장 암기 자동화. */
object MemorizeSentence {

    /** 원본 get_korean_sentence — `.active span.para_item` 텍스트를 공백으로 이어 붙인다. */
    private suspend fun getKoreanSentence(d: Driver): String? = d.evalStringOrNull(
        """
        var els = document.querySelectorAll('.active span.para_item');
        if (!els.length) return null;
        var parts = [];
        for (var i = 0; i < els.length; i++) {
            var t = (els[i].innerText || els[i].textContent || '').trim();
            if (t) parts.push(t);
        }
        var text = parts.join(' ');
        return text ? text : null;
        """
    )

    /**
     * 현재 카드의 영어 정답 문장을 DOM 에서 직접 읽는다 (단어장 불필요).
     * 같은 `.CardItem.active` 안 step s1 의 `.text` 에 정답 영어 문장이 있다.
     */
    private suspend fun getActiveEnglish(d: Driver): String? = d.evalStringOrNull(
        """
        var card = document.querySelector('.CardItem.active');
        if (!card) return null;
        var t = card.querySelector('.step.s1 .front .text') || card.querySelector('.text');
        return t ? (t.textContent || '').trim() : null;
        """
    )

    /** `.btn-study-end-repeat` 버튼이 보이면 완료. set 페이지로 복귀 후 stop. */
    suspend fun checkStep2SuccessAndStop(d: Driver, stop: StopFlag): Boolean {
        val done = d.evalBool(
            """return document.querySelectorAll("#study_end.active .btn-study-end-repeat").length > 0;"""
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
     * 현재 카드의 식별 신호(영어 정답 문장 우선, 없으면 한국어 제시문).
     * 단어를 배치해도 바뀌지 않고 카드가 넘어가야만 바뀌므로 전환 감지에 안전하다.
     */
    private suspend fun cardSignal(d: Driver): String? =
        getActiveEnglish(d)?.takeIf { it.isNotEmpty() } ?: getKoreanSentence(d)

    /**
     * 문장 완성 후 SPACE 를 눌러 다음 카드로. 카드 신호가 바뀔 때까지 재시도(씹힘 대비).
     * 이미 바뀐 뒤에는 SPACE 를 다시 보내지 않으므로 카드 건너뛰기가 없다.
     */
    private suspend fun advanceToNext(d: Driver, stop: StopFlag, prevSignal: String?, maxTries: Int = 6) {
        for (i in 0 until maxTries) {
            d.pressSpace()
            var waited = 0L
            while (waited < 1000) {
                if (stop.await(200)) return
                waited += 200
                if (checkStep2SuccessAndStop(d, stop)) return
                val cur = cardSignal(d)
                if (!cur.isNullOrEmpty() && cur != prevSignal) return
            }
        }
    }

    /**
     * 단일 raw 토큰으로 화면 scramble-item 한 개 매칭 + 클릭. 못 찾으면 false.
     *
     * 이 스크램블 타일은 합성 click 을 무시하고 신뢰된 입력에만 반응한다
     * (원본이 Selenium 의 진짜 클릭을 쓴 이유. 문장 테스트도 같은 이유로 CDP 를 쓴다).
     * 그래서 신뢰된 클릭을 먼저 보내고, 불가능할 때만 합성 클릭으로 폴백한다.
     */
    private suspend fun tryClickToken(d: Driver, rawToken: String): Boolean {
        val isDash = rawToken == "-" || rawToken == "–" || rawToken == "—"
        val cleaned = if (isDash) "" else rawToken.replace(Regex("[^a-zA-Z0-9]"), "")
        if (!isDash && cleaned.isEmpty()) return false

        val find = """
            var DASH = $isDash;
            var target = ${cleaned.jsStr()};
            var items = document.querySelectorAll('.active .scramble-item:not(.clicked)');
            var hit = null;
            for (var i = 0; i < items.length; i++) {
                var raw = (items[i].textContent || '').trim();
                var t = DASH ? raw : raw.replace(/[^a-zA-Z0-9]/g, '');
                var ok = DASH ? (raw === '-' || raw === '–' || raw === '—') : (t === target);
                if (ok) { hit = items[i]; break; }
            }
        """.trimIndent()

        val clicked = d.trustedClick(
            find + """

            if (!hit) return null;
            hit.scrollIntoView({ block: 'center', inline: 'center' });
            var r = hit.getBoundingClientRect();
            if (!r.width || !r.height) return null;
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: window.innerWidth };
            """.trimIndent()
        )
        if (clicked) return true

        return d.evalBool(
            find + """

            if (!hit) return false;
            hit.click();
            return true;
            """.trimIndent()
        )
    }

    /** raw 토큰으로 클릭 시도. 통째 매칭 실패 시 하이픈/괄호로 분리해 부분 매칭 폴백. */
    private suspend fun clickScrambleWord(d: Driver, rawToken: String, stop: StopFlag): Boolean {
        if (tryClickToken(d, rawToken)) return true

        if (Regex("[-–—]").containsMatchIn(rawToken)) {
            var anyClicked = false
            for (sub in Norm.splitByDash(rawToken)) {
                if (tryClickToken(d, sub)) {
                    anyClicked = true
                    stop.sleep(150)
                }
            }
            if (anyClicked) return true
        }

        if (rawToken.contains('(') && rawToken.contains(')')) {
            var anyClicked = false
            for (sub in Norm.splitByParenGroup(rawToken)) {
                if (tryClickToken(d, sub)) {
                    anyClicked = true
                    stop.sleep(150)
                }
            }
            if (anyClicked) return true
        }

        return false
    }

    val run: ModeFn = { d, answerDict, stop ->
        d.log("[문장 암기] 시작")
        try {
            loop@ while (!stop.isSet) {
                d.pressSpace()
                if (stop.await(300)) break
                d.pressSpace()
                if (stop.await(300)) break

                // 1) 정답 영어 문장: DOM 에서 직접 읽기 (단어장 불필요)
                var englishSentence = getActiveEnglish(d)

                // 2) 폴백: DOM 에서 못 읽으면 한국어 -> 단어장 매칭
                if (englishSentence.isNullOrEmpty() && !answerDict.isNullOrEmpty()) {
                    val koreanText = getKoreanSentence(d)
                    if (!koreanText.isNullOrEmpty()) {
                        val normalizedKorean = Norm.normalizeText(koreanText)
                        for (key in answerDict.keys) {
                            if (normalizedKorean == Norm.normalizeText(key)) {
                                englishSentence = answerDict[key]
                                break
                            }
                        }
                    }
                }

                if (englishSentence.isNullOrEmpty()) {
                    if (checkStep2SuccessAndStop(d, stop)) break
                    if (stop.await(300)) break
                    continue
                }

                // 다음 카드 전환 감지용 신호 (배치 전에 캡처)
                val prevSignal = cardSignal(d)

                val words = Norm.parseEnglishWords(englishSentence)

                for (word in words) {
                    if (stop.isSet) break
                    // 타일이 7개씩 창처럼 보여 아직 안 나타났을 수 있으니 재시도
                    for (i in 0 until 10) {
                        if (clickScrambleWord(d, word, stop)) break
                        if (stop.await(200)) break
                    }
                    if (stop.await(150)) break
                }

                if (stop.isSet) break
                if (stop.await(300)) break

                // 단어 배치 완료 -> 카드가 실제로 넘어갈 때까지 SPACE 재시도 (씹힘 대비)
                advanceToNext(d, stop, prevSignal)

                if (checkStep2SuccessAndStop(d, stop)) break
            }
        } catch (e: Throwable) {
            if (!stop.isSet) d.log("[문장 암기] 오류: ${e.message}")
        } finally {
            d.log("[문장 암기] 종료")
        }
    }
}
