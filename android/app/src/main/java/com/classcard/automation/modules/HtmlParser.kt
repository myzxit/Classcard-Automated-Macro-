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
            d.log("[!] study_data를 찾을 수 없습니다. 학습 페이지가 맞는지 확인하세요.")
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
