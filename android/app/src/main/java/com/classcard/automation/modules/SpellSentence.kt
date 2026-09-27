package com.classcard.automation.modules

import com.classcard.automation.core.Driver
import com.classcard.automation.core.StopFlag
import org.json.JSONObject

/**
 * 문장 스펠 자동화 (신규 — 파이썬 원본 없음). 확장 `engine/modules/sentence.js` 의 spellSentence 와 같은 규칙·같은 JS.
 *
 * 문장 세트(set_type 5)의 /Spell/{set} 은 단어 스펠과 다른 화면이다 (scripts/v3/spell_sentence.js):
 *   - 카드: `.study-body .CardItem.active`, 카드 데이터는 jQuery data('item') (front = 정답 문장)
 *   - 학습설정 show_type: 2 어순배열(기본) / 0 영작 / 4 딕테이션 / 5·6 첫글자 / 7
 *   - 어순배열: `.back .para_item.active` 의 data('arr') 가 정답 낱말 배열(끝 구두점 [!?,.] 을 뗀 것),
 *     `.scramble-body .scramble-item` 의 data('input') 과 `==` 비교. 지금까지 놓은 수 = `.front .line span:not(.end)`.
 *   - 영작·딕테이션·첫글자: `textarea.input-answer` 의 마지막 keydown 이 isTrusted 여야 채점한다.
 *   - 결과: `.study-wrapper.correct|wrong` + `.study-footer .feedback .btn-retry-card` / `.btn-next-card`.
 *   - 끝: `#study_end.active` (모르는 카드가 있으면 `.btn-study-end-unknow` 로 한 바퀴 더)
 */
object SpellSentence {

    internal const val MAX_ROUNDS = 3       // 모르는 카드 다시 학습 최대 횟수
    private const val RETRY_PER_CARD = 2   // 오답 시 '지금 재시도' 횟수 (그 뒤 '나중에 다시')

    /** 화면 상태 한 번에 읽기 (확장의 SSPELL_STATE_JS 와 같은 본문) */
    private val STATE_JS = """
function vis(el) { return !!el && el.offsetParent !== null; }
var out = { end: false, unknown: 0, round: false, start: false, modal: false, card: false };
var endEl = document.querySelector('#study_end');
if (endEl && endEl.classList.contains('active')) {
    out.end = true;
    var un = endEl.querySelector('.btn-study-end-unknow');
    var cnt = endEl.querySelector('.unknown_count');
    out.unknown = (vis(un) && cnt) ? (parseInt(cnt.textContent, 10) || 0) : 0;
}
var rep = document.querySelectorAll('.btn-study-end-repeat');
for (var i = 0; i < rep.length; i++) if (vis(rep[i])) out.end = true;
out.round = vis(document.querySelector('.round-body.active'));
var sb = document.querySelectorAll('.btn-opt-start, .start-opt-body a.btn');
for (var j = 0; j < sb.length; j++) if (vis(sb[j])) out.start = true;
var modal = document.querySelector('#alertModal');
out.modal = !!modal && window.getComputedStyle(modal).display === 'block';
var wrap = document.querySelector('.study-wrapper');
out.correct = !!wrap && wrap.classList.contains('correct');
out.wrong = !!wrap && wrap.classList.contains('wrong');
out.playing = !!(window.audio && window.audio.src && !window.audio.paused && !window.audio.ended);
out.showType = (typeof show_type !== 'undefined' && show_type !== null) ? parseInt(show_type, 10) : null;
var card = document.querySelector('.study-body .CardItem.active') || document.querySelector('.CardItem.active');
if (!card || !vis(card)) return out;
out.card = true;
var jq = window.jQuery;
var item = jq ? jq(card).data('item') : null;
out.key = String(jq ? jq(card).data('idx') : '') + ':' + Array.prototype.indexOf.call(card.parentNode.children, card);
out.status = card.getAttribute('data-status') || '';
out.step1 = !!card.querySelector('.step.s1.active');                     // 문장 암기 1단계(문장 보기)
var ib = card.querySelector('.front .input-box') || card.querySelector('.input-box');
// 예전 화면: v3 의 표식(카드 안 .scramble-body / 입력창 / input-box 의 arr_answer 데이터)이 없는데 낱말 타일은 있다
var hasArrAnswer = !!(ib && jq && jq(ib).data('arr_answer'));
out.legacy = !card.querySelector('.scramble-body') && !card.querySelector('textarea.input-answer') && !hasArrAnswer
    && !!(card.querySelector('.sentence-word, .btn-scramble, .scramble-item') || document.querySelector('.scramble-body .btn-scramble'));
out.scramble = card.classList.contains('scramble') || !!card.querySelector('.scramble-body');
out.recall = !!ib && !out.scramble;                                        // 문장 리콜(빈칸 채우기)
if (out.recall) {
    var arrA = jq ? jq(ib).data('arr_answer') : null;
    var rw = [];
    if (arrA && arrA.length) for (var q = 0; q < arrA.length; q++) rw.push(String(arrA[q]).trim());
    out.rWords = rw;
    out.rPlaced = ib.querySelectorAll('.btn-scramble:not(.now)').length;
    var rt = document.querySelectorAll('.scramble-body .btn-scramble');
    var rl = [];
    for (var r = 0; r < rt.length; r++) rl.push({ text: (rt[r].textContent || '').trim(), clicked: rt[r].classList.contains('clicked') });
    out.rTiles = rl;
}
if (out.scramble) {
    var para = card.querySelector('.back .para_item.active');
    var arr = (jq && para) ? jq(para).data('arr') : null;
    var words = [];
    if (arr && arr.length) {
        for (var k = 0; k < arr.length; k++) {
            var w = String(arr[k]);
            if (w == '/') continue;
            var s = w.replace(/[!?,.]+$/g, '').trim();
            words.push(s.length ? s : w.trim());
        }
    }
    out.words = words;
    out.done = card.querySelectorAll('.front .line span:not(.end)').length;
    var body = card.querySelector('.scramble-body');
    out.tilesDisabled = !!body && body.classList.contains('disabled');
    var tiles = card.querySelectorAll('.scramble-body .scramble-item');
    var list = [];
    for (var t = 0; t < tiles.length; t++) {
        var inp = jq ? jq(tiles[t]).data('input') : null;
        list.push({ input: inp == null ? (tiles[t].textContent || '').trim() : String(inp),
                    clicked: tiles[t].classList.contains('clicked') });
    }
    out.tiles = list;
} else {
    var ta = card.querySelector('textarea.input-answer');
    out.hasInput = vis(ta);
    out.value = ta ? ta.value : '';
    var front = (item && item.front != null) ? String(item.front) : '';
    var ans = (typeof removeBracket === 'function') ? removeBracket(front)
        : front.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '');
    ans = ans.replace(/<br\s*\/?>/gi, ' ').replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim();
    out.answer = ans;
}
return out;"""

    internal class Tile(val input: String, val clicked: Boolean)

    internal class State(o: JSONObject) {
        val step1 = o.optBoolean("step1")
        val legacy = o.optBoolean("legacy")
        val recall = o.optBoolean("recall")
        val rWords: List<String> = o.optJSONArray("rWords")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
        val rPlaced = o.optInt("rPlaced")
        val rTiles: List<Tile> = o.optJSONArray("rTiles")?.let { a ->
            (0 until a.length()).map { i -> val t = a.optJSONObject(i); Tile(t?.optString("text") ?: "", t?.optBoolean("clicked") ?: false) }
        } ?: emptyList()
        val end = o.optBoolean("end")
        val unknown = o.optInt("unknown")
        val round = o.optBoolean("round")
        val start = o.optBoolean("start")
        val modal = o.optBoolean("modal")
        val card = o.optBoolean("card")
        val correct = o.optBoolean("correct")
        val wrong = o.optBoolean("wrong")
        val showType: Int? = if (o.isNull("showType")) null else o.optInt("showType")
        val key = o.optString("key", "")
        val status = o.optString("status", "")
        val scramble = o.optBoolean("scramble")
        val words: List<String> = o.optJSONArray("words")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
        val done = o.optInt("done")
        val tilesDisabled = o.optBoolean("tilesDisabled")
        val tiles: List<Tile> = o.optJSONArray("tiles")?.let { a ->
            (0 until a.length()).map { i ->
                val t = a.optJSONObject(i)
                Tile(t?.optString("input") ?: "", t?.optBoolean("clicked") ?: false)
            }
        } ?: emptyList()
        val hasInput = o.optBoolean("hasInput")
        val value = o.optString("value", "")
        val answer = o.optString("answer", "")
    }

    internal suspend fun state(d: Driver): State? = d.evalObjectOrNull(STATE_JS)?.let { State(it) }

    /** 어순배열 타일 하나 클릭 (타일 click 은 isTrusted 를 안 보지만 규칙대로 진짜 클릭을 먼저 쓴다) */
    internal suspend fun clickTile(d: Driver, index: Int): Boolean = d.clickSmart(
        """
        var card = document.querySelector('.study-body .CardItem.active') || document.querySelector('.CardItem.active');
        var tiles = card ? card.querySelectorAll('.scramble-body .scramble-item') : [];
        el = tiles[$index] || null;
        """
    )

    /** 채점 결과 화면의 버튼 ('.btn-next-card' 다음 카드/나중에 다시, '.btn-retry-card' 지금 재시도) */
    internal suspend fun clickFeedback(d: Driver, cls: String): Boolean = d.clickSmart(
        """
        var btns = document.querySelectorAll('.study-footer .feedback $cls');
        for (var i = 0; i < btns.length; i++) if (btns[i].offsetParent !== null) { el = btns[i]; break; }
        if (!el) {   // 문장 암기 화면은 feedback 묶음 없이 footer 에 바로 버튼이 있다
            btns = document.querySelectorAll('.study-footer $cls');
            for (var j = 0; j < btns.length; j++) if (btns[j].offsetParent !== null) { el = btns[j]; break; }
        }
        """
    )

    private suspend fun clickConfirm(d: Driver): Boolean = d.clickSmart(
        """
        var btns = document.querySelectorAll('.study-footer .btns .btn-confirm-card');
        for (var i = 0; i < btns.length; i++) if (btns[i].offsetParent !== null) { el = btns[i]; break; }
        """
    )

    /** '대소문자 틀림!' 같은 안내 모달의 확인 버튼 */
    internal suspend fun closeModal(d: Driver): Boolean = d.clickSmart(
        """
        var btns = document.querySelectorAll('#alertModal .btn, #alertModal button');
        for (var i = 0; i < btns.length; i++) if (btns[i].offsetParent !== null) { el = btns[i]; break; }
        """
    )

    /** 입력창(textarea.input-answer)에 포커스를 주고 비운다 (값 지우기는 신뢰된 입력이 필요 없다) */
    private suspend fun focusInput(d: Driver): Boolean = d.evalBool(
        """
        var card = document.querySelector('.study-body .CardItem.active') || document.querySelector('.CardItem.active');
        var ta = card ? card.querySelector('textarea.input-answer') : null;
        if (!ta || ta.offsetParent === null) return false;
        ta.focus();
        if (ta.value) {
            var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(ta, '');
            ta.dispatchEvent(new Event('input', {bubbles: true}));
        }
        return true;
        """
    )

    private suspend fun refocusInput(d: Driver): Boolean = d.evalBool(
        """
        var card = document.querySelector('.study-body .CardItem.active') || document.querySelector('.CardItem.active');
        var ta = card ? card.querySelector('textarea.input-answer') : null;
        if (!ta) return false;
        if (document.activeElement !== ta) ta.focus();
        return true;
        """
    )

    /** 첫글자 모드(5·6)에서 칠 글자들: 낱말마다 첫 글자·숫자 하나 (기호뿐인 낱말은 사이트가 알아서 채운다) */
    fun firstLetters(answer: String): List<String> {
        val re = Regex("[0-9A-Za-zÀ-ɏ가-힣]")
        return answer.split(Regex("\\s+")).mapNotNull { w -> re.find(w)?.value }
    }

    internal enum class Wait { CHANGED, DONE, STOPPED, STUCK }

    /** 카드가 바뀌거나(키 변화) 끝날 때까지 기다린다 */
    internal suspend fun waitCardChange(d: Driver, stop: StopFlag, prevKey: String, timeout: Long): Wait {
        var elapsed = 0L
        while (elapsed < timeout) {
            if (stop.await(200)) return Wait.STOPPED
            elapsed += 200
            val s = state(d) ?: continue
            if (s.end) return Wait.DONE
            if (s.round || s.start) return Wait.CHANGED
            if (s.card && s.key != prevKey && !s.correct && !s.wrong) return Wait.CHANGED
        }
        return Wait.STUCK
    }

    /** 소리가 나는 중이면 끝까지 듣는다 (최대 maxMs) */
    internal suspend fun waitAudio(d: Driver, stop: StopFlag, maxMs: Long) {
        var waited = 0L
        while (waited < maxMs) {
            val playing = d.evalBool(
                "return !!(window.audio && window.audio.src && !window.audio.paused && !window.audio.ended);"
            )
            if (!playing) return
            if (stop.await(250)) return
            waited += 250
        }
    }

    /** 문장 스펠 자동화 (어순배열 · 영작 · 딕테이션 · 첫글자 모두) */
    val run: ModeFn = { d, _, stop ->
        d.log("[문장 스펠] 시작")
        var rounds = 0
        var retries = 0
        var retryKey: String? = null
        var loggedMode = false
        var warnedTrusted = false
        var sameCount = 0
        var lastSig = ""
        try {
            loop@ while (!stop.isSet) {
                val s = state(d)
                if (s == null) { if (stop.await(400)) break; continue }
                if (s.card) Memorize.reportCardProgress(d, "문장 스펠")

                if (s.end) {
                    if (s.unknown > 0 && rounds < MAX_ROUNDS) {
                        rounds += 1
                        d.log("[문장 스펠] 모르는 카드 ${s.unknown}개 — 다시 학습합니다 ($rounds/$MAX_ROUNDS)")
                        d.clickFirstVisible("#study_end .btn-study-end-unknow")
                        if (stop.await(1500)) break
                        continue
                    }
                    d.log("[문장 스펠] 학습 완료")
                    d.exec("""var a = document.querySelectorAll("#study_end.active .study-header a"); if (a.length) a[0].click();""")
                    d.exec("""var a = document.querySelectorAll(".btn-top-menu a"); if (a.length) a[0].click();""")
                    stop.sleep(500)
                    d.exec("""var a = document.querySelectorAll(".close_o"); if (a.length) a[0].click();""")
                    stop.set()
                    break
                }
                if (s.modal) {            // '대소문자 틀림!' 안내 → 확인 (정답 처리는 이미 됐다)
                    closeModal(d)
                    if (stop.await(700)) break
                    continue
                }
                if (s.round) { if (stop.await(500)) break; continue }
                if (s.start) {
                    Memorize.startStudyIfNeeded(d, stop)
                    if (stop.await(800)) break
                    continue
                }
                if (!s.card) { if (stop.await(400)) break; continue }

                // 같은 상태가 오래 이어지면 한 줄 진단 (사이트가 바뀌었을 때 원인을 짚기 위해)
                val sig = "${s.key}|${s.correct}|${s.wrong}|${s.scramble}|${s.done}|${s.tiles.count { !it.clicked }}|${s.value}"
                if (sig == lastSig) {
                    sameCount += 1
                    if (sameCount == 40) {
                        d.log("[문장 스펠] 진행이 멈췄습니다 — 화면: key=${s.key} status=${s.status} scramble=${s.scramble} done=${s.done} words=${s.words.size} tiles=${s.tiles.size} showType=${s.showType}")
                        clickFeedback(d, ".btn-next-card")
                    }
                } else { sameCount = 0; lastSig = sig }

                if (!loggedMode) {
                    loggedMode = true
                    val mode = when {
                        s.scramble -> "어순배열"
                        s.showType == 5 || s.showType == 6 -> "첫글자 입력"
                        s.showType == 4 -> "딕테이션"
                        else -> "영작"
                    }
                    d.log("[문장 스펠] 학습설정: $mode")
                }

                if (s.correct) {          // 정답 → 소리가 나면 끝까지 듣고 다음 카드
                    if (!s.scramble) { stop.sleep(900); waitAudio(d, stop, 20000) }
                    if (stop.isSet) break
                    clickFeedback(d, ".btn-next-card")
                    val r = waitCardChange(d, stop, s.key, 3000)
                    if (r == Wait.STOPPED) break
                    if (r == Wait.STUCK) { d.blurActiveElement(); d.pressSpace() }
                    continue
                }
                if (s.wrong) {            // 오답 → 몇 번은 지금 재시도, 그 뒤엔 나중에 다시
                    if (retryKey != s.key) { retryKey = s.key; retries = 0 }
                    if (retries < RETRY_PER_CARD) {
                        retries += 1
                        d.log("[문장 스펠] 오답 — 지금 재시도 ($retries/$RETRY_PER_CARD)")
                        clickFeedback(d, ".btn-retry-card")
                    } else {
                        d.log("[문장 스펠] 오답 — 나중에 다시")
                        clickFeedback(d, ".btn-next-card")
                        waitCardChange(d, stop, s.key, 3000)
                    }
                    if (stop.await(500)) break
                    continue
                }

                if (s.scramble) {
                    if (s.words.isEmpty() || s.tilesDisabled) { if (stop.await(300)) break; continue }
                    if (s.done >= s.words.size) { if (stop.await(300)) break; continue }  // 다음 묶음/문단으로 넘어가는 중
                    val expected = s.words[s.done]
                    val hit = s.tiles.indexOfFirst { !it.clicked && it.input == expected }
                    if (hit < 0) {
                        // 사이트와 같은 비교인데 없다면 화면이 갱신되는 중 — 잠깐 기다렸다 다시
                        if (stop.await(250)) break
                        continue
                    }
                    clickTile(d, hit)
                    if (stop.await(120)) break
                    continue
                }

                // ---- 입력형 (영작 · 딕테이션 · 첫글자)
                if (!s.hasInput) { if (stop.await(300)) break; continue }
                if (s.answer.isEmpty()) {
                    d.log("[문장 스펠] 정답 문장을 읽지 못했습니다 — 빈 답으로 넘깁니다")
                    clickConfirm(d)
                    if (stop.await(600)) break
                    continue
                }
                if (!focusInput(d)) { if (stop.await(300)) break; continue }
                var typed = true
                if (s.showType == 5 || s.showType == 6) {
                    for (ch in firstLetters(s.answer)) {
                        if (!d.typeText(ch)) { typed = false; break }
                        if (stop.await(140)) break
                        refocusInput(d)      // 사이트가 글자마다 blur → 50ms 뒤 focus 를 한다
                    }
                } else {
                    typed = d.typeText(s.answer)
                }
                if (stop.isSet) break
                if (!typed && !warnedTrusted) {
                    warnedTrusted = true
                    d.log("[문장 스펠] 진짜 키 입력을 보낼 수 없어 채점이 거부됩니다 — 학습설정을 \"어순배열\"로 바꾸면 됩니다")
                }
                if (stop.await(150)) break
                clickConfirm(d)
                // 채점 결과(correct/wrong) 또는 카드 전환을 기다린다
                var waited = 0L
                while (waited < 3000) {
                    if (stop.await(200)) break
                    waited += 200
                    val t = state(d)
                    if (t == null || t.end || t.modal || t.correct || t.wrong || t.key != s.key) break
                }
            }
        } catch (e: Throwable) {
            if (!stop.isSet) d.log("[문장 스펠] 오류: ${e.message}")
        } finally {
            d.log("[문장 스펠] 종료")
        }
    }
}
