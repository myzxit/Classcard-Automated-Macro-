package com.classcard.automation.modules

import com.classcard.automation.core.AntiBlur
import com.classcard.automation.core.Driver
import com.classcard.automation.core.Norm
import com.classcard.automation.core.Similarity
import com.classcard.automation.core.StopFlag
import com.classcard.automation.core.jsStr
import kotlin.random.Random

/** Matching.py 이식 — 영어↔한국어 카드 매칭 게임 자동 풀이. */
object Matching {

    /** 진단용: true 면 매칭 과정을 로그에 출력. */
    var DEBUG = false

    /**
     * 이 범위에서 목표 점수를 뽑아, 도달하면 게임 도중에 '매칭종료'로 빠져나간다
     * (점수는 서버에 저장됨). 실행마다 목표가 조금씩 달라져 사람처럼 보인다.
     */
    var EXIT_SCORE_MIN = 7000
    var EXIT_SCORE_MAX = 8500

    const val LEFT_CARD_SELECTOR = ".match-body.left .flip-card"    // 영어
    const val RIGHT_CARD_SELECTOR = ".match-body.right .flip-card"  // 한국어

    internal data class BoardCard(val index: Int, val raw: String, val norm: String)
    private data class Board(val left: List<BoardCard>, val right: List<BoardCard>)

    /**
     * 현재 매칭 페이지의 전역 card_list(front=영어/back=한국어)로 양방향 맵을 만든다.
     * 실패 시 전달받은 단어장으로 폴백 (원본의 data.json 폴백에 대응).
     */
    private suspend fun buildLookups(d: Driver, answerDict: AnswerDict?): Test.Lookups? {
        val cards = d.evalArrayOrNull(
            "return (typeof card_list !== 'undefined' && card_list) ? card_list : null;"
        )
        val fwd = HashMap<String, String>()
        val bwd = HashMap<String, String>()

        if (cards != null && cards.length() > 0) {
            d.log("[매칭] 페이지 card_list 로드 (카드 ${cards.length()}개)")
            for (i in 0 until cards.length()) {
                val c = cards.optJSONObject(i) ?: continue
                val front = c.optString("front", "")
                val back = c.optString("back", "")
                if (front.isNotEmpty()) fwd[Norm.mnormHtml(front)] = back
                if (back.isNotEmpty()) bwd[Norm.mnormHtml(back)] = front
            }
            return Test.Lookups(fwd, bwd)
        }

        if (answerDict.isNullOrEmpty()) {
            d.log("[매칭] 오류: card_list도 없고 단어장도 없습니다.")
            return null
        }
        d.log("[매칭] 단어장 폴백 로드 (카드 ${answerDict.size}개)")
        for ((back, front) in answerDict) {
            if (front.isNotEmpty()) fwd[Norm.mnormHtml(front)] = back
            if (back.isNotEmpty()) bwd[Norm.mnormHtml(back)] = front
        }
        return Test.Lookups(fwd, bwd)
    }

    /** 현재 보드의 좌(영어)/우(한국어) 카드를 인덱스 순서대로 읽는다. */
    private suspend fun readBoard(d: Driver): Board? {
        val data = d.evalObjectOrNull(
            """
            function read(sel) {
              var out = [];
              var cards = document.querySelectorAll(sel);
              for (var i = 0; i < cards.length; i++) {
                var c = cards[i];
                var t = c.querySelector('.match-text > div[style*="font-size"]');
                out.push((t ? t.textContent : '').trim());
              }
              return out;
            }
            return { left: read(${LEFT_CARD_SELECTOR.jsStr()}), right: read(${RIGHT_CARD_SELECTOR.jsStr()}) };
            """
        ) ?: return null

        fun conv(key: String): List<BoardCard> {
            val arr = data.optJSONArray(key) ?: return emptyList()
            return (0 until arr.length()).map { i ->
                val raw = arr.optString(i, "").trim()
                BoardCard(i, raw, Norm.mnormHtml(raw))
            }
        }
        return Board(conv("left"), conv("right"))
    }

    internal data class Pair4(val li: Int, val ri: Int, val lraw: String, val rraw: String)

    /** 좌(영어)/우(한국어)에서 확실한 한 쌍을 찾는다. */
    internal fun findPair(lefts: List<BoardCard>, rights: List<BoardCard>, lk: Test.Lookups): Pair4? {
        // 1) 정확 매칭: 영어 -> 정답 한국어 -> 보기 (정확/부분)
        for (l in lefts) {
            if (l.norm.isEmpty()) continue
            val kr = lk.fwd[l.norm] ?: lk.bwd[l.norm] ?: continue
            val krn = Norm.mnormHtml(kr)
            for (r in rights) {
                if (r.norm.isNotEmpty() && r.norm == krn) return Pair4(l.index, r.index, l.raw, r.raw)
            }
            for (r in rights) {
                if (krn.isNotEmpty() && r.norm.isNotEmpty() &&
                    (krn.contains(r.norm) || r.norm.contains(krn))
                ) {
                    return Pair4(l.index, r.index, l.raw, r.raw)
                }
            }
        }

        // 2) 유사도 폴백: 부가설명/구두점 차이 대비
        var bestScore = -1.0
        var bestPair: Pair4? = null
        for (l in lefts) {
            if (l.norm.isEmpty()) continue
            val kr = lk.fwd[l.norm] ?: lk.bwd[l.norm] ?: continue
            val krn = Norm.mnormHtml(kr)
            for (r in rights) {
                val s = Similarity.ratio(krn, r.norm)
                if (bestPair == null || s > bestScore) {
                    bestScore = s
                    bestPair = Pair4(l.index, r.index, l.raw, r.raw)
                }
            }
        }
        if (bestPair != null && bestScore >= 0.6) return bestPair

        return null
    }

    /** 좌측 카드 텍스트 집합이 바뀔 때까지 대기 (매칭 성공 -> 카드 교체 감지). */
    private suspend fun waitBoardChange(
        d: Driver, stop: StopFlag, prevLeft: List<BoardCard>, timeoutMs: Long = 2500,
    ): Boolean {
        val prev = prevLeft.map { it.raw }.toSet()
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (stop.await(200)) return true
            val board = readBoard(d) ?: continue
            val cur = board.left.map { it.raw }.toSet()
            if (cur != prev) return false
        }
        return false
    }

    /** 현재 매칭 점수(.match-top .point). 못 읽으면 null. */
    private suspend fun readScore(d: Driver): Int? = d.evalIntOrNull(
        """
        var els = document.querySelectorAll('.match-top .point');
        for (var i = 0; i < els.length; i++) {
            if (els[i].offsetParent !== null) {
                var n = parseInt((els[i].textContent || '').replace(/[^0-9]/g, ''), 10);
                if (!isNaN(n)) return n;
            }
        }
        var e = document.querySelector('.match-top .point');
        if (e) {
            var n = parseInt((e.textContent || '').replace(/[^0-9]/g, ''), 10);
            if (!isNaN(n)) return n;
        }
        return null;
        """
    )

    /** set 상세(셋홈) 페이지인지: `.btn-summary` 가 있으면 true. */
    suspend fun isSetHome(d: Driver): Boolean =
        d.evalBool("return document.querySelectorAll('.btn-summary').length > 0;")

    /** 게임 종료 후 점수/랭킹 화면에서 '학습 종료'(history.back)로 셋홈 복귀. */
    suspend fun returnToSetHome(d: Driver, stop: StopFlag, timeoutMs: Long = 8000): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (stop.isSet || isSetHome(d)) return true
            val clicked = d.evalBool(
                """
                function txt(el){ return (el.textContent || '').trim(); }
                // 1) '학습 종료' 텍스트 링크
                var as = document.querySelectorAll(
                    '.start-opt-body a, .end-opt-body a, a[onclick*="history.back"]');
                for (var i = 0; i < as.length; i++) {
                    if (/학습\s*종료/.test(txt(as[i]))) { as[i].click(); return true; }
                }
                // 2) '종료'(btn-rank-cancel)
                var c = document.querySelector('.btn-rank-cancel');
                if (c) { c.click(); return true; }
                return false;
                """
            )
            if (!clicked) {
                d.exec("history.back();")
            }
            stop.sleep(500)
        }
        return isSetHome(d)
    }

    /**
     * 게임 도중 상단 뒤로가기 -> 확인 모달 '매칭종료'(.btn-ok) -> 점수 화면 '학습 종료'
     * 까지 눌러 셋홈 복귀 후 stop. (점수는 서버에 저장됨)
     */
    private suspend fun exitMidGame(d: Driver, stop: StopFlag): Boolean {
        try {
            d.exec(
                """
                var b = document.querySelector('.study-header .btn-back');
                if (b) b.click(); else history.back();
                """
            )

            // 확인 모달은 position:fixed (offsetParent=null)이므로 .in/display로 판정
            val deadline = System.currentTimeMillis() + 5000
            while (System.currentTimeMillis() < deadline) {
                if (stop.isSet) break
                val clicked = d.evalBool(
                    """
                    var m = document.querySelector('#confirmModal');
                    if (!m) return false;
                    var shown = m.classList.contains('in')
                        || getComputedStyle(m).display !== 'none';
                    if (!shown) return false;
                    var b = m.querySelector('.btn-ok');
                    if (b) { b.click(); return true; }
                    return false;
                    """
                )
                if (clicked) break
                stop.sleep(200)
            }

            stop.sleep(800)
            // 점수/랭킹 화면 -> '학습 종료'로 셋홈 복귀
            returnToSetHome(d, stop)
        } finally {
            stop.set()
        }
        return true
    }

    /** 게임 종료 화면(점수/랭킹판)이 보이면 셋홈 복귀 후 stop. */
    suspend fun checkEndAndStop(d: Driver, stop: StopFlag): Boolean {
        val ended = d.evalBool(
            """
            function vis(el){ return el && el.offsetParent !== null; }
            return vis(document.querySelector('.start-opt-body'))
                || vis(document.querySelector('.end-opt-body'));
            """
        )
        if (!ended) return false
        returnToSetHome(d, stop)
        stop.set()
        return true
    }

    val run: ModeFn = { d, answerDict, stop ->
        d.log("[매칭] 시작")

        AntiBlur.inject(d) // 백그라운드 실행 시 '이탈 감지' 우회

        val lk = buildLookups(d, answerDict)
        if (lk == null) {
            d.log("[매칭] 종료")
        } else {
            val targetScore = Random.nextInt(EXIT_SCORE_MIN, EXIT_SCORE_MAX + 1)
            d.log("[매칭] 목표 점수 $targetScore 도달 시 중도 종료")

            var emptyStreak = 0    // 보드가 비어있는 연속 횟수 (게임 종료 추정)
            var nomatchStreak = 0  // 매칭 쌍을 못 찾은 연속 횟수

            try {
                while (!stop.isSet) {
                    if (checkEndAndStop(d, stop)) break

                    // 목표 점수 도달 시 게임 도중 '매칭종료'로 빠져나감 (점수는 저장됨)
                    val score = readScore(d)
                    if (score != null && score >= targetScore) {
                        d.log("[매칭] 목표 점수 도달 (현재 $score) -> 중도 종료")
                        exitMidGame(d, stop)
                        break
                    }

                    val board = readBoard(d)
                    if (board == null) {
                        if (stop.await(300)) break
                        continue
                    }

                    val lefts = board.left
                    val rights = board.right

                    // 보드가 비었으면 게임 종료(결과 화면 대기) 가능성
                    if (lefts.isEmpty() && rights.isEmpty()) {
                        emptyStreak++
                        if (emptyStreak >= 5) {
                            if (checkEndAndStop(d, stop)) break
                        }
                        if (stop.await(300)) break
                        continue
                    }
                    emptyStreak = 0

                    val pair = findPair(lefts, rights, lk)

                    if (pair == null) {
                        nomatchStreak++
                        if (DEBUG) d.log("[매칭] 쌍 못 찾음 (left=${lefts.map { it.raw }})")
                        // 카드 교체 타이밍과 겹쳤을 수 있으니 잠시 후 재시도
                        if (nomatchStreak >= 8) {
                            if (checkEndAndStop(d, stop)) break
                        }
                        if (stop.await(400)) break
                        continue
                    }
                    nomatchStreak = 0

                    if (DEBUG) {
                        d.log("[매칭] '${pair.lraw}' <-> '${pair.rraw}' (L${pair.li}/R${pair.ri})")
                    }

                    // 한국어(우) 먼저, 영어(좌) 나중 클릭
                    d.clickIndex(RIGHT_CARD_SELECTOR, pair.ri)
                    if (stop.await(150)) break
                    d.clickIndex(LEFT_CARD_SELECTOR, pair.li)

                    // 매칭 성공 -> 카드 교체될 때까지 대기
                    if (waitBoardChange(d, stop, lefts, timeoutMs = 2500)) break
                }
            } catch (e: Throwable) {
                if (!stop.isSet) d.log("[매칭] 오류: ${e.message}")
            } finally {
                d.log("[매칭] 종료")
            }
        }
    }
}
