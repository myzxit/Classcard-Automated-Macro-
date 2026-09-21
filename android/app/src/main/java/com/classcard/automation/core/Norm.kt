package com.classcard.automation.core

import java.text.Normalizer

/**
 * 파이썬 모듈들에 흩어져 있던 정규화/토큰화 함수를 한곳에 모아 1:1 이식한 것.
 * 각 함수 주석에 원본 위치를 남겨 두었다.
 */
object Norm {

    /** `unicodedata.normalize('NFKC', s)` */
    fun nfkc(text: String?): String =
        if (text.isNullOrEmpty()) "" else Normalizer.normalize(text, Normalizer.Form.NFKC)

    // ------------------------------------------------------- 공통 정규식

    /** Test.py / Matching.py 의 `_NON_MATCH` — 한글/영문 글자만 남긴다. */
    private val NON_MATCH = Regex("[^가-힣a-zA-Z]")

    /** Scramble.py 의 `_NON_KO` */
    private val NON_KO = Regex("[^가-힣a-zA-Z]")

    /** Scramble.py 의 `_NON_WORD` */
    private val NON_WORD = Regex("[^a-zA-Z0-9]")

    /** Matching.py / Scramble.py 의 `_TAG` */
    private val TAG = Regex("<[^>]+>")

    /** MemorizeSentence.py 의 제로폭/공백 문자 집합 + TestSentence.py 의 `_WS` */
    private val WS_ZERO_WIDTH = Regex("[\\s​‌‍‎‏﻿]")

    // ------------------------------------------------------- HTML 태그 제거

    /** Matching.py / Scramble.py 의 `_strip_tags` */
    fun stripTags(text: String?): String {
        val replaced = TAG.replace(text ?: "", " ")
        return unescapeHtml(replaced)
    }

    /** `html.unescape` 의 실사용 범위 대응. */
    private fun unescapeHtml(text: String): String {
        if (!text.contains('&')) return text
        var out = text
        out = out.replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&apos;", "'")
        // 숫자 엔티티 (&#123; / &#x1F600;)
        out = Regex("&#(x?)([0-9a-fA-F]+);").replace(out) { m ->
            val radix = if (m.groupValues[1].isEmpty()) 10 else 16
            val code = m.groupValues[2].toIntOrNull(radix)
            if (code == null) m.value else String(Character.toChars(code))
        }
        return out
    }

    // ------------------------------------------------------- 매칭용 정규화

    /**
     * Test.py 의 `mnorm` — NFKC + 한글/영문만.
     * 주의: Test.py 는 HTML 태그를 제거하지 **않는다**(Matching.py 와 다른 점).
     */
    fun mnorm(text: String?): String = NON_MATCH.replace(nfkc(text), "")

    /** Matching.py 의 `mnorm` — 태그 제거까지 한다(card_list 값에 &lt;br&gt; 등이 섞여 있어서). */
    fun mnormHtml(text: String?): String = NON_MATCH.replace(nfkc(stripTags(text)), "")

    /** Scramble.py 의 `knorm` — 한국어 문제 문장 정규화. */
    fun knorm(text: String?): String = NON_KO.replace(nfkc(stripTags(text)), "")

    /** Scramble.py 의 `wnorm` — 영단어 정규화(구두점/대소문자 무시). */
    fun wnorm(word: String?): String = NON_WORD.replace(nfkc(word), "").lowercase()

    /** TestSentence.py 의 `norm_en` — 소문자 + 영숫자만. */
    fun normEn(token: String?): String =
        (token ?: "").lowercase().replace(Regex("[^a-z0-9]"), "")

    /** TestSentence.py 의 `normalize_kor` — NFKC + 모든 공백/제로폭 제거. */
    fun normalizeKor(text: String?): String = WS_ZERO_WIDTH.replace(nfkc(text), "")

    /** MemorizeSentence.py 의 `normalize_text` */
    fun normalizeText(text: String?): String {
        val n = nfkc(text)
        val stripped = Regex("[​‌‍‎‏﻿]").replace(n, "")
        return stripped.split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString("")
    }

    /** TestSentence.py / RecallSentence.py 의 `strip_parens` */
    fun stripParensSimple(text: String?): String =
        Regex("\\([^)]*\\)").replace(text ?: "", "")

    /** RecallSentence.py 의 `strip_parens` — 괄호 제거 후 공백 정리. */
    fun stripParens(text: String?): String {
        val removed = Regex("\\s*\\([^)]*\\)\\s*").replace(text ?: "", " ")
        return Regex("\\s+").replace(removed, " ").trim()
    }

    /** RecallSentence.py 의 `_UNICODE_NORMALIZE` / `normalize_unicode` */
    private val UNICODE_MAP = listOf(
        '‘' to "'", '’' to "'", '‚' to "'", '‛' to "'",
        '“' to "\"", '”' to "\"", '„' to "\"", '‟' to "\"",
        '–' to "-", '—' to "-", '−' to "-",
        '…' to "...",
    )

    fun normalizeUnicode(text: String): String {
        var out = text
        for ((from, to) in UNICODE_MAP) out = out.replace(from.toString(), to)
        return out
    }

    /** RecallSentence.py 의 `_wkey` — 유니코드 정규화 + 영숫자만 + 소문자. */
    fun wkey(token: String): String =
        Regex("[^a-z0-9]").replace(normalizeUnicode(token).lowercase(), "")

    /** Scramble.py 의 `_mnorm` — 따옴표/대시 통일 + 공백 제거 + 소문자(구두점은 유지). */
    fun scrambleNorm(s: String?): String {
        var out = nfkc(s)
        for ((from, to) in listOf(
            '’' to "'", '‘' to "'", '‚' to "'",
            '“' to "\"", '”' to "\"",
            '–' to "-", '—' to "-", '−' to "-",
        )) {
            out = out.replace(from.toString(), to)
        }
        return Regex("\\s+").replace(out, "").lowercase()
    }

    // ------------------------------------------------------- 토큰화

    /** RecallSentence.py 의 `tokenize` — 'in(to)' 처럼 단어 중간의 '(' 앞에서 분리. */
    fun tokenize(text: String): List<String> {
        val tokens = mutableListOf<String>()
        for (word in text.split(Regex("\\s+")).filter { it.isNotEmpty() }) {
            tokens.addAll(splitBeforeParen(word).filter { it.isNotEmpty() })
        }
        return tokens
    }

    /** 파이썬 `re.split(r'(?<=\S)(?=\()', word)` 대응 (코틀린 정규식 lookbehind 회피). */
    private fun splitBeforeParen(word: String): List<String> {
        val parts = mutableListOf<String>()
        var start = 0
        for (i in 1 until word.length) {
            if (word[i] == '(' && !word[i - 1].isWhitespace()) {
                parts.add(word.substring(start, i))
                start = i
            }
        }
        parts.add(word.substring(start))
        return parts
    }

    /** RecallSentence.py 의 `tokenize_loose` */
    fun tokenizeLoose(text: String): List<String> {
        val result = mutableListOf<String>()
        for (t in tokenize(text)) {
            for (piece in splitKeepingDelimiters(t, Regex("[-–—'\"]"))) {
                if (piece.isEmpty()) continue
                val m = Regex("^(.+?)([,.!?;:]+)$").find(piece)
                if (m != null && Regex("\\w").containsMatchIn(m.groupValues[1])) {
                    result.add(m.groupValues[1])
                    result.add(m.groupValues[2])
                } else {
                    result.add(piece)
                }
            }
        }
        return result
    }

    /** 파이썬 `re.split(r"(...)", s)` 처럼 구분자를 결과에 남기는 분리. */
    private fun splitKeepingDelimiters(text: String, delimiter: Regex): List<String> {
        val out = mutableListOf<String>()
        var last = 0
        for (m in delimiter.findAll(text)) {
            out.add(text.substring(last, m.range.first))
            out.add(m.value)
            last = m.range.last + 1
        }
        out.add(text.substring(last))
        return out
    }

    /**
     * MemorizeSentence.py / TestSentence.py 의 `parse_english_words`
     * — 괄호 묶음 `(...)` 은 통째로 한 토큰.
     */
    fun parseEnglishWords(sentence: String?): List<String> =
        Regex("\\([^)]*\\)|\\S+").findAll(sentence ?: "").map { it.value }.toList()

    /** RecallSentence.py 의 `is_prefix_punct_split` */
    fun isPrefixPunctSplit(prefixTokens: List<String>): Boolean =
        prefixTokens.any { Regex("[,.!?;:\\-–—'\"]+").matches(it) }

    /** RecallSentence.py 의 `click_remaining_tokens` 내 "단독 구두점" 판별. */
    fun isPunctOnly(token: String): Boolean =
        Regex("[,.!?;:\\-–—'\"]+").matches(token)

    /** Scramble.py 의 `split_target_words` — 단어 끝 문장부호를 항상 별도 토큰으로. */
    fun splitTargetWords(target: String?): List<String> {
        val words = mutableListOf<String>()
        for (w in (target ?: "").split(Regex("\\s+")).filter { it.isNotEmpty() }) {
            val m = Regex("^(.+?)([^\\w]+)$").find(w)
            if (m != null) {
                words.add(m.groupValues[1])
                words.add(m.groupValues[2])
            } else {
                words.add(w)
            }
        }
        return words
    }

    /** Scramble.py 의 순수 문장부호 판별 `re.fullmatch(r'[^\w]+', tok)` */
    fun isNonWordOnly(token: String): Boolean = Regex("[^\\w]+").matches(token)

    /** TestSentence.py 의 `_split_subtokens` */
    fun splitSubtokens(token: String): List<String> {
        if (token.contains('(') && token.contains(')')) {
            val subs = mutableListOf<String>()
            for (part in splitKeepingDelimiters(token, Regex("\\([^)]*\\)"))) {
                val cleaned = part.trim('(', ')')
                subs.addAll(cleaned.split(Regex("\\s+")).filter { it.isNotEmpty() })
            }
            return subs
        }
        if (Regex("[-–—]").containsMatchIn(token)) {
            return token.split(Regex("[-–—]")).filter { it.isNotEmpty() }
        }
        return emptyList()
    }

    /** MemorizeSentence.py 의 하이픈 분리 폴백용. */
    fun splitByDash(token: String): List<String> =
        splitKeepingDelimiters(token, Regex("[-–—]")).filter { it.isNotEmpty() }

    /** MemorizeSentence.py 의 괄호 분리 폴백용. */
    fun splitByParenGroup(token: String): List<String> =
        splitKeepingDelimiters(token, Regex("\\([^)]*\\)")).filter { it.isNotEmpty() }

    /** 공백 전부 제거 (`''.join(text.split())`). */
    fun squeeze(text: String): String =
        text.split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString("")
}
