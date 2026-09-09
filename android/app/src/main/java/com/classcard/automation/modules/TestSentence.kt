package com.classcard.automation.modules

import com.classcard.automation.core.AntiBlur
import com.classcard.automation.core.Driver
import com.classcard.automation.core.Norm
import com.classcard.automation.core.StopFlag
import com.classcard.automation.core.jsStr

/** TestSentence.py 이식 — 문장 어순 배열 테스트 자동 풀이. */
object TestSentence {

    private const val GO_RESULT_SELECTOR = "a.btn-go-result"

    /** 진단용: true 면 문제별 파싱/클릭 결과를 로그에 출력. */
    var DEBUG = false

    /** 테스트 목표 점수(0~100). 100 -> 다 맞음. */
    var TARGET_SCORE = 100

    private data class Card(
        val qid: String,
        val flipped: Boolean,
        val prompt: String,
        val words: Int,
        val placed: Int,
    )

    /** 한글(back) -> 영어(front) 정규화 맵 2종. m: 한글 그대로, mnp: 괄호 제거 버전(폴백). */
    class Maps(val m: HashMap<String, String>, val mnp: HashMap<String, String>)

    fun buildMaps(d: Driver?, answerDict: AnswerDict): Maps {
        val m = HashMap<String, String>()
        val mnp = HashMap<String, String>()
        for ((back, front) in answerDict) {
            if (back.isEmpty()) continue
            m[Norm.normalizeKor(back)] = front
            mnp[Norm.normalizeKor(Norm.stripParensSimple(back))] = front
        }
        if (answerDict.isNotEmpty()) d?.log("[문장 테스트] 단어장 로드 (카드 ${answerDict.size}개)")
        return Maps(m, mnp)
    }

    /**
     * 이 페이지가 들고 있는 카드 목록(study_data / card_list)을 읽는다.
     * 단어장을 안 가져왔거나 제시문이 조금 달라도, 페이지 자신의 데이터로 맞출 수 있다.
     */
    private suspend fun pageCards(d: Driver): List<Pair<String, String>> {
        val arr = d.evalArrayOrNull(
            """
            var src = null;
            if (typeof study_data !== 'undefined' && study_data && study_data.length) src = study_data;
            else if (typeof card_list !== 'undefined' && card_list && card_list.length) src = card_list;
            if (!src) return null;
            var out = [];
            for (var i = 0; i < src.length; i++) {
                var c = src[i] || {};
                out.push({ front: String(c.front == null ? '' : c.front),
                           back: String(c.back == null ? '' : c.back) });
            }
            return out;
            """
        ) ?: return emptyList()
        val out = ArrayList<Pair<String, String>>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            out.add(o.optString("front", "").trim() to o.optString("back", "").trim())
        }
        return out
    }

    /** 페이지 카드 목록을 맵에 더한다. 이미 있는 키는 덮어쓰지 않는다. */
    private fun addCardsToMaps(maps: Maps, cards: List<Pair<String, String>>) {
        for ((front, back) in cards) {
            if (front.isEmpty() || back.isEmpty()) continue
            maps.m.putIfAbsent(Norm.normalizeKor(back), front)
            maps.mnp.putIfAbsent(Norm.normalizeKor(Norm.stripParensSimple(back)), front)
        }
    }

    /** 정답 후보 영어 문장 — 페이지가 로그한 정답(preload 캡처) + 지금까지 모은 카드 목록. */
    private suspend fun answerCandidates(d: Driver, maps: Maps): List<String> {
        val out = ArrayList<String>()
        out.addAll(
            d.evalStringList(
                "return (window.__cc_answers && window.__cc_answers.length) ? window.__cc_answers : [];"
            )
        )
        out.addAll(maps.m.values)
        return out.filter { it.isNotBlank() }
    }

    /**
     * 화면의 버튼(낱말)들과 낱말 구성이 정확히 같은 후보 문장을 고른다.
     * 제시문 매칭이 실패해도, 버튼이 곧 그 문장의 낱말이므로 정답을 특정할 수 있다.
     */
    private suspend fun pickByTiles(d: Driver, candidates: List<String>): String? {
        if (candidates.isEmpty()) return null
        fun bag(words: List<String>) =
            words.map { Norm.normEn(it.removeSuffix("*")) }.filter { it.isNotEmpty() }.sorted()
                .joinToString("|")
        val want = bag(listButtons(d))
        if (want.isEmpty()) return null
        return candidates.firstOrNull { bag(Norm.parseEnglishWords(it)) == want }
    }

    /** 한글 프롬프트로 영어 정답 문장 조회. 실패 시 괄호 제거 폴백. */
    fun matchEnglish(promptRaw: String, maps: Maps): String? {
        val p = Norm.normalizeKor(promptRaw)
        maps.m[p]?.let { return it }
        val pnp = Norm.normalizeKor(Norm.stripParensSimple(promptRaw))
        return maps.mnp[pnp]
    }

    private const val READ_CARD_JS = """
        var card = document.querySelector('.flip-card.showing');
        if (!card) return { found: false };

        var qid = '';
        var qi = card.querySelector('input[name="test_question[]"]');
        if (qi) qid = qi.value;

        var flipped = card.classList.contains('flip');

        var prompt = '';
        var fh = card.querySelector('.flip-card-front .front-hidden');
        if (fh) prompt = (fh.textContent || '').trim();

        var words = card.querySelectorAll('.test-sentence-words a.btn').length;
        var placed = card.querySelectorAll('.test-sentence-input span').length;

        return { found: true, qid: qid, flipped: flipped, prompt: prompt,
                 words: words, placed: placed };
    """

    private suspend fun readCard(d: Driver): Card? {
        val data = d.evalObjectOrNull(READ_CARD_JS) ?: return null
        if (!data.optBoolean("found", false)) return null
        return Card(
            qid = data.optString("qid", ""),
            flipped = data.optBoolean("flipped", false),
            prompt = data.optString("prompt", "").trim(),
            words = data.optInt("words", 0),
            placed = data.optInt("placed", 0),
        )
    }

    /**
     * 현재 showing 카드에서 아직 안 클릭된 스크램블 버튼 중 token 과 맞는 버튼을 **trusted 클릭**.
     *
     * 이 버튼들은 합성 click(JS click / jQuery trigger)을 모두 무시하고 신뢰된 마우스
     * 이벤트에만 반응한다. 원본은 CDP `Input.dispatchMouseEvent` 를 썼고, 여기서는
     * 네이티브 MotionEvent 를 주입한다([Driver.trustedClick]).
     *
     * 매칭 우선순위: 정확 일치(대소문자 구분) -> 대소문자 무시 -> 영숫자만.
     */
    private suspend fun clickWord(d: Driver, token: String): Boolean {
        val locator = """
            var token = ${token.jsStr()};
            var tokLow = token.toLowerCase();
            var tokNorm = token.toLowerCase().replace(/[^a-z0-9]/g, '');

            var btns = document.querySelectorAll('.flip-card.showing .test-sentence-words a.btn');
            var cands = [];
            for (var i = 0; i < btns.length; i++) {
                if (btns[i].classList.contains('clicked')) continue;
                cands.push([btns[i], (btns[i].textContent || '').trim()]);
            }

            var target = null;
            for (var i = 0; i < cands.length; i++) {          // 1) 정확 일치
                if (cands[i][1] === token) { target = cands[i][0]; break; }
            }
            if (!target) {
                for (var i = 0; i < cands.length; i++) {      // 2) 대소문자 무시
                    if (cands[i][1].toLowerCase() === tokLow) { target = cands[i][0]; break; }
                }
            }
            if (!target && tokNorm) {
                for (var i = 0; i < cands.length; i++) {      // 3) 영숫자만
                    if (cands[i][1].toLowerCase().replace(/[^a-z0-9]/g, '') === tokNorm) {
                        target = cands[i][0]; break;
                    }
                }
            }
            if (!target) return null;

            target.scrollIntoView({block:'center', inline:'center'});
            var r = target.getBoundingClientRect();
            return {x: r.left + r.width / 2, y: r.top + r.height / 2, w: window.innerWidth};
        """

        if (d.trustedClick(locator)) return true

        // 폴백: 신뢰 클릭이 실패한 경우에만 합성 클릭 시도 (원본의 except 분기와 동일)
        return d.evalBool(
            """
            var token = ${token.jsStr()};
            var tokLow = token.toLowerCase();
            var tokNorm = token.toLowerCase().replace(/[^a-z0-9]/g, '');
            var btns = document.querySelectorAll('.flip-card.showing .test-sentence-words a.btn');
            var cands = [];
            for (var i = 0; i < btns.length; i++) {
                if (btns[i].classList.contains('clicked')) continue;
                cands.push([btns[i], (btns[i].textContent || '').trim()]);
            }
            for (var i = 0; i < cands.length; i++) {
                if (cands[i][1] === token) { cands[i][0].click(); return true; }
            }
            for (var i = 0; i < cands.length; i++) {
                if (cands[i][1].toLowerCase() === tokLow) { cands[i][0].click(); return true; }
            }
            if (tokNorm) {
                for (var i = 0; i < cands.length; i++) {
                    if (cands[i][1].toLowerCase().replace(/[^a-z0-9]/g, '') === tokNorm) {
                        cands[i][0].click(); return true;
                    }
                }
            }
            return false;
            """
        )
    }

    /** 진단용: 현재 showing 카드의 스크램블 버튼 텍스트 + clicked 여부 목록. */
    private suspend fun listButtons(d: Driver): List<String> = d.evalStringList(
        """
        var card = document.querySelector('.flip-card.showing');
        if (!card) return [];
        var out = [];
        var btns = card.querySelectorAll('.test-sentence-words a.btn');
        for (var i = 0; i < btns.length; i++) {
          out.push((btns[i].textContent || '').trim() +
                   (btns[i].classList.contains('clicked') ? '*' : ''));
        }
        return out;
        """
    )

    /** '나가기' 버튼 클릭. set 상세로 가는 링크 우선, 없으면 '나가기' 텍스트. */
    private suspend fun clickExit(d: Driver, stop: StopFlag, timeoutMs: Long = 10000): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val clicked = d.evalBool(
                """
                // 1) set 상세로 가는 '나가기' 링크
                var setLinks = document.querySelectorAll('a[href*="/set/"]');
                for (var i = 0; i < setLinks.length; i++) {
                    var a = setLinks[i];
                    if (a.offsetParent !== null && (a.textContent || '').indexOf('나가기') >= 0) {
                        a.click(); return true;
                    }
                }
                // 2) 텍스트가 '나가기'인 링크
                var all = document.querySelectorAll('a');
                for (var i = 0; i < all.length; i++) {
                    var b = all[i];
                    if (b.offsetParent !== null && (b.textContent || '').indexOf('나가기') >= 0) {
                        b.click(); return true;
                    }
                }
                // 3) 폴백: set 링크 아무거나
                var prim = document.querySelectorAll('a.btn-primary[href*="/set/"]');
                for (var i = 0; i < prim.length; i++) {
                    if (prim[i].offsetParent !== null) { prim[i].click(); return true; }
                }
                return false;
                """
            )
            if (clicked) return true
            if (stop.await(300)) return false
        }
        return false
    }

    /**
     * 결과 화면(btn-go-result '제출 결과 확인')이 보이면 클릭 -> '나가기'(set 링크) 클릭으로
     * set 상세 화면 복귀 후 stop. (단어 테스트와 달리 X 닫기 단계 없음)
     */
    suspend fun checkEndAndStop(d: Driver, stop: StopFlag): Boolean {
        val visible = d.evalBool(
            """
            var b = document.querySelectorAll('$GO_RESULT_SELECTOR');
            for (var i = 0; i < b.length; i++) if (b[i].offsetParent !== null) return true;
            return false;
            """
        )
        if (!visible) return false

        d.clickFirstVisible(GO_RESULT_SELECTOR)  // 제출 결과 확인
        stop.sleep(1000)

        if (!clickExit(d, stop, timeoutMs = 10000)) {
            d.log("[문장 테스트] '나가기' 버튼을 찾지 못했습니다.")
        }
        stop.sleep(500)

        stop.set()
        return true
    }

    private suspend fun countTotal(d: Driver): Int? = d.evalIntOrNull(
        """return document.querySelectorAll('.flip-card input[name="test_question[]"]').length;"""
    )

    /** 클릭 재시도 결과. 원본의 'stop' | True | False. */
    private enum class ClickResult { STOP, CLICKED, MISSED }

    /** 단어가 아직 렌더링(슬라이드-인) 안 됐을 수 있어 잠깐 기다렸다 최대 4회 재시도. */
    private suspend fun clickWithRetry(d: Driver, token: String, stop: StopFlag): ClickResult {
        for (i in 0 until 4) {
            if (stop.isSet) return ClickResult.STOP
            if (clickWord(d, token)) return ClickResult.CLICKED
            if (stop.await(350)) return ClickResult.STOP
        }
        return ClickResult.MISSED
    }

    /** 토큰 한 개를 클릭. 통째 매칭 실패 시 괄호/하이픈으로 분해해 부분 매칭 클릭. */
    private suspend fun clickToken(d: Driver, token: String, stop: StopFlag): ClickResult {
        val res = clickWithRetry(d, token, stop)
        if (res == ClickResult.STOP || res == ClickResult.CLICKED) return res

        val subs = Norm.splitSubtokens(token)
        if (subs.isEmpty()) return ClickResult.MISSED

        var anyOk = false
        for (sub in subs) {
            if (Norm.normEn(sub).isEmpty()) continue
            val r = clickWithRetry(d, sub, stop)
            if (r == ClickResult.STOP) return ClickResult.STOP
            if (r == ClickResult.CLICKED) anyOk = true
            if (stop.await(150)) return ClickResult.STOP
        }
        return if (anyOk) ClickResult.CLICKED else ClickResult.MISSED
    }

    /** 영어 문장을 어순대로 클릭. makeWrong 이면 마지막 두 토큰을 바꿔 클릭(오답 유도). */
    private suspend fun clickSentence(
        d: Driver, english: String, makeWrong: Boolean, stop: StopFlag,
    ): Boolean {
        val tokens = Norm.parseEnglishWords(english)

        val order = tokens.indices.toMutableList()
        if (makeWrong && order.size >= 2) {
            val tmp = order[order.size - 1]
            order[order.size - 1] = order[order.size - 2]
            order[order.size - 2] = tmp
            d.log("[문장 테스트] 의도적 오답 (어순 변경): '$english'")
        }

        var dumped = false
        for (k in order) {
            if (stop.isSet) return false
            val token = tokens[k]
            if (Norm.normEn(token).isEmpty()) continue  // 순수 구두점 토큰 skip

            val res = clickToken(d, token, stop)
            if (res == ClickResult.STOP) return false

            if (DEBUG) {
                d.log("[문장 테스트]   '$token' -> ${if (res == ClickResult.CLICKED) "클릭" else "버튼없음"}")
            } else if (res != ClickResult.CLICKED) {
                d.log("[문장 테스트] 버튼 매칭 실패: '$token'")
                if (!dumped) {
                    d.log("[문장 테스트]   현재 버튼: ${listButtons(d)}")
                    dumped = true
                }
            }

            if (stop.await(250)) return false
        }

        return true
    }

    val run: ModeFn = { d, answerDict, stop ->
        d.log("[문장 테스트] 시작")

        AntiBlur.inject(d) // 백그라운드 실행 시 '이탈 감지' 우회

        run {
            // 정답은 페이지가 들고 있는 카드 목록에서 먼저 찾는다(단어장이 없어도 풀 수 있다).
            val maps = buildMaps(d, answerDict ?: emptyMap())
            val cards = pageCards(d)
            if (cards.isNotEmpty()) {
                addCardsToMaps(maps, cards)
                d.log("[문장 테스트] 페이지 카드 목록 로드 (카드 ${cards.size}개)")
            }
            if (maps.m.isEmpty()) {
                // 카드 목록도 단어장도 없으면 사이트가 콘솔에 남기는 정답(arr_front)에 기댄다.
                d.log("[문장 테스트] 카드 목록·단어장이 없습니다 — 페이지가 남기는 정답으로 풉니다.")
            }

            val total = countTotal(d)
            val wrongIdx = Test.planWrongIndices(total, TARGET_SCORE)
            if (DEBUG && total != null) {
                d.log("[문장 테스트] 총 ${total}문항 / 일부러 틀릴 순번: ${wrongIdx.sorted().ifEmpty { "없음" }}")
            }

            val flipAttempts = HashMap<String, Int>()   // qid별 SPACE flip 시도 횟수
            val answeredQids = HashSet<String>()        // 단어 배열 완료한 문제
            var answeredCount = 0                       // 실제로 답한 수

            var lastQid: String? = null                 // 진척 없음 감지용
            var noProgress = 0

            try {
                while (!stop.isSet) {
                    if (checkEndAndStop(d, stop)) break

                    val q = readCard(d)
                    if (q == null) {
                        if (stop.await(300)) break
                        continue
                    }

                    // 진척 없음(같은 qid 반복) 감지 -> 과도하면 안전 종료
                    if (q.qid.isNotEmpty() && q.qid == lastQid) {
                        noProgress++
                    } else {
                        noProgress = 0
                        lastQid = q.qid
                    }
                    if (noProgress > 50) {
                        d.log("[문장 테스트] 진행이 멈춰 종료합니다 (매칭 실패/UI 변경 가능).")
                        break
                    }

                    // 이미 배열 완료한 문제 -> 다음으로 진행
                    if (q.qid.isNotEmpty() && q.qid in answeredQids) {
                        d.pressSpace()
                        if (stop.await(600)) break
                        continue
                    }

                    // 앞면(한글) -> SPACE 로 flip. 최대 8회 재시도.
                    if (!q.flipped) {
                        val n = flipAttempts[q.qid] ?: 0
                        if (n < 8) {
                            d.pressSpace()
                            flipAttempts[q.qid] = n + 1
                        }
                        if (stop.await(500)) break
                        continue
                    }

                    // 뒷면(단어 배열) -> 정답 조회 후 클릭
                    var english = matchEnglish(q.prompt, maps)
                    if (english == null) {
                        // 화면이 바뀌어 카드 목록이 새로 실렸을 수 있다 — 한 번 다시 읽어 본다.
                        val fresh = pageCards(d)
                        if (fresh.isNotEmpty()) {
                            addCardsToMaps(maps, fresh)
                            english = matchEnglish(q.prompt, maps)
                        }
                    }
                    if (english == null) {
                        // 제시문으로 못 찾으면, 화면의 버튼들과 낱말이 정확히 일치하는 정답 문장을 고른다.
                        english = pickByTiles(d, answerCandidates(d, maps))
                        if (english != null) {
                            d.log("[문장 테스트] 화면 버튼과 맞는 정답 문장을 찾았습니다: '$english'")
                        }
                    }
                    if (english == null) {
                        d.log("[문장 테스트] 매칭 실패(건너뜀): '${q.prompt}'")
                        answeredQids.add(q.qid)  // 건너뜀 (해당 문항 오답 처리)
                        if (stop.await(300)) break
                        continue
                    }

                    answeredCount++
                    val makeWrong = answeredCount in wrongIdx

                    if (DEBUG) {
                        d.log("[문장 테스트][$answeredCount] '${q.prompt}' -> '$english'")
                    }

                    val ok = clickSentence(d, english, makeWrong, stop)
                    answeredQids.add(q.qid)
                    if (!ok) break

                    if (stop.await(500)) break
                }
            } catch (e: Throwable) {
                if (!stop.isSet) d.log("[문장 테스트] 오류: ${e.message}")
            } finally {
                d.log("[문장 테스트] 종료")
            }
        }
    }
}
