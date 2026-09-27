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

            // 후보 버튼을 찾는 부분(원본과 같은 우선순위: 정확 -> 대소문자 무시 -> 구두점 무시)
            val find = """
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
                var texts = [];
                for (var i = 0; i < btns.length; i++) {
                    texts.push(normUni((btns[i].innerText || btns[i].textContent || '').trim()));
                }
                var hit = null;
                for (var i = 0; i < btns.length; i++) {
                    if (texts[i] === token) { hit = btns[i]; break; }
                }
                if (!hit) {
                    for (var i = 0; i < btns.length; i++) {
                        if (texts[i].toLowerCase() === token.toLowerCase()) { hit = btns[i]; break; }
                    }
                }
                if (!hit) {
                    var tokenClean = token.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                    if (tokenClean) {
                        for (var i = 0; i < btns.length; i++) {
                            if (texts[i].replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === tokenClean) {
                                hit = btns[i]; break;
                            }
                        }
                    }
                }
            """.trimIndent()

            // 남은 버튼이 없으면 이 카드는 끝
            val none = d.evalBool(find + "\n            return btns.length === 0;")
            if (none) break

            // 원본(Selenium)은 진짜 클릭을 먼저 보냈다. 이 버튼도 합성 click 을 무시할 수 있으므로
            // 신뢰된 클릭을 먼저 쓰고, 안 되면 합성 클릭으로 폴백한다.
            var clicked = d.trustedClick(
                find + """

                if (!hit) return null;
                hit.scrollIntoView({ block: 'center', inline: 'center' });
                var r = hit.getBoundingClientRect();
                if (!r.width || !r.height) return null;
                return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: window.innerWidth };
                """.trimIndent()
            )
            if (!clicked) {
                clicked = d.evalBool(
                    find + """

                    if (!hit) return false;
                    hit.click();
                    return true;
                    """.trimIndent()
                )
            }

            if (!clicked) {
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

    /** 예전 문장 리콜 화면(콘솔 정답 캡처 + .btn-scramble) 흐름. 지금 사이트가 아니면 이걸로 폴백한다. */
    private val runLegacy: ModeFn = { d, answerDict, stop ->
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

    // ============================================================ 지금 사이트 (scripts/v3/recall_sentence.js) — 확장 sentence.js 의 recallSentence 와 같은 규칙
    //
    //   - `.CardItem.active .front .input-box` 에 앞부분 낱말이 미리 채워져 있고, 빈칸은 `.btn-scramble.now`('?') 로 표시된다.
    //     빈칸 정답은 그 input-box 의 jQuery data('arr_answer') (순서대로). 콘솔 캡처가 필요 없다.
    //   - 보기 타일은 footer 의 `.scramble-body .btn-scramble` (한 번에 최대 4개). 놓은 수 = `.input-box .btn-scramble:not(.now)`.
    //   - 한 묶음을 다 놓으면 채점: 틀리면 `.study-wrapper.wrong`(정답 표시), 맞으면 다음 묶음. 다 맞추면 `.study-wrapper.correct`.
    //     어느 쪽이든 `.feedback .btn-next-card`(다음카드) 로 넘어간다 (재시도 없음 — 틀린 카드는 다음 바퀴에).

    private suspend fun clickRecallTile(d: Driver, index: Int): Boolean = d.clickSmart(
        """
        var tiles = document.querySelectorAll('.scramble-body .btn-scramble');
        el = tiles[$index] || null;
        """
    )

    val run: ModeFn = { d, answerDict, stop ->
        d.log("[문장 리콜] 시작")
        var rounds = 0
        var sameCount = 0
        var lastSig = ""
        var wrongLogged: String? = null
        var handedToLegacy = false
        try {
            loop@ while (!stop.isSet) {
                val s = SpellSentence.state(d)
                if (s == null) { if (stop.await(400)) break; continue }
                if (s.card) Memorize.reportCardProgress(d, "문장 리콜")

                if (s.end) {
                    if (s.unknown > 0 && rounds < SpellSentence.MAX_ROUNDS) {
                        rounds += 1
                        d.log("[문장 리콜] 모르는 카드 ${s.unknown}개 — 다시 학습합니다 ($rounds/${SpellSentence.MAX_ROUNDS})")
                        d.clickFirstVisible("#study_end .btn-study-end-unknow")
                        if (stop.await(1500)) break
                        continue
                    }
                    d.log("[문장 리콜] 학습 완료")
                    d.exec("""var a = document.querySelectorAll("#study_end.active .study-header a"); if (a.length) a[0].click();""")
                    d.exec("""var a = document.querySelectorAll(".btn-top-menu a"); if (a.length) a[0].click();""")
                    stop.sleep(500)
                    d.exec("""var a = document.querySelectorAll(".close_o"); if (a.length) a[0].click();""")
                    stop.set()
                    break
                }
                if (s.modal) { SpellSentence.closeModal(d); if (stop.await(700)) break; continue }
                if (s.round) { if (stop.await(500)) break; continue }
                if (s.start) { Memorize.startStudyIfNeeded(d, stop); if (stop.await(800)) break; continue }
                if (!s.card) { if (stop.await(400)) break; continue }

                if (s.legacy) {
                    d.log("[문장 리콜] 예전 화면 구조입니다 — 이전 방식으로 진행합니다")
                    handedToLegacy = true
                    runLegacy(d, answerDict, stop)
                    break
                }

                val sig = "${s.key}|${s.correct}|${s.wrong}|${s.rPlaced}|${s.rTiles.count { !it.clicked }}"
                if (sig == lastSig) {
                    sameCount += 1
                    if (sameCount == 60) {
                        d.log("[문장 리콜] 진행이 멈췄습니다 — 화면: key=${s.key} recall=${s.recall} placed=${s.rPlaced} words=${s.rWords.size} tiles=${s.rTiles.size}")
                        SpellSentence.clickFeedback(d, ".btn-next-card")
                    }
                } else { sameCount = 0; lastSig = sig }

                if (s.correct || s.wrong) {
                    if (s.wrong && wrongLogged != s.key) { wrongLogged = s.key; d.log("[문장 리콜] 오답 처리된 카드 — 다음 바퀴에 다시 나옵니다") }
                    SpellSentence.clickFeedback(d, ".btn-next-card")
                    val r = SpellSentence.waitCardChange(d, stop, s.key, 3000)
                    if (r == SpellSentence.Wait.STOPPED) break
                    if (r == SpellSentence.Wait.STUCK) { d.blurActiveElement(); d.pressSpace() }
                    continue
                }

                if (!s.recall || s.rWords.isEmpty()) { if (stop.await(300)) break; continue }
                if (s.rPlaced >= s.rWords.size) { if (stop.await(300)) break; continue }
                val expected = s.rWords[s.rPlaced]
                var hit = s.rTiles.indexOfFirst { !it.clicked && it.input == expected }
                if (hit < 0) {
                    // 사이트는 < > 를 &lt; &gt; 로 바꿔 비교한다 — 표시 글자가 다를 수 있으니 공백·기호를 뺀 비교로 한 번 더
                    fun norm(t: String) = t.lowercase().replace(Regex("[^a-z0-9가-힣]"), "")
                    val ne = norm(expected)
                    if (ne.isNotEmpty()) hit = s.rTiles.indexOfFirst { !it.clicked && norm(it.input) == ne }
                }
                if (hit < 0) { if (stop.await(250)) break; continue }
                clickRecallTile(d, hit)
                if (stop.await(150)) break
            }
        } catch (e: Throwable) {
            if (!stop.isSet) d.log("[문장 리콜] 오류: ${e.message}")
        } finally {
            if (!handedToLegacy) d.log("[문장 리콜] 종료")
        }
    }
}
