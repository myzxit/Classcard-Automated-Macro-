package com.classcard.automation.modules

import com.classcard.automation.core.Driver
import com.classcard.automation.core.Norm
import com.classcard.automation.core.StopFlag
import com.classcard.automation.core.jsStr

/**
 * RecallSentence.py 이식 — 문장 리콜 자동화.
 *
 * 정답 문장은 페이지가 `console.log('arr_front', ...)` 로 출력하는 값을 가로채
 * `window.__cc_answers` 에 모아 둔 것을 쓴다(assets/preload.js 가 문서 시작 시점에 후킹).
 * 리콜은 완성 정답이 DOM/전역에 없으므로 이 경로가 유일하게 안전하다.
 */
object RecallSentence {

    /** 원본 find_subsequence_end — prefix 가 부분 수열이면 마지막 매칭 인덱스, 아니면 -1. */
    fun findSubsequenceEnd(prefixTokens: List<String>, sentenceTokens: List<String>): Int {
        val pLow = prefixTokens.map { it.lowercase() }
        if (pLow.isEmpty()) return -1
        var i = 0
        var last: Int
        for ((idx, t) in sentenceTokens.withIndex()) {
            if (t.lowercase() == pLow[i]) {
                last = idx
                i++
                if (i == pLow.size) return last
            }
        }
        return -1
    }

    /** preload.js 가 모아 둔 정답 문장 목록(중복 제거). 없으면 null. */
    private suspend fun getPageAnswers(d: Driver): List<String>? {
        val arr = d.evalArrayOrNull(
            "return (window.__cc_answers && window.__cc_answers.length) ? window.__cc_answers : null;"
        ) ?: return null
        val seen = LinkedHashSet<String>()
        for (i in 0 until arr.length()) {
            val s = arr.optString(i, "").trim()
            if (s.isNotEmpty()) seen.add(s)
        }
        return seen.toList().ifEmpty { null }
    }

    /** `.active .input-box` 텍스트에서 마지막 한 글자(커서)를 뗀 뒤 토큰화. */
    private suspend fun getPrefixTokens(d: Driver): List<String> {
        val text = d.evalStringOrNull(
            """
            var el = document.querySelector('.active .input-box');
            if (!el) return null;
            var t = (el.innerText || el.textContent || '').trim();
            return t.slice(0, -1);
            """
        ) ?: return emptyList()
        if (text.isEmpty()) return emptyList()
        return Norm.tokenize(text)
    }

    private suspend fun getAvailableTokens(d: Driver): List<String> = d.evalStringList(
        """
        var btns = document.querySelectorAll('.btn-scramble.clickable');
        var out = [];
        for (var i = 0; i < btns.length; i++) {
            var t = (btns[i].innerText || btns[i].textContent || '').trim();
            if (t) out.push(t);
        }
        return out;
        """
    )

    /** 현재 풀고 있는 카드의 input-box 가 화면에 있는지 (게임 진행 중인지). */
    private suspend fun hasActiveInput(d: Driver): Boolean =
        d.evalBool("return document.querySelectorAll('.active .input-box').length > 0;")

    /** 원본 find_matching_sentences — prefix 로 시작하는 문장들. */
    fun findMatchingSentences(
        prefixTokens: List<String>,
        sentences: List<String>,
        tokenizeFn: (String) -> List<String>,
    ): List<String> {
        val n = prefixTokens.size
        if (n == 0) return emptyList()
        val lowerPrefix = prefixTokens.map { it.lowercase() }
        val matches = mutableListOf<String>()
        for (sentence in sentences) {
            val tokens = tokenizeFn(sentence)
            if (tokens.size < n) continue
            if (tokens.take(n).map { it.lowercase() } == lowerPrefix) matches.add(sentence)
        }
        return matches
    }

    /** 원본 find_matching_sentence_fallback — 후보 단어 순열로 유일 문장을 좁힌다. */
    fun findMatchingSentenceFallback(
        prefixTokens: List<String>,
        availableTokens: List<String>,
        sentences: List<String>,
        tokenizeFn: (String) -> List<String>,
    ): String? {
        val n = minOf(4, availableTokens.size)
        if (n == 0) return null
        val lowerPrefix = prefixTokens.map { it.lowercase() }

        var found: String? = null
        permutations(availableTokens, n) { perm ->
            val candidate = lowerPrefix + perm.map { it.lowercase() }
            val candidateLen = candidate.size
            val matched = mutableListOf<String>()
            for (sentence in sentences) {
                val tokens = tokenizeFn(sentence)
                if (tokens.size < candidateLen) continue
                if (tokens.take(candidateLen).map { it.lowercase() } == candidate) matched.add(sentence)
            }
            if (matched.size == 1) {
                found = matched[0]
                false // 순회 중단
            } else {
                true
            }
        }
        return found
    }

    /** `itertools.permutations(items, r)` 이식. [onPerm] 이 false 를 반환하면 중단. */
    private fun permutations(items: List<String>, r: Int, onPerm: (List<String>) -> Boolean) {
        if (r == 0 || r > items.size) return
        val used = BooleanArray(items.size)
        val current = ArrayList<String>(r)

        fun rec(): Boolean {
            if (current.size == r) return onPerm(current)
            for (i in items.indices) {
                if (used[i]) continue
                used[i] = true
                current.add(items[i])
                val cont = rec()
                current.removeAt(current.size - 1)
                used[i] = false
                if (!cont) return false
            }
            return true
        }
        rec()
    }

    /**
     * 원본 find_sentence_by_candidates — 빈 prefix(문장 시작)일 때
     * 후보 단어 멀티셋으로 문장을 식별한다.
     */
    fun findSentenceByCandidates(
        availableTokens: List<String>,
        sentences: List<String>,
        tokenizeFn: (String) -> List<String>,
    ): String? {
        val cand = availableTokens.map { Norm.wkey(it) }.filter { it.isNotEmpty() }.sorted()
        if (cand.isEmpty()) return null
        val k = availableTokens.size
        val matched = mutableListOf<String>()
        for (s in sentences) {
            val toks = tokenizeFn(s)
            if (toks.size < k) continue
            val head = toks.take(k).map { Norm.wkey(it) }.filter { it.isNotEmpty() }.sorted()
            if (head == cand) matched.add(s)
        }
        if (matched.size == 1) return matched[0]
        if (matched.size > 1) {
            val firsts = matched.mapNotNull { s -> tokenizeFn(s).firstOrNull()?.let { Norm.wkey(it) } }.toSet()
            if (firsts.size == 1) return matched[0]
        }
        return null
    }

    /** MemorizeSentence 와 동일한 완료 판정. */
    private suspend fun checkStep2SuccessAndStop(d: Driver, stop: StopFlag): Boolean =
        MemorizeSentence.checkStep2SuccessAndStop(d, stop)

    /**
     * 화면 가용 scramble 버튼에 있는 토큰만 순서대로 클릭.
     * 매칭 우선순위: 정확 일치(정규화) -> 대소문자 무시 -> 구두점 무시.
     * 화면에 없는 '단어' 토큰이 나오면 즉시 중단, 단독 구두점 토큰은 건너뛴다.
     */
    private suspend fun clickRemainingTokens(d: Driver, remainingTokens: List<String>, stop: StopFlag) {
        for (token in remainingTokens) {
            if (stop.isSet) break

            val clicked = d.evalIntOrNull(
                """
                var token = ${token.jsStr()};
                function normUni(s) {
                    var map = {'‘':"'", '’':"'", '‚':"'", '‛':"'",
                               '“':'"', '”':'"', '„':'"', '‟':'"',
                               '–':'-', '—':'-', '−':'-', '…':'...'};
                    var out = '';
                    for (var i = 0; i < s.length; i++) {
                        var c = s.charAt(i);
                        out += (map[c] !== undefined) ? map[c] : c;
                    }
                    return out;
                }
                var btns = document.querySelectorAll('.btn-scramble.clickable:not(.clicked)');
                if (!btns.length) return -1;
                var texts = [];
                for (var i = 0; i < btns.length; i++) {
                    texts.push(normUni((btns[i].innerText || btns[i].textContent || '').trim()));
                }
                for (var i = 0; i < btns.length; i++) {
                    if (texts[i] === token) { btns[i].click(); return 1; }
                }
                for (var i = 0; i < btns.length; i++) {
                    if (texts[i].toLowerCase() === token.toLowerCase()) { btns[i].click(); return 1; }
                }
                var tokenClean = token.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                if (tokenClean) {
                    for (var i = 0; i < btns.length; i++) {
                        if (texts[i].replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === tokenClean) {
                            btns[i].click(); return 1;
                        }
                    }
                }
                return 0;
                """
            ) ?: 0

            // -1: 남은 버튼 없음 -> 중단
            if (clicked == -1) break
            if (clicked == 0) {
                // 단독 구두점은 화면에 버튼이 없는 게 정상이므로 skip, 단어면 중단
                if (Norm.isPunctOnly(token)) continue
                break
            }

            if (stop.await(200)) break
        }
    }

    /** 현재 카드 입력창의 전체 텍스트(전환 감지용). */
    private suspend fun inputText(d: Driver): String = d.evalStringOrNull(
        """
        var el = document.querySelector('.active .input-box');
        if (!el) return '';
        return (el.innerText || el.textContent || '').trim();
        """
    ) ?: ""

    /** 문장 완성 후 SPACE 로 다음 카드로. 입력창 내용이 바뀔 때까지 재시도(씹힘 대비). */
    private suspend fun advance(d: Driver, stop: StopFlag, maxTries: Int = 6) {
        val before = inputText(d)
        for (i in 0 until maxTries) {
            d.pressSpace()
            var waited = 0L
            while (waited < 1000) {
                if (stop.await(200)) return
                waited += 200
                if (checkStep2SuccessAndStop(d, stop)) return
                if (inputText(d) != before) return
            }
        }
    }

    val run: ModeFn = { d, answerDict, stop ->
        d.log("[문장 리콜] 시작")

        // 페이지가 정답을 로그할 때까지 잠깐 대기 (console.log 후킹 캡처)
        var capturedLogged = false
        var aborted = false
        for (i in 0 until 20) {
            if (getPageAnswers(d) != null) {
                d.log("[문장 리콜] 페이지 정답 캡처 성공 (단어장 불필요)")
                capturedLogged = true
                break
            }
            if (stop.await(300)) {
                aborted = true
                break
            }
        }

        if (!aborted) {
            if (!capturedLogged && answerDict.isNullOrEmpty()) {
                d.log("[문장 리콜] 정답 소스 없음 (캡처 실패 & 단어장 없음). 종료")
            } else {
                try {
                    loop@ while (!stop.isSet) {
                        // 매 카드마다 캡처된 정답 우선, 없으면 단어장 폴백
                        val pageAnswers = getPageAnswers(d)
                        val activeSentences: List<String> =
                            pageAnswers ?: (answerDict?.values?.toList() ?: emptyList())

                        if (activeSentences.isEmpty()) {
                            if (checkStep2SuccessAndStop(d, stop)) break
                            if (stop.await(300)) break
                            continue
                        }

                        var prefixTokens = getPrefixTokens(d)

                        if (prefixTokens.isEmpty()) {
                            // 카드가 없으면(전환/종료) 종료 체크
                            if (!hasActiveInput(d)) {
                                if (checkStep2SuccessAndStop(d, stop)) break
                                if (stop.await(300)) break
                                continue
                            }

                            // 문장 시작(빈 prefix): 후보 단어로 문장을 식별해 처음부터 클릭
                            val availableTokens = getAvailableTokens(d).map { Norm.normalizeUnicode(it) }
                            val startFn: (String) -> List<String> =
                                if (availableTokens.any { Norm.isPunctOnly(it) }) Norm::tokenizeLoose
                                else Norm::tokenize
                            val normalizedSentences = activeSentences.map { Norm.normalizeUnicode(it) }
                            val startSentence =
                                findSentenceByCandidates(availableTokens, normalizedSentences, startFn)
                                    ?: findSentenceByCandidates(
                                        availableTokens,
                                        normalizedSentences.map { Norm.stripParens(it) },
                                        startFn,
                                    )

                            if (startSentence == null) {
                                if (stop.await(300)) break
                                continue
                            }

                            clickRemainingTokens(d, startFn(startSentence), stop)
                            if (stop.await(300)) break
                            // 문장 완성 -> 다음 카드로 (SPACE 씹힘 대비 재시도)
                            advance(d, stop)
                            continue
                        }

                        prefixTokens = prefixTokens.map { Norm.normalizeUnicode(it) }
                        val tokenizeFn: (String) -> List<String> =
                            if (Norm.isPrefixPunctSplit(prefixTokens)) Norm::tokenizeLoose else Norm::tokenize

                        val normalizedSentences = activeSentences.map { Norm.normalizeUnicode(it) }

                        var matches = findMatchingSentences(prefixTokens, normalizedSentences, tokenizeFn)
                        var workingSentences = normalizedSentences

                        if (matches.isEmpty()) {
                            workingSentences = normalizedSentences.map { Norm.stripParens(it) }
                            matches = findMatchingSentences(prefixTokens, workingSentences, tokenizeFn)
                        }

                        var sentence: String? = null
                        var subseqEnd = -1

                        if (matches.size == 1) {
                            sentence = matches[0]
                        } else if (matches.size > 1) {
                            val availableTokens = getAvailableTokens(d).map { Norm.normalizeUnicode(it) }
                            sentence = findMatchingSentenceFallback(
                                prefixTokens, availableTokens, workingSentences, tokenizeFn,
                            )
                        }

                        if (sentence == null) {
                            val candidates = mutableListOf<Triple<String, Int, List<String>>>()
                            for (s in workingSentences) {
                                val sTokens = tokenizeFn(s)
                                val end = findSubsequenceEnd(prefixTokens, sTokens)
                                if (end >= 0) candidates.add(Triple(s, end, sTokens))
                            }
                            if (candidates.isNotEmpty()) {
                                val best = candidates.minByOrNull { it.third.size }!!
                                sentence = best.first
                                subseqEnd = best.second
                            }
                        }

                        if (sentence == null) {
                            d.log("[문장 리콜] 매칭 실패: $prefixTokens")
                            if (stop.await(300)) break
                            continue
                        }

                        var chosen: String = sentence
                        var allTokens = tokenizeFn(chosen)
                        var remainingTokens =
                            if (subseqEnd >= 0) allTokens.drop(subseqEnd + 1)
                            else allTokens.drop(prefixTokens.size)

                        if (remainingTokens.any { it.contains('(') || it.contains(')') }) {
                            val strippedSentences = normalizedSentences.map { Norm.stripParens(it) }
                            val alt = findMatchingSentences(prefixTokens, strippedSentences, tokenizeFn)
                            val altSentence: String? = if (alt.size == 1) alt[0] else null
                            if (altSentence == null) {
                                val altCands = mutableListOf<Triple<String, Int, List<String>>>()
                                for (sAlt in strippedSentences) {
                                    val sTok = tokenizeFn(sAlt)
                                    val endAlt = findSubsequenceEnd(prefixTokens, sTok)
                                    if (endAlt >= 0) altCands.add(Triple(sAlt, endAlt, sTok))
                                }
                                if (altCands.isNotEmpty()) {
                                    val best = altCands.minByOrNull { it.third.size }!!
                                    // (원본도 여기서 sentence 를 갱신하지만 이후 쓰이지 않는다.
                                    //  실제로 쓰이는 건 remaining_tokens 뿐이라 그대로 둔다.)
                                    allTokens = best.third
                                    remainingTokens = allTokens.drop(best.second + 1)
                                }
                            } else {
                                chosen = altSentence
                                allTokens = tokenizeFn(chosen)
                                remainingTokens = allTokens.drop(prefixTokens.size)
                            }
                        }

                        clickRemainingTokens(d, remainingTokens, stop)

                        if (stop.isSet) break

                        // 다음 카드로 (SPACE 씹힘 대비 재시도)
                        advance(d, stop)

                        if (checkStep2SuccessAndStop(d, stop)) break
                    }
                } catch (e: Throwable) {
                    if (!stop.isSet) d.log("[문장 리콜] 오류: ${e.message}")
                } finally {
                    d.log("[문장 리콜] 종료")
                }
            }
        }
    }
}
