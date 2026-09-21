package com.classcard.automation

import com.classcard.automation.core.Norm
import com.classcard.automation.core.Similarity
import com.classcard.automation.modules.AnswerDict
import com.classcard.automation.modules.Matching
import com.classcard.automation.modules.RecallSentence
import com.classcard.automation.modules.Scramble
import com.classcard.automation.modules.Spell
import com.classcard.automation.modules.Test
import com.classcard.automation.modules.TestSentence
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test as JUnitTest

/**
 * 이식 정확성 회귀 테스트.
 *
 * `reference.json` 은 **원본 파이썬 구현을 그대로 실행해서** 만든 기준값이다
 * (생성기: android/tools/gen_reference.py). 여기서는 같은 입력을 코틀린 이식본에 넣어
 * 출력이 한 글자도 다르지 않은지 확인한다.
 */
class PortParityTest {

    private val ref: JSONObject by lazy {
        val stream = javaClass.classLoader!!.getResourceAsStream("reference.json")!!
        JSONObject(stream.bufferedReader().use { it.readText() })
    }

    private fun pairs(key: String): List<Pair<String, String>> {
        val arr = ref.getJSONArray(key)
        return (0 until arr.length()).map {
            val row = arr.getJSONArray(it)
            row.getString(0) to row.getString(1)
        }
    }

    private fun JSONArray.toStringList(): List<String> =
        (0 until length()).map { getString(it) }

    // ------------------------------------------------------------ 정규화

    @JUnitTest
    fun mnorm_keepsHtmlTags_likeTestPy() {
        for ((input, expected) in pairs("mnorm")) {
            assertEquals("mnorm('$input')", expected, Norm.mnorm(input))
        }
    }

    @JUnitTest
    fun mnormHtml_stripsHtmlTags_likeMatchingPy() {
        for ((input, expected) in pairs("matching_mnorm")) {
            assertEquals("mnormHtml('$input')", expected, Norm.mnormHtml(input))
        }
    }

    @JUnitTest
    fun normalizers_matchPython() {
        for ((i, e) in pairs("knorm")) assertEquals("knorm('$i')", e, Norm.knorm(i))
        for ((i, e) in pairs("wnorm")) assertEquals("wnorm('$i')", e, Norm.wnorm(i))
        for ((i, e) in pairs("norm_en")) assertEquals("normEn('$i')", e, Norm.normEn(i))
        for ((i, e) in pairs("normalize_kor")) assertEquals("normalizeKor('$i')", e, Norm.normalizeKor(i))
        for ((i, e) in pairs("normalize_text")) assertEquals("normalizeText('$i')", e, Norm.normalizeText(i))
    }

    @JUnitTest
    fun stripParensAndUnicode_matchPython() {
        for ((i, e) in pairs("strip_parens_simple")) {
            assertEquals("stripParensSimple('$i')", e, Norm.stripParensSimple(i))
        }
        for ((i, e) in pairs("strip_parens")) assertEquals("stripParens('$i')", e, Norm.stripParens(i))
        for ((i, e) in pairs("normalize_unicode")) {
            assertEquals("normalizeUnicode('$i')", e, Norm.normalizeUnicode(i))
        }
        for ((i, e) in pairs("wkey")) assertEquals("wkey('$i')", e, Norm.wkey(i))
        for ((i, e) in pairs("scramble_mnorm")) assertEquals("scrambleNorm('$i')", e, Norm.scrambleNorm(i))
    }

    // ------------------------------------------------------------ 토큰화

    @JUnitTest
    fun tokenizers_matchPython() {
        fun check(key: String, fn: (String) -> List<String>) {
            val arr = ref.getJSONArray(key)
            for (i in 0 until arr.length()) {
                val row = arr.getJSONArray(i)
                val input = row.getString(0)
                val expected = row.getJSONArray(1).toStringList()
                assertEquals("$key('$input')", expected, fn(input))
            }
        }
        check("tokenize", Norm::tokenize)
        check("tokenize_loose", Norm::tokenizeLoose)
        check("parse_english_words") { Norm.parseEnglishWords(it) }
        check("split_target_words") { Norm.splitTargetWords(it) }
        check("split_subtokens", Norm::splitSubtokens)
    }

    // ------------------------------------------------------------ difflib

    @JUnitTest
    fun ratio_matchesDifflib() {
        val arr = ref.getJSONArray("ratio")
        for (i in 0 until arr.length()) {
            val row = arr.getJSONArray(i)
            val a = row.getString(0)
            val b = row.getString(1)
            val expected = row.getDouble(2)
            assertEquals("ratio('$a','$b')", expected, Similarity.ratio(a, b), 1e-12)
        }
    }

    // ------------------------------------------------------------ 스크램블

    @JUnitTest
    fun scramble_alignAndNextWord_matchPython() {
        val arr = ref.getJSONArray("scramble")
        for (i in 0 until arr.length()) {
            val c = arr.getJSONObject(i)
            val target = c.getString("target")
            val placed = c.getJSONArray("placed").toStringList()
            val cands = c.getJSONArray("cands").toStringList()

            val words = Norm.splitTargetWords(target)
            assertEquals("splitTargetWords('$target')", c.getJSONArray("words").toStringList(), words)

            val expectedAlign = if (c.isNull("align")) null else c.getInt("align")
            assertEquals("alignIndex('$target')", expectedAlign, Scramble.alignIndex(words, placed))

            val (idx, need) = Scramble.findNextIndex(words, placed, cands)
            val expectedIdx = if (c.isNull("idx")) null else c.getInt("idx")
            val expectedNeed = if (c.isNull("need")) null else c.getString("need")
            assertEquals("findNextIndex idx ('$target')", expectedIdx, idx)
            assertEquals("findNextIndex need ('$target')", expectedNeed, need)
        }
    }

    // ------------------------------------------------------------ 문장 리콜

    private val sentences = listOf(
        "I can live without it.",
        "I can live with it.",
        "She went to the park yesterday.",
        "He is a well-known writer.",
    )

    @JUnitTest
    fun recallSentence_matching_matchesPython() {
        val arr = ref.getJSONArray("recall_matching")
        for (i in 0 until arr.length()) {
            val c = arr.getJSONObject(i)
            val prefix = c.getJSONArray("prefix").toStringList()

            assertEquals(
                "findMatchingSentences($prefix)",
                c.getJSONArray("matches").toStringList(),
                RecallSentence.findMatchingSentences(prefix, sentences, Norm::tokenize),
            )

            val expectedSubseq = c.getJSONArray("subseq")
            sentences.forEachIndexed { si, s ->
                assertEquals(
                    "findSubsequenceEnd($prefix, '$s')",
                    expectedSubseq.getInt(si),
                    RecallSentence.findSubsequenceEnd(prefix, Norm.tokenize(s)),
                )
            }

            assertEquals(
                "isPrefixPunctSplit($prefix)",
                c.getBoolean("punct_split"),
                Norm.isPrefixPunctSplit(prefix),
            )
        }
    }

    @JUnitTest
    fun recallSentence_findByCandidates_matchesPython() {
        val arr = ref.getJSONArray("recall_by_candidates")
        for (i in 0 until arr.length()) {
            val c = arr.getJSONObject(i)
            val cands = c.getJSONArray("cands").toStringList()
            val actual = RecallSentence.findSentenceByCandidates(cands, sentences, Norm::tokenize)
            if (c.isNull("result")) {
                assertNull("findSentenceByCandidates($cands)", actual)
            } else {
                assertEquals("findSentenceByCandidates($cands)", c.getString("result"), actual)
            }
        }
    }

    // ------------------------------------------------------------ 스펠 / 문장 테스트

    @JUnitTest
    fun spell_findAnswer_matchesPython() {
        val dict = AnswerDict().apply {
            put("사과", "apple")
            put("달리다", "run")
            put("1. 켜다 2. 자극하다", "turn on")
        }
        val arr = ref.getJSONArray("spell_find_answer")
        for (i in 0 until arr.length()) {
            val row = arr.getJSONArray(i)
            val prompt = row.getString(0)
            val actual = Spell.findAnswer(dict, prompt)
            if (row.isNull(1)) assertNull("findAnswer('$prompt')", actual)
            else assertEquals("findAnswer('$prompt')", row.getString(1), actual)
        }
    }

    @JUnitTest
    fun testSentence_matchEnglish_matchesPython() {
        val dict = AnswerDict().apply {
            put("나는 그것 없이 살 수 있다.", "I can live without it.")
            put("그녀는 (어제) 공원에 갔다.", "She went to the park yesterday.")
        }
        val maps = TestSentence.buildMaps(null, dict)
        val arr = ref.getJSONArray("test_sentence_match")
        for (i in 0 until arr.length()) {
            val row = arr.getJSONArray(i)
            val prompt = row.getString(0)
            val actual = TestSentence.matchEnglish(prompt, maps)
            if (row.isNull(1)) assertNull("matchEnglish('$prompt')", actual)
            else assertEquals("matchEnglish('$prompt')", row.getString(1), actual)
        }
    }

    // ------------------------------------------------------------ 단어 테스트 / 매칭

    @JUnitTest
    fun test_solve_matchesPython() {
        val dict = AnswerDict().apply {
            put("사과", "apple")
            put("달리다", "run")
            put("1. 끌어서 떼어내다, 제거하다", "pull off")
        }
        val lk = Test.buildLookups(null, dict)!!

        val arr = ref.getJSONArray("test_solve")
        for (i in 0 until arr.length()) {
            val c = arr.getJSONObject(i)
            val prompt = c.getString("prompt")
            val optionsArr = c.getJSONArray("options")
            val options = (0 until optionsArr.length()).map { oi ->
                val o = optionsArr.getJSONArray(oi)
                val raw = o.getString(1)
                Test.Option(o.getInt(0), raw, Norm.mnorm(raw))
            }
            val (num, answer) = Test.solve(prompt, options, lk)

            if (c.isNull("num")) assertNull("solve('$prompt') num", num)
            else assertEquals("solve('$prompt') num", c.getInt("num"), num)

            if (c.isNull("answer")) assertNull("solve('$prompt') answer", answer)
            else assertEquals("solve('$prompt') answer", c.getString("answer"), answer)
        }
    }

    @JUnitTest
    fun matching_findPair_matchesPython() {
        val cards = listOf(
            "apple" to "사과",
            "run" to "달리다",
            "pull off" to "1. 끌어서 떼어내다, 제거하다",
        )
        val fwd = HashMap<String, String>()
        val bwd = HashMap<String, String>()
        for ((front, back) in cards) {
            fwd[Norm.mnormHtml(front)] = back
            bwd[Norm.mnormHtml(back)] = front
        }
        val lk = Test.Lookups(fwd, bwd)

        val expected = ref.getJSONObject("matching_pair")
        val lefts = expected.getJSONArray("left").toStringList()
            .mapIndexed { i, t -> Matching.BoardCard(i, t, Norm.mnormHtml(t)) }
        val rights = expected.getJSONArray("right").toStringList()
            .mapIndexed { i, t -> Matching.BoardCard(i, t, Norm.mnormHtml(t)) }

        val pair = Matching.findPair(lefts, rights, lk)!!
        assertEquals("li", expected.getInt("li"), pair.li)
        assertEquals("ri", expected.getInt("ri"), pair.ri)
        assertEquals("lraw", expected.getString("lraw"), pair.lraw)
        assertEquals("rraw", expected.getString("rraw"), pair.rraw)
    }

    // ------------------------------------------------------------ 오답 주입 개수

    @JUnitTest
    fun planWrongIndices_matchesPythonAndGuaranteesTargetScore() {
        val arr = ref.getJSONArray("plan_wrong_counts")
        for (i in 0 until arr.length()) {
            val row = arr.getJSONArray(i)
            val total = row.getInt(0)
            val target = row.getInt(1)
            val expectedCount = row.getInt(2)

            val planned = Test.planWrongIndices(total, target)
            assertEquals("planWrongIndices($total, $target) 개수", expectedCount, planned.size)

            // 순번은 1..total 범위 안이어야 하고 중복이 없어야 한다.
            planned.forEach { idx ->
                assert(idx in 1..total) { "순번 $idx 이 1..$total 범위를 벗어남" }
            }

            // 내림 계산이므로 실제 점수는 항상 목표 이상이 된다.
            if (total > 0) {
                val score = (total - planned.size) * 100.0 / total
                assert(score >= target) { "총 $total 문항에서 점수 $score 가 목표 $target 미만" }
            }
        }
    }
}
