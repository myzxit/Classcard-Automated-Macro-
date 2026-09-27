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
    // 문장 테스트는 **95점 이상 100점 이하**가 되게 한다.
    // 늘 100점이면 티가 나므로, 95점 밑으로는 절대 안 내려가는 선에서 매번 다르게 고른다.
    var MIN_SCORE = 95
    var MAX_SCORE = 100

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

    /**
     * 클래스 테스트가 문제마다 싣고 바로 지우는 정답 (`.answer.hidden`) — preload 가 지워지기 전에 챙겨 둔 것.
     * 문제 id 로 바로 찾으므로 제시문 매칭이 필요 없다(= 항상 100점).
     */

    /**
     * 테스트 화면의 확인 모달을 처리한다 (확장 games.js 의 handleTestModals 와 같다).
     *
     * 클래스 테스트는 이전 응시가 남아 있으면 showConfirm 으로 두 번 묻는다
     * (scripts/v2/class_test_sentence.js 의 checkOnTest -> checkOnTestReConfirm):
     *   1) "…에 시작한 테스트가 진행 중입니다. 테스트에 새로 응시하시겠습니까?"  [취소][응시]
     *   2) "테스트를 다시 시작하면 기존 테스트는 무효화됩니다. 새로 시작할까요?" [취소][새로 시작]
     * 이 모달이 떠 있는 동안 '테스트 시작' 버튼은 가려져 있어, 처리하지 않으면 시작 버튼만 계속 누르게 된다.
     */
    internal suspend fun handleTestModals(d: Driver): Boolean = d.clickSmart(
        """
        var sels = ['#confirmModal .btn-ok', '#alertModal .btn-ok', '#alertModal2 .btn-ok',
                    '.modal-content .btn-ok'];
        for (var i = 0; i < sels.length && !el; i++) {
            var btns = document.querySelectorAll(sels[i]);
            for (var j = 0; j < btns.length; j++) {
                if (btns[j].offsetParent !== null && !btns[j].classList.contains('close-pos')) { el = btns[j]; break; }
            }
        }
        """
    )

    /** 확인 모달이 떠 있는지 (떠 있으면 시작 버튼을 눌러도 소용없다). */
    internal suspend fun testModalOpen(d: Driver): Boolean = d.evalBool(
        """
        var ids = ['#confirmModal', '#alertModal', '#alertModal2'];
        for (var i = 0; i < ids.length; i++) {
            var m = document.querySelector(ids[i]);
            if (m && window.getComputedStyle(m).display === 'block') return true;
        }
        return false;
        """
    )

    private suspend fun pageTestAnswers(d: Driver): Map<String, String> {
        val obj = d.evalObjectOrNull("return window.__cc_test_answers || null;") ?: return emptyMap()
        val out = LinkedHashMap<String, String>()
        for (k in obj.keys()) {
            val v = obj.optString(k, "").trim()
            if (v.isNotEmpty()) out[k] = v
        }
        return out
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
        return pickByTileBag(listButtons(d), candidates)
    }

    /**
     * 타일 낱말 묶음과 정확히 같은 후보를 먼저, 없으면 (타일이 여러 낱말 묶음이거나 기호가 다를 때) 낱말 집합이
     * 가장 비슷한 후보를 고른다 — 후보끼리 구분이 안 될 만큼 비슷하면 고르지 않는다. (확장 pickByTileBag 과 같다)
     */
    fun pickByTileBag(tiles: List<String>, candidates: List<String>): String? {
        fun words(arr: List<String>) = arr.flatMap { Norm.parseEnglishWords(it.removeSuffix("*")) }
            .map { Norm.normEn(it) }.filter { it.isNotEmpty() }
        val tileWords = words(tiles)
        if (tileWords.isEmpty()) return null
        val want = tileWords.sorted().joinToString("|")
        candidates.firstOrNull { words(listOf(it)).sorted().joinToString("|") == want }?.let { return it }
        val setA = tileWords.toSet()
        var best: String? = null
        var bestScore = 0.0
        var second = 0.0
        for (cand in candidates) {
            val cw = words(listOf(cand))
            if (cw.isEmpty()) continue
            val setB = cw.toSet()
            val inter = setA.count { setB.contains(it) }
            val score = inter.toDouble() / maxOf(setA.size, setB.size)
            if (score > bestScore) { second = bestScore; bestScore = score; best = cand }
            else if (score > second) second = score
        }
        return if (best != null && bestScore >= 0.75 && bestScore > second) best else null
    }

    /**
     * 타일이 낱말 하나가 아니라 여러 낱말 묶음("in righteousness")일 때, 문장 어순대로 어떤 타일을 눌러야 하는지 계획한다.
     * 각 자리에서 가장 긴 묶음부터 맞춰 본다. 맞는 타일이 없는 자리는 낱말 하나(기존 방식)로 둔다. (확장 planChunks 와 같다)
     */
    fun planChunks(tokens: List<String>, tileTexts: List<String>): List<String> {
        class T(val text: String, val words: List<String>) { var used = false }
        fun words(t: String) = Norm.parseEnglishWords(t).map { Norm.normEn(it) }.filter { it.isNotEmpty() }
        val tiles = tileTexts.map { T(it, words(it)) }
        val toks = tokens.map { Norm.normEn(it) }
        val plan = ArrayList<String>()
        var pos = 0
        while (pos < tokens.size) {
            if (toks[pos].isEmpty()) { pos += 1; continue }
            var best: T? = null
            for (tile in tiles) {
                if (tile.used || tile.words.isEmpty()) continue
                val n = tile.words.size
                if (best != null && n <= best.words.size) continue
                var ok = true; var k = pos; var m = 0
                while (m < n && k < tokens.size) {
                    if (toks[k].isEmpty()) { k += 1; continue }
                    if (toks[k] != tile.words[m]) { ok = false; break }
                    k += 1; m += 1
                }
                if (ok && m == n) best = tile
            }
            if (best != null) {
                best.used = true
                plan.add(best.text)
                var m = 0
                while (m < best.words.size && pos < tokens.size) { if (toks[pos].isNotEmpty()) m += 1; pos += 1 }
            } else {
                plan.add(tokens[pos]); pos += 1
            }
        }
        return plan
    }

    /** 한글 프롬프트로 영어 정답 문장 조회. 실패 시 괄호 제거 폴백. */
    fun matchEnglish(promptRaw: String, maps: Maps): String? {
        val p = Norm.normalizeKor(promptRaw)
        maps.m[p]?.let { return it }
        val pnp = Norm.normalizeKor(Norm.stripParensSimple(promptRaw))
        return maps.mnp[pnp]
    }

    /**
     * 낱말 버튼과 놓인 자리의 이름이 화면마다 다르다 (사이트 스크립트 확인 결과):
     *   단어 세트 문장 테스트 : .test-sentence-words a.btn        / .test-sentence-input span
     *   문법 어순 배열         : .test-sentence-words .btn-sentence-word / .scramble-body .scramble-word
     * 그래서 둘 다 훑고, 카드가 뒤집혔는지도 클래스(.flip)만 믿지 않고
     * 낱말 버튼이 실제로 보이는지로 판단한다.
     */
    private val WORD_SELECTORS = listOf(
        ".test-sentence-words a.btn",
        ".test-sentence-words .btn-sentence-word",
        ".sentence-tab-box .btn-sentence-word",
        ".test-sentence-words .btn",
        // 클래스 테스트(/ClassTest)는 낱말 타일의 클래스 이름을 페이지마다 난수로 바꾼다
        // (scripts/v2/class_test_sentence.js 의 cheat_scramble_class). 그래서 이름 대신 자리로 찾는다.
        ".test-sentence-words a",
    )
    private val PLACED_SELECTORS = listOf(
        ".test-sentence-input span",
        ".scramble-body span",
        ".scramble-body .scramble-word",
    )

    private fun jsList(items: List<String>) = items.joinToString(", ") { it.jsStr() }

    private val READ_CARD_JS = """
        var WORD_SEL = [${jsList(WORD_SELECTORS)}];
        var PLACED_SEL = [${jsList(PLACED_SELECTORS)}];

        var card = document.querySelector('.flip-card.showing') ||
                   document.querySelector('.flip-card.current') ||
                   document.querySelector('.CardItem.current');
        if (!card) return { found: false };

        var qid = '';
        var qi = card.querySelector('input[name="test_question[]"], [name="card_idx[]"]');
        if (qi) qid = qi.value;

        function count(sels) {
            for (var i = 0; i < sels.length; i++) {
                var n = card.querySelectorAll(sels[i]).length;
                if (n) return n;
            }
            return 0;
        }

        var words = count(WORD_SEL);
        var placed = count(PLACED_SEL);

        // 낱말 버튼이 보이면 이미 뒤집힌 것으로 본다 (클래스 이름이 달라도 풀 수 있게)
        var flipped = card.classList.contains('flip') || words > 0;

        var prompt = '';
        var pSel = ['.flip-card-front .front-hidden', '.flip-card-front .cc-table',
                    '.flip-card-front .text', '.q-mean-body', '.card-top .normal-body',
                    // 클래스 테스트: 제시문은 카드 바로 아래 .front-hidden(숨김) 과 .quest-direction .para_item3 에 있다
                    '.front-hidden', '.quest-direction .para_item3', '.para_item3',
                    '.test-sentence-mean', '.sentence-mean', '.quest-back', '.q-body', '.question'];
        for (var i = 0; i < pSel.length && !prompt; i++) {
            var el = card.querySelector(pSel[i]);
            if (el) prompt = (el.textContent || '').replace(/[ \t\r\n]+/g, ' ').trim();
        }
        if (!prompt) {
            // 화면 구조가 바뀌어 위 자리에 없으면: 카드 안의 글 중 낱말 버튼·놓인 낱말·버튼 글을 뺀 나머지에서
            // 한글이 든 줄을 제시문으로 본다 (제시문은 항상 우리말 뜻이다)
            var skip = [];
            for (var a = 0; a < WORD_SEL.length; a++) skip = skip.concat(Array.prototype.slice.call(card.querySelectorAll(WORD_SEL[a])));
            for (var b = 0; b < PLACED_SEL.length; b++) skip = skip.concat(Array.prototype.slice.call(card.querySelectorAll(PLACED_SEL[b])));
            skip = skip.concat(Array.prototype.slice.call(card.querySelectorAll('a.btn, button, .btn, script, style')));
            var lines = [];
            var walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null);
            var node;
            while ((node = walker.nextNode())) {
                var t = (node.nodeValue || '').replace(/[ \t\r\n]+/g, ' ').trim();
                if (!t || !/[가-힣]/.test(t)) continue;
                var p = node.parentElement, skipped = false;
                for (var k = 0; k < skip.length && !skipped; k++) if (skip[k] === p || skip[k].contains(p)) skipped = true;
                if (skipped) continue;
                if (p && p.offsetParent === null && !card.classList.contains('flip')) continue;
                lines.push(t);
            }
            prompt = lines.join(' ').trim();
        }

        return { found: true, qid: qid, flipped: flipped, prompt: prompt,
                 words: words, placed: placed, cls: card.className };
    """

    /** 낱말 버튼을 못 찾았을 때, 화면이 어떻게 생겼는지 로그로 남긴다. */
    private val DUMP_CARD_JS = """
        var card = document.querySelector('.flip-card.showing') ||
                   document.querySelector('.flip-card.current') ||
                   document.querySelector('.CardItem.current');
        if (!card) return { card: '(없음)' };
        var out = { card: card.className, counts: {} };
        var sels = ['.test-sentence-words', '.test-sentence-words a', '.btn-sentence-word',
                    '.sentence-tab-box', '.scramble-body', '.test-sentence-input',
                    'a.btn', 'button'];
        for (var i = 0; i < sels.length; i++) out.counts[sels[i]] = card.querySelectorAll(sels[i]).length;
        var kids = [];
        var all = card.querySelectorAll('*');
        for (var i = 0; i < all.length && kids.length < 12; i++) {
            var c = all[i].className;
            if (typeof c === 'string' && c && kids.indexOf(c) < 0) kids.push(c);
        }
        out.classes = kids;
        return out;
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

            var SEL = [${jsList(WORD_SELECTORS)}];
            var card = document.querySelector('.flip-card.showing') ||
                       document.querySelector('.flip-card.current') ||
                       document.querySelector('.CardItem.current') || document;
            var btns = [];
            for (var s = 0; s < SEL.length && !btns.length; s++) {
                var found = card.querySelectorAll(SEL[s]);
                if (found.length) btns = found;
            }
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
            var SEL = [${jsList(WORD_SELECTORS)}];
            var card = document.querySelector('.flip-card.showing') ||
                       document.querySelector('.flip-card.current') ||
                       document.querySelector('.CardItem.current') || document;
            var btns = [];
            for (var s = 0; s < SEL.length && !btns.length; s++) {
                var found = card.querySelectorAll(SEL[s]);
                if (found.length) btns = found;
            }
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
        var SEL = [${jsList(WORD_SELECTORS)}];
        var card = document.querySelector('.flip-card.showing') ||
                   document.querySelector('.flip-card.current') ||
                   document.querySelector('.CardItem.current');
        if (!card) return [];
        var out = [];
        var btns = [];
        for (var s = 0; s < SEL.length && !btns.length; s++) {
            var found = card.querySelectorAll(SEL[s]);
            if (found.length) btns = found;
        }
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
        var tokens = Norm.parseEnglishWords(english)
        // 타일이 여러 낱말 묶음이면 묶음 단위로 누른다
        val tileTexts = listButtons(d).filter { !it.endsWith("*") }
        if (tileTexts.any { Norm.parseEnglishWords(it).size > 1 }) tokens = planChunks(tokens, tileTexts)

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
            val maps = buildMaps(d, answerDict ?: AnswerDict())
            val cards = pageCards(d)
            if (cards.isNotEmpty()) {
                addCardsToMaps(maps, cards)
                d.log("[문장 테스트] 페이지 카드 목록 로드 (카드 ${cards.size}개)")
            }
            if (maps.m.isEmpty()) {
                // 카드 목록도 단어장도 없으면 사이트가 콘솔에 남기는 정답(arr_front)에 기댄다.
                d.log("[문장 테스트] 카드 목록·단어장이 없습니다 — 페이지가 남기는 정답으로 풉니다.")
            }

            var dumpedEmptyPrompt = false
            // 클래스 테스트는 문제마다 정답을 싣고 바로 지운다 — preload 가 챙겨 둔 것을 쓴다 (문제 id 로 바로 찾음)
            var testAnswers = pageTestAnswers(d)
            if (testAnswers.isNotEmpty()) {
                d.log("[문장 테스트] 페이지 정답 ${testAnswers.size}개를 확보했습니다 (문제별 정답 — 100점)")
            }
            val total = countTotal(d)
            val wrongIdx = Test.planWrongIndicesRange(total, MIN_SCORE, MAX_SCORE)
            if (total != null && total > 0) {
                val expected = kotlin.math.round((total - wrongIdx.size) * 1000.0 / total) / 10.0
                d.log("[문장 테스트] 총 ${total}문항 · 일부러 틀릴 문항 ${wrongIdx.size}개 -> 예상 ${expected}점 ($MIN_SCORE~${MAX_SCORE}점 사이로 맞춥니다)")
            }
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
                    if (testModalOpen(d)) {
                        if (handleTestModals(d)) d.log("[문장 테스트] 확인 모달을 눌렀습니다 (이전 응시 이어받기/새로 시작)")
                        if (stop.await(900)) break
                        continue
                    }
                    if (Memorize.startStudyIfNeeded(d, stop)) continue

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
                        } else if (n == 8) {
                            flipAttempts[q.qid] = n + 1
                            // 여덟 번 눌러도 낱말 버튼이 안 보인다 -> 화면 구조를 로그에 남긴다
                            val dump = d.evalObjectOrNull(DUMP_CARD_JS)
                            d.log(
                                "[문장 테스트] 낱말 버튼을 찾지 못했습니다. 화면 구조: " +
                                    (dump?.toString() ?: "(읽지 못함)").take(400)
                            )
                        }
                        if (stop.await(500)) break
                        continue
                    }

                    // 뒷면(단어 배열) -> 정답 조회 후 클릭
                    // 1순위: 그 문제의 정답 그대로 (클래스 테스트)
                    var english: String? = if (q.qid.isNotEmpty()) testAnswers["q" + q.qid] else null
                    if (english == null && testAnswers.isEmpty()) {
                        testAnswers = pageTestAnswers(d)          // 늦게 실린 경우 한 번 더
                        if (q.qid.isNotEmpty()) english = testAnswers["q" + q.qid]
                    }
                    if (english == null) english = matchEnglish(q.prompt, maps)
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
                        if (q.prompt.isEmpty() && !dumpedEmptyPrompt) {
                            dumpedEmptyPrompt = true
                            d.log("[문장 테스트] 제시문을 읽지 못했습니다. 화면 구조: " + d.eval(DUMP_CARD_JS).take(400))
                        }
                        answeredQids.add(q.qid)  // 건너뜀 (해당 문항 오답 처리)
                        if (stop.await(300)) break
                        continue
                    }

                    answeredCount++
                    d.progress(answeredCount, total ?: 0, answeredCount - wrongIdx.size, wrongIdx.size, maxOf(0, (total ?: 0) - answeredCount), "문장 테스트")
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
