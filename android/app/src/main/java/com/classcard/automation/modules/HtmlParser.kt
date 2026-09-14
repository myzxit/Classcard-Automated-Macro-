package com.classcard.automation.modules

import com.classcard.automation.core.Driver
import org.json.JSONArray

/** 카드 한 장. 파이썬의 `{"front": ..., "back": ...}` 에 대응. */
data class Card(val front: String, val back: String)

/** 파이썬 `answer_dict` (= {back: front}) 대응. 입력 순서를 유지한다. */
typealias AnswerDict = LinkedHashMap<String, String>

/**
 * HtmlParser.py 이식.
 *
 * 원본은 `driver.page_source` 에서 `var study_data = [...]` 를 정규식으로 찾았다.
 * WebView 에서는 전역 변수 `study_data` 를 바로 읽을 수 있으므로 그 경로를 먼저 쓰고,
 * 실패하면 원본과 동일하게 HTML 정규식으로 폴백한다.
 */
object HtmlParser {

    private val STUDY_DATA_RE = Regex("var\\s+study_data\\s*=\\s*(\\[.*?\\]);", RegexOption.DOT_MATCHES_ALL)

    suspend fun getData(d: Driver): List<Card>? {
        // 1) 전역 study_data 직접 읽기
        val direct = d.evalArrayOrNull(
            "return (typeof study_data !== 'undefined' && study_data) ? study_data : null;"
        )
        if (direct != null && direct.length() > 0) {
            val cards = toCards(direct)
            if (cards.isNotEmpty()) {
                d.log("데이터 추출 완료! 총 ${cards.size}개 카드")
                return cards
            }
        }

        // 2) 폴백: 원본과 동일한 HTML 정규식
        val html = d.evalStringOrNull("return document.documentElement.outerHTML;")
        if (html == null) {
            d.log("[!] 페이지 HTML을 읽지 못했습니다.")
            return null
        }
        val match = STUDY_DATA_RE.find(html)
        if (match == null) {
            // 지금 사이트의 학습 페이지에는 study_data 가 없다(실제 페이지에서 확인).
            // 카드는 학습이 시작된 뒤 화면에 그려지므로, 그려진 카드에서 직접 읽는다.
            val fromDom = getDataFromCards(d)
            if (fromDom.isNotEmpty()) {
                d.log("데이터 추출 완료! 총 ${'$'}{fromDom.size}개 카드 (화면에서 읽음)")
                return fromDom
            }
            d.log("[!] 단어 데이터를 찾지 못했습니다. 학습을 시작해 카드가 보이는 상태에서 다시 눌러 주세요.")
            return null
        }
        return try {
            val cards = toCards(JSONArray(match.groupValues[1]))
            d.log("데이터 추출 완료! 총 ${cards.size}개 카드")
            cards
        } catch (e: Throwable) {
            d.log("[오류] JSON 파싱 실패: ${e.message}")
            null
        }
    }

    /**
     * 화면에 그려진 카드에서 단어/뜻을 읽는다 (study_data 가 없는 페이지용).
     *
     * 실제 리콜 페이지에서 확인한 구조 — 클래스 이름이 페이지마다 난수로 바뀌므로
     * 바뀌지 않는 것만 쓴다:
     *   단어  : .CardItem 안의 .text-normal
     *   정답 뜻: 보기 줄 중 .answer 가 붙은 줄의 .cc-ellipsis 글자
     */
    suspend fun getDataFromCards(d: Driver): List<Card> {
        val rows = d.evalArrayOrNull(
            """
            function txt(el) { return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim(); }
            var out = [];
            var seen = {};
            var items = document.querySelectorAll('.CardItem');
            for (var i = 0; i < items.length; i++) {
                var c = items[i];
                var w = c.querySelector('.card-top .text-normal') || c.querySelector('.text-normal');
                var front = txt(w);
                if (!front) continue;
                var back = '';
                var ans = c.querySelector('.answer');
                if (ans) back = txt(ans.querySelector('.cc-ellipsis') || ans);
                if (!back) continue;
                var key = front + '\u0001' + back;
                if (seen[key]) continue;
                seen[key] = 1;
                out.push({ front: front, back: back });
            }
            return out;
            """
        ) ?: return emptyList()
        val out = ArrayList<Card>(rows.length())
        for (i in 0 until rows.length()) {
            val o = rows.optJSONObject(i) ?: continue
            val f = o.optString("front", "").trim()
            val b = o.optString("back", "").trim()
            if (f.isNotEmpty() && b.isNotEmpty()) out.add(Card(f, b))
        }
        return out
    }

    private fun toCards(arr: JSONArray): List<Card> {
        val result = ArrayList<Card>(arr.length())
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            result.add(
                Card(
                    front = obj.optString("front", "").trim(),
                    back = obj.optString("back", "").trim(),
                )
            )
        }
        return result
    }

    /** Spell.py 의 `dict_from_cards` 이식. */
    fun dictFromCards(cards: List<Card>?): AnswerDict? {
        if (cards.isNullOrEmpty()) return null
        val dict = AnswerDict()
        for (c in cards) dict[c.back] = c.front
        return dict
    }
}
