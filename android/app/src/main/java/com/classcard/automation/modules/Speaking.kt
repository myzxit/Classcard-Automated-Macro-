package com.classcard.automation.modules

import com.classcard.automation.core.Driver
import com.classcard.automation.core.StopFlag
import org.json.JSONObject

/**
 * 스피킹 자동화 — 확장 `engine/modules/speaking.js` 와 같은 규칙·같은 JS.
 *
 * 스피킹은 세트 화면의 '스피킹' 버튼이 여는 `/Paragraph/{set}/0/0/{class}` 화면이다
 * (사이트 스크립트: scripts/v3/paragraph_v2.js).
 * 단계는 여섯 가지고 시작 화면의 `.btn-start-study[data-mode="…"]` 로 고른다:
 *   read(입해석) · comp(입영작) · listen(집중듣기) · aloud(낭독) · shadow(쉐도잉) · record(녹음)
 *
 * **낭독·쉐도잉·녹음은 마이크가 필요하고, 녹음한 목소리가 그대로 올라가 선생님께 전달되고 자동 채점된다.**
 * 그래서 이 매크로는 목소리를 지어내지 않는다. 소리 재생·녹음 시작/정지·카드 넘기기만 대신하고
 * 말하기는 사용자가 직접 한다. 기본은 이 세 단계를 건너뛴다(설정에서 켤 수 있다).
 */
object Speaking {

    val MIC_MODES = listOf("aloud", "shadow", "record")
    val AUTO_MODES = listOf("read", "comp", "listen")

    private val MODE_LABEL = mapOf(
        "read" to "입해석", "comp" to "입영작", "listen" to "집중듣기",
        "aloud" to "낭독", "shadow" to "쉐도잉", "record" to "녹음",
    )

    /** 화면 상태 한 번에 읽기 (확장의 SPEAK_STATE_JS 와 같은 본문) */
    private val STATE_JS = """
function vis(el) { return !!el && el.offsetParent !== null; }
var out = { modes: [], mode: null, opt: false, card: false, cards: 0, idx: 0, last: false,
            playing: false, recording: false, modal: false, end: false };
var modal = document.querySelector('#alertModal');
var confirmEl = document.querySelector('#confirmModal');
out.modal = (!!modal && window.getComputedStyle(modal).display === 'block') ||
            (!!confirmEl && window.getComputedStyle(confirmEl).display === 'block');
var btns = document.querySelectorAll('.btn-start-study[data-mode]');
for (var i = 0; i < btns.length; i++) {
    var m = btns[i].getAttribute('data-mode');
    if (!m || m === 'end') continue;
    var c = parseInt(btns[i].getAttribute('data-cnt'), 10);
    out.modes.push({ mode: m, cnt: isNaN(c) ? 0 : c, visible: vis(btns[i]) });
}
out.opt = vis(document.querySelector('.start-opt-body'));
var wrap = document.querySelector('.study-wrapper');
if (wrap) {
    var names = ['read', 'comp', 'listen', 'aloud', 'shadow', 'record'];
    for (var j = 0; j < names.length; j++) if (wrap.classList.contains(names[j])) out.mode = names[j];
    out.end = wrap.classList.contains('end');
}
var cards = document.querySelectorAll('.study-body .CardItem');
out.cards = cards.length;
var card = document.querySelector('.study-body .CardItem.active') || document.querySelector('.CardItem.active');
if (card && vis(card)) {
    out.card = true;
    out.idx = Array.prototype.indexOf.call(cards, card) + 1;
    out.last = out.idx >= cards.length;
    out.key = String(out.idx) + ':' + (card.getAttribute('data-idx') || '');
}
function visIn(sel) {
    var els = document.querySelectorAll(sel);
    for (var k = 0; k < els.length; k++) if (vis(els[k])) return true;
    return false;
}
out.hasAudio = visIn('.btn-bottom-audio, .btn-audio-all');
out.hasRecord = visIn('.btn-bottom-record, .btn-audio-record');
out.playing = !!(window.audio && window.audio.src && !window.audio.paused && !window.audio.ended);
return out;"""

    private class State(o: JSONObject) {
        val opt = o.optBoolean("opt")
        val modal = o.optBoolean("modal")
        val end = o.optBoolean("end")
        val card = o.optBoolean("card")
        val cards = o.optInt("cards")
        val idx = o.optInt("idx")
        val key = o.optString("key", "")
        val mode: String? = if (o.isNull("mode")) null else o.optString("mode")
        val hasAudio = o.optBoolean("hasAudio")
        val hasRecord = o.optBoolean("hasRecord")
        val modes: List<Pair<String, Int>> = o.optJSONArray("modes")?.let { a ->
            (0 until a.length()).mapNotNull { i ->
                val m = a.optJSONObject(i) ?: return@mapNotNull null
                m.optString("mode") to m.optInt("cnt")
            }
        } ?: emptyList()
    }

    private suspend fun state(d: Driver): State? = d.evalObjectOrNull(STATE_JS)?.let { State(it) }

    private suspend fun startMode(d: Driver, mode: String): Boolean = d.clickSmart(
        """
        var b = document.querySelector('.btn-start-study[data-mode="$mode"]');
        if (b && b.offsetParent !== null) el = b;
        """
    )

    private suspend fun clickBottom(d: Driver, sel: String): Boolean = d.clickSmart(
        """
        var btns = document.querySelectorAll('$sel');
        for (var i = 0; i < btns.length; i++) if (btns[i].offsetParent !== null) { el = btns[i]; break; }
        """
    )

    private suspend fun closeModal(d: Driver): Boolean = d.clickSmart(
        """
        var sels = ['#alertModal .btn-ok', '#confirmModal .btn-ok', '.modal-content .btn-ok'];
        for (var i = 0; i < sels.length && !el; i++) {
            var btns = document.querySelectorAll(sels[i]);
            for (var j = 0; j < btns.length; j++) {
                if (btns[j].offsetParent !== null && !btns[j].classList.contains('close-pos')) { el = btns[j]; break; }
            }
        }
        """
    )

    /** 오래 기다리는 동안에도 화면을 한 번씩 읽어 둔다 (확장의 sleepAwake 와 같은 뜻). */
    private suspend fun sleepAwake(d: Driver, stop: StopFlag, ms: Long): Boolean {
        var left = ms
        while (left > 0) {
            val slice = if (left < 500) left else 500
            if (stop.await(slice)) return true
            left -= slice
            d.evalBool("return true;")
        }
        return stop.isSet
    }

    /** 예문 소리를 끝까지 듣는다 (중간에 끊지 않는다). */
    private suspend fun waitAudioEnd(d: Driver, stop: StopFlag, maxMs: Long = 30000) {
        var waited = 0L
        while (waited < 3000) {
            if (stop.await(200)) return
            waited += 200
            if (d.evalBool("return !!(window.audio && window.audio.src && !window.audio.paused);")) break
        }
        waited = 0
        while (waited < maxMs) {
            if (stop.await(250)) return
            waited += 250
            if (!d.evalBool("return !!(window.audio && window.audio.src && !window.audio.paused && !window.audio.ended);")) return
        }
    }

    private enum class Wait { CHANGED, DONE, STOPPED, STUCK }

    private suspend fun waitCardChange(d: Driver, stop: StopFlag, prevKey: String, timeout: Long = 4000): Wait {
        var elapsed = 0L
        while (elapsed < timeout) {
            if (stop.await(250)) return Wait.STOPPED
            elapsed += 250
            val s = state(d) ?: continue
            if (s.end || s.opt) return Wait.DONE
            if (s.card && s.key != prevKey) return Wait.CHANGED
        }
        return Wait.STUCK
    }

    private suspend fun runOneMode(d: Driver, stop: StopFlag, mode: String, recordSec: Int): Boolean {
        val label = MODE_LABEL[mode] ?: mode
        val needsMic = MIC_MODES.contains(mode)
        if (!startMode(d, mode)) {
            d.log("[스피킹] $label 단계를 열지 못했습니다 — 건너뜁니다")
            return false
        }
        d.log("[스피킹] $label 시작" + if (needsMic) " — 마이크 단계입니다. 소리가 끝나면 말씀하세요." else "")
        if (stop.await(1500)) return false

        var sameCount = 0
        var lastKey = ""
        while (!stop.isSet) {
            val s = state(d)
            if (s == null) { if (stop.await(400)) break; continue }

            if (s.modal) { closeModal(d); if (stop.await(800)) break; continue }
            if (s.end || s.opt) { d.log("[스피킹] $label 끝"); return true }
            if (!s.card) { if (stop.await(400)) break; continue }
            if (s.mode != null && s.mode != mode) { d.log("[스피킹] $label 끝 (화면이 바뀌었습니다)"); return true }

            d.progress(s.idx, s.cards, s.idx - 1, 0, maxOf(0, s.cards - s.idx), "스피킹 $label")

            if (s.key == lastKey) {
                sameCount += 1
                if (sameCount == 40) {
                    d.log("[스피킹] $label 진행이 멈췄습니다 — 화면: idx=${s.idx} cards=${s.cards} mode=${s.mode}")
                    clickBottom(d, ".btn-next-card")
                }
            } else { sameCount = 0; lastKey = s.key }

            if (s.hasAudio) {
                clickBottom(d, ".btn-bottom-audio, .btn-audio-all")
                waitAudioEnd(d, stop)
                if (stop.isSet) break
            }

            if (needsMic && s.hasRecord) {
                if (clickBottom(d, ".btn-bottom-record, .btn-audio-record")) {
                    d.log("[스피킹] $label ${s.idx}/${s.cards} — 지금 말씀하세요 (${recordSec}초)")
                    if (sleepAwake(d, stop, recordSec * 1000L)) break
                    clickBottom(d, ".btn-bottom-audio-stop, .btn-bottom-record")
                    if (sleepAwake(d, stop, 800)) break
                }
            }

            clickBottom(d, ".btn-next-card")
            when (waitCardChange(d, stop, s.key)) {
                Wait.STOPPED -> break
                Wait.DONE -> { d.log("[스피킹] $label 끝"); return true }
                Wait.STUCK -> { d.blurActiveElement(); d.pressSpace() }
                Wait.CHANGED -> Unit
            }
        }
        return !stop.isSet
    }

    /** 스피킹 자동화. includeMic 가 true 면 낭독·쉐도잉·녹음까지 진행한다(직접 말해야 한다). */
    suspend fun run(d: Driver, stop: StopFlag, includeMic: Boolean, recordSec: Int) {
        d.log("[스피킹] 시작")
        try {
            var s = state(d)
            if (s == null) { d.log("[스피킹] 스피킹 화면이 아닙니다 (세트 화면의 [스피킹] 을 먼저 누르세요)"); return }
            if (s.modes.isEmpty()) { d.log("[스피킹] 단계 버튼을 찾지 못했습니다 — 스피킹 화면이 맞는지 확인하세요"); return }

            val all = s.modes.map { it.first }
            val wanted = all.filter { AUTO_MODES.contains(it) || MIC_MODES.contains(it) }
                .filter { includeMic || !MIC_MODES.contains(it) }
            val skipped = all.filter { MIC_MODES.contains(it) && !includeMic }

            d.log("[스피킹] 할 단계: " + (wanted.joinToString(" · ") { MODE_LABEL[it] ?: it }.ifEmpty { "없음" }))
            if (skipped.isNotEmpty()) {
                d.log("[스피킹] 건너뛸 단계(마이크 필요): " + skipped.joinToString(" · ") { MODE_LABEL[it] ?: it })
            }
            if (includeMic) {
                d.log("[스피킹] 낭독·쉐도잉·녹음은 목소리가 그대로 선생님께 올라갑니다 — 매크로는 소리 재생과 녹음 시작/정지만 대신하고, 말하기는 직접 하셔야 합니다.")
            }

            for (mode in wanted) {
                if (stop.isSet) break
                s = state(d)
                if (s != null && !s.opt && s.mode != null) {
                    clickBottom(d, ".btn-start-study.end, .btn-back")
                    if (stop.await(1200)) break
                }
                runOneMode(d, stop, mode, recordSec)
                if (stop.await(1200)) break
            }
            if (!stop.isSet) d.log("[스피킹] 할 수 있는 단계를 모두 마쳤습니다")
        } catch (e: Throwable) {
            if (!stop.isSet) d.log("[스피킹] 오류: ${e.message}")
        } finally {
            d.log("[스피킹] 종료")
        }
    }
}
