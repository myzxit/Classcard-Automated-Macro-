package com.classcard.automation.modules

import com.classcard.automation.core.AntiBlur
import com.classcard.automation.core.Driver
import com.classcard.automation.core.Norm
import com.classcard.automation.core.StopFlag
import com.classcard.automation.core.jsStr
import kotlin.random.Random

/** Scramble.py 이식 — 문장 어순 배열 게임 자동 풀이. */
object Scramble {

    /** 진단용: true 면 스크램블 과정을 로그에 출력. */
    var DEBUG = false

    /**
     * 필수 학습(4000점)을 채우되 끝까지 가지 않도록, 이 범위 안에서 목표 점수를 정해
     * 도달하면 게임 도중에 빠져나간다 (점수는 저장됨).
     */
    var EXIT_SCORE_MIN = 4000
    var EXIT_SCORE_MAX = 5000

    private const val PROMPT_SELECTOR = ".quest-back"                      // 한국어 문제 문장
    private const val PLACED_SELECTOR = ".user-input-body .user-box"       // 배치한 단어 (? = 빈칸)
    private const val WORD_SELECTOR = ".suggest-body .word-box:not(.clicked)"  // 후보 단어 타일
    private const val SCORE_SELECTOR = ".txt-total-score"                  // 현재 점수

    private data class State(val prompt: String, val placed: List<String>, val cands: List<String>)

    /**
     * knorm(back 한국어) -> front(영어 문장) 맵.
     * 페이지 전역 study_data 우선, 실패 시 전달받은 단어장 폴백.
     */
    private suspend fun buildLookup(d: Driver, answerDict: AnswerDict?): Map<String, String>? {
        val cards = d.evalArrayOrNull(
            "return (typeof study_data !== 'undefined' && study_data) ? study_data : null;"
        )
        val lookup = HashMap<String, String>()

        if (cards != null && cards.length() > 0) {
            d.log("[스크램블] 페이지 study_data 로드 (카드 ${cards.length()}개)")
            for (i in 0 until cards.length()) {
                val c = cards.optJSONObject(i) ?: continue
                val front = c.optString("front", "")
                val back = c.optString("back", "")
                if (front.isNotEmpty() && back.isNotEmpty()) {
                    lookup[Norm.knorm(back)] = Norm.stripTags(front).trim()
                }
            }
            return lookup
        }

        if (answerDict.isNullOrEmpty()) {
            d.log("[스크램블] 오류: study_data도 없고 단어장도 없습니다.")
            return null
        }
        d.log("[스크램블] 단어장 폴백 로드 (카드 ${answerDict.size}개)")
        for ((back, front) in answerDict) {
            if (front.isNotEmpty() && back.isNotEmpty()) {
                lookup[Norm.knorm(back)] = Norm.stripTags(front).trim()
            }
        }
        return lookup
    }

    private suspend fun readState(d: Driver): State? {
        val data = d.evalObjectOrNull(
            """
            var qb = document.querySelector(${PROMPT_SELECTOR.jsStr()});
            var prompt = qb ? (qb.textContent || '').trim() : '';

            var placed = [];
            var ub = document.querySelectorAll(${PLACED_SELECTOR.jsStr()});
            for (var i = 0; i < ub.length; i++) {
                var t = (ub[i].textContent || '').trim();
                if (t && t !== '?') placed.push(t);
            }

            var cands = [];
            var wb = document.querySelectorAll(${WORD_SELECTOR.jsStr()});
            for (var i = 0; i < wb.length; i++) {
                cands.push((wb[i].textContent || '').trim());
            }

            return { prompt: prompt, placed: placed, cands: cands };
            """
        ) ?: return null

        fun list(key: String): List<String> {
            val arr = data.optJSONArray(key) ?: return emptyList()
            return (0 until arr.length()).map { arr.optString(it, "") }
        }
        return State(data.optString("prompt", ""), list("placed"), list("cands"))
    }

    /**
     * 배치된 박스(placed)가 표준형 targetWords 의 어느 인덱스까지 채웠는지.
     * 박스 하나가 여러 토큰을 덮을 수 있다('without.' = 'without'+'.').
     * 정렬이 깨지면 null.
     */
    fun alignIndex(targetWords: List<String>, placed: List<String>): Int? {
        var ci = 0
        for (p in placed) {
            val pn = Norm.scrambleNorm(p)
            if (pn.isEmpty()) continue
            var acc = ""
            while (ci < targetWords.size && acc != pn) {
                acc += Norm.scrambleNorm(targetWords[ci])
                ci++
            }
            if (acc != pn) return null
        }
        return ci
    }

    /** 다음에 클릭할 후보 인덱스. (idx, need) — 원본 find_next_index 와 동일 반환 규약. */
    fun findNextIndex(
        targetWords: List<String>, placed: List<String>, cands: List<String>,
    ): Pair<Int?, String?> {
        var ci = alignIndex(targetWords, placed) ?: placed.size  // 정렬 실패 시 보수적 폴백
        if (ci >= targetWords.size) return null to null

        val need = targetWords[ci]

        // ci부터: 타일이 가질 수 있는 형태 = 토큰 단독, 또는 단어 + 뒤따르는 문장부호 합본
        val options = HashSet<String>()
        var acc = ""
        var j = ci
        while (j < targetWords.size) {
            acc += targetWords[j]
            val n = Norm.scrambleNorm(acc)
            if (n.isNotEmpty()) options.add(n)
            val nxt = if (j + 1 < targetWords.size) targetWords[j + 1] else null
            if (nxt != null && Norm.isNonWordOnly(nxt)) {
                j++   // 다음이 문장부호면 'without.' 합본도 후보로
                continue
            }
            break
        }

        // 1) 표준 매칭 (대소문자/따옴표 무시, 구두점 유지)
        for ((idx, c) in cands.withIndex()) {
            if (Norm.scrambleNorm(c) in options) return idx to need
        }

        // 2) 폴백: 구두점까지 무시하고 단어만 일치 (순수 문장부호는 제외)
        val nn = Norm.wnorm(need)
        if (nn.isNotEmpty()) {
            for ((idx, c) in cands.withIndex()) {
                if (Norm.wnorm(c) == nn) return idx to need
            }
        }

        return null to need
    }

    private suspend fun clickWord(d: Driver, index: Int): Boolean = d.clickIndex(WORD_SELECTOR, index)

    /** 현재 점수(.txt-total-score). 못 읽으면 null. */
    private suspend fun readScore(d: Driver): Int? = d.evalIntOrNull(
        """
        var els = document.querySelectorAll(${SCORE_SELECTOR.jsStr()});
        for (var i = 0; i < els.length; i++) {
            var n = parseInt((els[i].textContent || '').replace(/[^0-9]/g, ''), 10);
            if (!isNaN(n)) return n;
        }
        return null;
        """
    )

    /**
     * 게임/점수 화면에서 '학습 종료'(history.back)로 셋홈 복귀.
     * 스크램블은 상단 뒤로가기가 곧바로 history.back()이라 별도 확인 모달이 없다.
     */
    private suspend fun returnToSetHome(d: Driver, stop: StopFlag, timeoutMs: Long = 10000): Boolean =
        Matching.returnToSetHome(d, stop, timeoutMs)

    /** 게임 종료 화면(점수/랭킹판)이 보이면 셋홈 복귀 후 stop. */
    private suspend fun checkEndAndStop(d: Driver, stop: StopFlag): Boolean {
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
        d.log("[스크램블] 시작")

        AntiBlur.inject(d) // 백그라운드 실행 시 '이탈 감지' 우회

        val lookup = buildLookup(d, answerDict)
        if (lookup == null) {
            d.log("[스크램블] 종료")
        } else {
            val targetScore = Random.nextInt(EXIT_SCORE_MIN, EXIT_SCORE_MAX + 1)
            d.log("[스크램블] 목표 점수 $targetScore 도달 시 종료")

            var nomatchStreak = 0  // 다음 단어를 못 찾은 연속 횟수

            try {
                while (!stop.isSet) {
                    if (checkEndAndStop(d, stop)) break

                    // 목표 점수 도달 시 셋홈으로 빠져나감 (점수는 저장됨)
                    val score = readScore(d)
                    if (score != null && score >= targetScore) {
                        d.log("[스크램블] 목표 점수 도달 (현재 $score) -> 종료")
                        returnToSetHome(d, stop)
                        stop.set()
                        break
                    }

                    val state = readState(d)
                    if (state == null || state.prompt.isEmpty()) {
                        if (stop.await(300)) break
                        continue
                    }

                    val target = lookup[Norm.knorm(state.prompt)]
                    if (target.isNullOrEmpty()) {
                        if (DEBUG) d.log("[스크램블] 문제 매칭 실패: '${state.prompt}'")
                        if (stop.await(400)) break
                        continue
                    }

                    val targetWords = Norm.splitTargetWords(target)
                    val (idx, need) = findNextIndex(targetWords, state.placed, state.cands)

                    if (idx == null && need == null) {
                        // 문장 완성 -> 다음 문제 대기
                        if (stop.await(300)) break
                        continue
                    }

                    if (idx == null) {
                        // 다음 단어가 아직 후보에 없음 (애니메이션/로딩) -> 잠시 후 재시도
                        nomatchStreak++
                        if (DEBUG) {
                            d.log("[스크램블] 다음 단어 '$need' 후보에 없음 (cands=${state.cands})")
                        }
                        if (nomatchStreak >= 10) {
                            if (checkEndAndStop(d, stop)) break
                        }
                        if (stop.await(300)) break
                        continue
                    }
                    nomatchStreak = 0

                    if (DEBUG) {
                        d.log("[스크램블] ${state.placed.size + 1}/${targetWords.size} -> '$need' (idx $idx)")
                    }

                    clickWord(d, idx)
                    if (stop.await(250)) break
                }
            } catch (e: Throwable) {
                if (!stop.isSet) d.log("[스크램블] 오류: ${e.message}")
            } finally {
                d.log("[스크램블] 종료")
            }
        }
    }
}
