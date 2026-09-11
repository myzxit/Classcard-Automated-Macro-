package com.classcard.automation

import com.classcard.automation.modules.Grammar
import com.classcard.automation.modules.Test as TestModule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test as JUnitTest

/**
 * 문법 모듈의 순수 로직 검증.
 *
 * 문법훈련은 이식할 원본 파이썬이 없어 reference.json 기준값이 없다. 대신
 * "정답을 알 때 / 모를 때 / 이미 틀린 보기가 있을 때" 어떤 보기를 고르는지를 고정한다.
 * 확장프로그램판(extension/test/grammar.test.mjs)에 같은 표를 두어 두 이식본이
 * 같은 판단을 하는지 함께 확인한다.
 */
class GrammarLogicTest {

    private fun choices(vararg texts: String): List<Grammar.Choice> =
        texts.mapIndexed { i, t -> Grammar.Choice(i, t) }

    @JUnitTest
    fun pickExactAnswer() {
        val c = choices("has been", "have been", "had being", "is been")
        assertEquals(1, Grammar.pickChoice(c, "have been", emptySet()))
    }

    @JUnitTest
    fun pickIgnoresCaseAndSpacing() {
        val c = choices("Has Been", "have  been", "had being")
        assertEquals(1, Grammar.pickChoice(c, "HAVE BEEN", emptySet()))
    }

    @JUnitTest
    fun pickPartialAnswer() {
        // 정답 문장이 길고 보기는 그 일부인 경우
        val c = choices("in", "on", "at")
        assertEquals(2, Grammar.pickChoice(c, "at night", emptySet()))
    }

    @JUnitTest
    fun pickFirstWhenAnswerUnknown() {
        val c = choices("a", "b", "c")
        assertEquals(0, Grammar.pickChoice(c, null, emptySet()))
    }

    @JUnitTest
    fun pickSkipsKnownWrong() {
        val c = choices("a", "b", "c")
        assertEquals(1, Grammar.pickChoice(c, null, setOf(0)))
        assertEquals(2, Grammar.pickChoice(c, null, setOf(0, 1)))
    }

    @JUnitTest
    fun pickResetsWhenEveryChoiceMarkedWrong() {
        val c = choices("a", "b")
        assertEquals(0, Grammar.pickChoice(c, null, setOf(0, 1)))
    }

    @JUnitTest
    fun pickPrefersOpenChoiceOverWrongAnswer() {
        // 단어장이 가리키는 보기가 이미 오답으로 확인됐다면 그건 고르지 않는다.
        val c = choices("a", "b", "c")
        assertEquals(0, Grammar.pickChoice(c, "c", setOf(2)))
    }

    @JUnitTest
    fun pickNullWhenNoChoices() {
        assertNull(Grammar.pickChoice(emptyList(), "a", emptySet()))
    }

    @JUnitTest
    fun lookupAnswerBothDirections() {
        val dict = com.classcard.automation.modules.AnswerDict()
        dict["그는 학교에 갔다"] = "He went to school"
        val lk = TestModule.buildLookups(null, dict)

        assertEquals("He went to school", Grammar.lookupAnswer("그는 학교에 갔다", lk))
        assertEquals("그는 학교에 갔다", Grammar.lookupAnswer("He went to school", lk))
    }

    @JUnitTest
    fun lookupAnswerBySubstring() {
        val dict = com.classcard.automation.modules.AnswerDict()
        dict["나는 배가 고프다"] = "I am hungry"
        val lk = TestModule.buildLookups(null, dict)

        // 지문에 군더더기가 붙어도 포함 관계로 찾아낸다.
        assertEquals("나는 배가 고프다", Grammar.lookupAnswer("빈칸에 알맞은 것은? I am hungry", lk))
    }

    @JUnitTest
    fun lookupAnswerMissReturnsNull() {
        val dict = com.classcard.automation.modules.AnswerDict()
        dict["사과"] = "apple"
        val lk = TestModule.buildLookups(null, dict)

        assertNull(Grammar.lookupAnswer("전혀 다른 문장", lk))
        assertNull(Grammar.lookupAnswer("사과", null))
    }

    // ================================================ 클래스 페이지

    private fun unit(
        i: Int, name: String, stages: List<Grammar.Stage>,
        locked: Boolean = false, hasTitle: Boolean = true,
    ) = Grammar.UnitRow(i, name, locked, hasTitle, stages)

    private fun stage(key: String, title: String, locked: Boolean = false) =
        Grammar.Stage(key, title, locked)

    @JUnitTest
    fun classPicksFirstStageInOrder() {
        val units = listOf(
            unit(
                0, "강조구문",
                listOf(
                    stage("0_1", "연습 문제 A"),
                    stage("0_0", "개념 톡"),
                    stage("0_2", "연습 문제 B", locked = true),
                ),
            )
        )
        val act = Grammar.nextClassAction(units, emptySet())
        assertTrue(act is Grammar.ClassAction.Start)
        assertEquals("개념 톡", (act as Grammar.ClassAction.Start).stage.title)
    }

    @JUnitTest
    fun classSkipsTriedStages() {
        val units = listOf(
            unit(0, "강조구문", listOf(stage("0_0", "개념 톡"), stage("0_1", "연습 문제 A")))
        )
        val act = Grammar.nextClassAction(units, setOf("0_0")) as Grammar.ClassAction.Start
        assertEquals("연습 문제 A", act.stage.title)
    }

    @JUnitTest
    fun classSkipsLockedUnit() {
        val units = listOf(
            unit(0, "잠긴 유닛", listOf(stage("0_0", "개념 톡")), locked = true),
            unit(1, "열린 유닛", listOf(stage("1_0", "실전 문제"))),
        )
        val act = Grammar.nextClassAction(units, emptySet()) as Grammar.ClassAction.Start
        assertEquals("열린 유닛", act.unit.name)
        assertEquals("실전 문제", act.stage.title)
    }

    @JUnitTest
    fun classOpensCollapsedUnitFirst() {
        val act = Grammar.nextClassAction(listOf(unit(0, "접힌 유닛", emptyList())), emptySet())
        assertTrue(act is Grammar.ClassAction.Open)
        assertEquals(0, (act as Grammar.ClassAction.Open).unit.i)
    }

    @JUnitTest
    fun classReturnsNoneWhenNothingLeft() {
        val units = listOf(unit(0, "끝난 유닛", listOf(stage("0_0", "개념 톡"))))
        assertTrue(Grammar.nextClassAction(units, setOf("0_0")) is Grammar.ClassAction.None)
        assertTrue(Grammar.nextClassAction(emptyList(), emptySet()) is Grammar.ClassAction.None)
    }

    @JUnitTest
    fun classPutsUnknownStageNamesLast() {
        val units = listOf(
            unit(0, "u", listOf(stage("0_0", "알 수 없는 단계"), stage("0_1", "서술형 문제")))
        )
        val act = Grammar.nextClassAction(units, emptySet()) as Grammar.ClassAction.Start
        assertEquals("서술형 문제", act.stage.title)
    }

    // ================================================ 어순 배열

    private fun tile(i: Int, text: String, used: Boolean = false) = Grammar.Tile(i, text, used)

    @JUnitTest
    fun scramblePicksWordsInAnswerOrder() {
        val tiles = listOf(tile(0, "nice"), tile(1, "You"), tile(2, "look"))
        assertEquals(1, Grammar.nextScrambleIndex("You look nice", tiles, emptyList()))
        assertEquals(2, Grammar.nextScrambleIndex("You look nice", tiles, listOf("you")))
        assertEquals(0, Grammar.nextScrambleIndex("You look nice", tiles, listOf("you", "look")))
    }

    @JUnitTest
    fun scrambleKeepsGoingWhenTileNumbersChange() {
        // 사이트는 낱말을 놓을 때마다 남은 타일을 다시 늘어놓아 번호가 0부터 다시 매겨진다
        val left = listOf(tile(0, "nice"), tile(1, "look"))
        assertEquals(1, Grammar.nextScrambleIndex("You look nice", left, listOf("you")))
        assertEquals(0, Grammar.nextScrambleIndex("You look nice", listOf(tile(0, "nice")), listOf("you", "look")))
    }

    @JUnitTest
    fun scrambleHandlesRepeatedWords() {
        val tiles = listOf(tile(0, "the"), tile(1, "the"), tile(2, "end"))
        assertEquals(0, Grammar.nextScrambleIndex("the the end", tiles, emptyList()))
        assertEquals(0, Grammar.nextScrambleIndex("the the end", listOf(tile(0, "the"), tile(1, "end")), listOf("the")))
        assertEquals(0, Grammar.nextScrambleIndex("the the end", listOf(tile(0, "end")), listOf("the", "the")))
    }

    @JUnitTest
    fun scrambleReturnsNullWhenSentenceComplete() {
        val tiles = listOf(tile(0, "You"), tile(1, "win"))
        assertNull(Grammar.nextScrambleIndex("You win", tiles, listOf("you", "win")))
    }

    @JUnitTest
    fun scrambleMatchesTileWithPunctuation() {
        val tiles = listOf(tile(0, "today."), tile(1, "It"))
        assertEquals(1, Grammar.nextScrambleIndex("It is today.", tiles, emptyList()))
    }

    @JUnitTest
    fun scrambleFallsBackWhenAnswerUnknown() {
        val tiles = listOf(tile(0, "a", used = true), tile(1, "b"), tile(2, "c"))
        assertEquals(1, Grammar.nextScrambleIndex(null, tiles, emptyList()))
        assertEquals(2, Grammar.nextScrambleIndex(null, tiles, listOf("1")))   // 정답을 모를 땐 번호로 기억한다
        assertNull(Grammar.nextScrambleIndex(null, listOf(tile(0, "a", used = true)), emptyList()))
    }

    // ================================================ 사이트 정답을 빈칸 단위로 나누기

    @JUnitTest
    fun splitBlanksSplitsByBlankAndKeepsFirstAlternative() {
        assertEquals(listOf("do", "love"), Grammar.splitBlanks("do;love"))
        assertEquals(
            listOf("It", "was", "a", "puppy", "that"),
            Grammar.splitBlanks("It;was;a;puppy;that|which"),
        )
        assertEquals(listOf("does look"), Grammar.splitBlanks("does look"))
        assertEquals(emptyList<String>(), Grammar.splitBlanks(""))
    }

    @JUnitTest
    fun fillValuesUsesSiteAnswerPerBlank() {
        assertEquals(
            listOf("It", "was", "a", "puppy", "that"),
            Grammar.fillValues(5, "It;was;a;puppy;that|which", ""),
        )
        assertEquals(listOf("do", "love"), Grammar.fillValues(2, "do;love", ""))
        assertEquals(
            listOf("It was a teacher that Jason became."),
            Grammar.fillValues(1, "It was a teacher that Jason became.|It was Jason that became a teacher.", ""),
        )
    }

    // ================================================ 정답이 여러 개인 객관식 (실전 문제)

    private fun opt(i: Int, raw: String, on: Boolean = false, ans: String = "") =
        Grammar.Choice(i, raw, ans, on)

    @JUnitTest
    fun splitPicksCountsEveryRequiredOption() {
        assertEquals(
            listOf("I do love it.", "She does look nice."),
            Grammar.splitPicks("I do love it.|She does look nice."),
        )
        assertEquals(listOf("that"), Grammar.splitPicks("that"))
        assertEquals(emptyList<String>(), Grammar.splitPicks(""))
    }

    @JUnitTest
    fun picksEveryAnswerOneByOne() {
        val wanted = listOf("was", "were")
        assertEquals(0, Grammar.nextPickIndex(listOf(opt(0, "was"), opt(1, "were"), opt(2, "is")), wanted))
        assertEquals(1, Grammar.nextPickIndex(listOf(opt(0, "was", true), opt(1, "were"), opt(2, "is")), wanted))
        assertNull(Grammar.nextPickIndex(listOf(opt(0, "was", true), opt(1, "were", true), opt(2, "is")), wanted))
    }

    @JUnitTest
    fun picksByGradingTextToo() {
        val a = listOf(opt(0, "① 보기 하나", false, "was"), opt(1, "② 보기 둘", false, "were"))
        assertEquals(1, Grammar.nextPickIndex(a, listOf("were")))
    }

    @JUnitTest
    fun picksNullWhenAnswerNotOnScreen() {
        assertNull(Grammar.nextPickIndex(listOf(opt(0, "is"), opt(1, "are")), listOf("was", "were")))
    }

    // ================================================ 짝맞추기

    private fun cell(i: Int, text: String, done: Boolean = false) = Grammar.MatchCell(i, text, done)

    @JUnitTest
    fun matchTriesOpenCells() {
        val l = listOf(cell(0, "A"), cell(1, "B"))
        val r = listOf(cell(0, "가"), cell(1, "나"))
        assertEquals(0 to 0, Grammar.nextPairAttempt(l, r, emptySet()))
        assertEquals(0 to 1, Grammar.nextPairAttempt(l, r, setOf("0_0")))
    }

    @JUnitTest
    fun matchSkipsFinishedCells() {
        val l = listOf(cell(0, "A", done = true), cell(1, "B"))
        val r = listOf(cell(0, "가", done = true), cell(1, "나"))
        assertEquals(1 to 1, Grammar.nextPairAttempt(l, r, emptySet()))
        assertNull(Grammar.nextPairAttempt(l, r, setOf("1_1")))
    }

    @JUnitTest
    fun matchUsesPairIndexWhenPresent() {
        // 사이트 기준: 같은 줄의 왼쪽·오른쪽 data-idx 가 같으면 정답 (gclass_test.js 16)
        val l = listOf(Grammar.MatchCell(0, "A", false, "2"), Grammar.MatchCell(1, "B", false, "0"))
        val r = listOf(Grammar.MatchCell(0, "가", false, "0"), Grammar.MatchCell(1, "나", false, "2"))
        assertEquals(0 to 1, Grammar.nextPairAttempt(l, r, emptySet()))
    }

    @JUnitTest
    fun matchWithPairIndexSkipsFinished() {
        val l = listOf(Grammar.MatchCell(0, "A", true, "2"), Grammar.MatchCell(1, "B", false, "0"))
        val r = listOf(Grammar.MatchCell(0, "가", false, "0"), Grammar.MatchCell(1, "나", true, "2"))
        assertEquals(1 to 0, Grammar.nextPairAttempt(l, r, emptySet()))
    }

    // ================================================ 분류형

    private fun row(i: Int, text: String, opts: List<String>, done: Boolean = false) =
        Grammar.Row(i, text, done, opts.mapIndexed { j, t -> Grammar.RowOption(j, t) })

    @JUnitTest
    fun groupPicksFirstUnansweredRow() {
        val rows = listOf(
            row(0, "apple", listOf("셀 수 있음", "셀 수 없음"), done = true),
            row(1, "water", listOf("셀 수 있음", "셀 수 없음")),
        )
        assertEquals(1 to 0, Grammar.nextGroupPick(rows, null, emptyMap()))
    }

    @JUnitTest
    fun groupSkipsWrongOptionInThatRow() {
        val rows = listOf(row(0, "water", listOf("셀 수 있음", "셀 수 없음")))
        assertEquals(0 to 1, Grammar.nextGroupPick(rows, null, mapOf(0 to setOf(0))))
    }

    @JUnitTest
    fun groupUsesAnswerHint() {
        val rows = listOf(row(0, "water", listOf("셀 수 있음", "셀 수 없음")))
        assertEquals(
            0 to 1,
            Grammar.nextGroupPick(rows, "water 셀 수 없음, apple 셀 수 있음", emptyMap()),
        )
    }

    @JUnitTest
    fun groupReturnsNullWhenAllRowsDone() {
        val rows = listOf(row(0, "a", listOf("x", "y"), done = true))
        assertNull(Grammar.nextGroupPick(rows, null, emptyMap()))
    }

    @JUnitTest
    fun groupUsesRowKeyWhenPresent() {
        // 사이트 기준: data-key 와 고른 라디오 value 가 같으면 정답 (gclass_test.js 17)
        val rows = listOf(
            Grammar.Row(
                0, "water", false,
                listOf(Grammar.RowOption(0, "셀 수 있음", "0"), Grammar.RowOption(1, "셀 수 없음", "1")),
                key = "1",
            )
        )
        // 정답 문장이 반대로 말해도, 사이트가 쓰는 값이 이긴다
        assertEquals(0 to 1, Grammar.nextGroupPick(rows, "water 셀 수 있음", emptyMap()))
    }

    // ================================================ 빈칸 채우기

    @JUnitTest
    fun fillSingleBlankWithWholeAnswer() {
        assertEquals(
            listOf("It was the man that stole my bag."),
            Grammar.fillValues(1, "It was the man that stole my bag.", ""),
        )
    }

    @JUnitTest
    fun fillSplitsAnswerAcrossBlanks() {
        assertEquals(listOf("It", "is", "Paul"), Grammar.fillValues(3, "It is Paul", ""))
    }

    @JUnitTest
    fun fillPutsExtraWordsInLastBlank() {
        assertEquals(listOf("It", "is Paul who"), Grammar.fillValues(2, "It is Paul who", ""))
    }

    @JUnitTest
    fun fillUsesHintWordsWhenAnswerUnknown() {
        assertEquals(
            listOf("the", "tallest", "student"),
            Grammar.fillValues(3, null, "the, tallest, student, is, who, Paul"),
        )
    }

    @JUnitTest
    fun fillLeavesRestEmptyWhenHintTooShort() {
        assertEquals(listOf("a", "b", ""), Grammar.fillValues(3, null, "a, b"))
    }

    @JUnitTest
    fun fillReturnsEmptyWithoutAnswerOrHint() {
        assertEquals(emptyList<String>(), Grammar.fillValues(2, null, ""))
        assertEquals(emptyList<String>(), Grammar.fillValues(0, "x", "y"))
    }

    // ================================================ 개념 톡 정답 고르기
    // 실제 개념 톡('강조구문' 유닛)에 나온 문구를 그대로 쓴다.

    @JUnitTest
    fun talkFindsAnswerWordInNextCard() {
        val c = choices("인칭", "동사", "부사구", "동사원형", "주어", "목적어")
        val 해설 = "이때는 '정말 ~하다'라고 해석해서 동사의 뜻을 강조해 줘요."
        assertEquals(1, Grammar.pickTalkAnswer(c, 해설))
    }

    @JUnitTest
    fun talkPicksChoiceQuotedByExplanation() {
        val c = choices(
            "1 나는 정말 많은 고기를 먹었다.",
            "2 나는 시금치를 정말 싫어한다.",
            "3 나는 엄청 느리게 달린다.",
        )
        val 해설 = "'정말'이라는 말을 붙여서 '싫어한다'는 동사의 의미를 강조하고 있어요."
        assertEquals(1, Grammar.pickTalkAnswer(c, 해설))
    }

    @JUnitTest
    fun talkIgnoresTokensCommonToEveryChoice() {
        val c = choices("나는 정말 먹었다.", "나는 정말 싫어한다.", "나는 정말 달린다.")
        assertNull(Grammar.pickTalkAnswer(c, "'정말'이라는 말이 붙었어요."))
    }

    @JUnitTest
    fun talkReturnsNullWithoutClue() {
        val c = choices("인칭", "동사", "부사구")
        assertNull(Grammar.pickTalkAnswer(c, "잘 하셨어요! 이제 끝입니다."))
        assertNull(Grammar.pickTalkAnswer(c, ""))
        assertNull(Grammar.pickTalkAnswer(emptyList(), "동사"))
    }

    // ================================================ 페이지 정답 찾기 스크립트

    @JUnitTest
    fun findAnswerScriptCarriesOptionsAndBlankIndex() {
        // 실제 실행은 브라우저에서 하지만, 보기와 빈칸 번호가 스크립트에 제대로 박히는지 확인한다.
        val js = Grammar.findAnswerJsForTest(listOf("1동사원형", "4인칭"), 1)
        assertTrue(js.contains("\"1동사원형\""))
        assertTrue(js.contains("\"4인칭\""))
        assertTrue(js.contains("var CNT = 1;"))
        assertTrue(js.contains("__OPTIONS__").not())
        assertTrue(js.contains("__CNT__").not())
    }

    // ================================================ 사이트 정답으로 고르기
    // 실제 소스 확인 결과, 정답은 arr_answer/arr_card 에 ';' 또는 '|' 로 묶여 온다.

    @JUnitTest
    fun splitsAnswerString() {
        assertEquals(listOf("동사", "인칭"), Grammar.splitAnswers("동사;인칭"))
        assertEquals(listOf("who", "that"), Grammar.splitAnswers("who|that"))
        assertEquals(listOf("do does"), Grammar.splitAnswers("do / does"))
        assertEquals(emptyList<String>(), Grammar.splitAnswers(""))
    }

    @JUnitTest
    fun picksExactChoiceFirst() {
        // '동사' 가 정답인데 '동사원형' 을 고르면 안 된다
        val c = choices("1동사원형", "2부사구", "3동사", "4인칭")
        assertEquals(2, Grammar.pickByAnswers(c, listOf("동사"), emptySet()))
        assertEquals(0, Grammar.pickByAnswers(c, listOf("동사원형"), emptySet()))
    }

    @JUnitTest
    fun picksByContainmentWhenNoExact() {
        val c = choices("in", "on", "at")
        assertEquals(2, Grammar.pickByAnswers(c, listOf("at night"), emptySet()))
    }

    @JUnitTest
    fun skipsAlreadyWrongChoices() {
        val c = choices("who", "that")
        assertNull(Grammar.pickByAnswers(c, listOf("who"), setOf(0)))
        assertEquals(1, Grammar.pickByAnswers(c, listOf("who", "that"), setOf(0)))
    }

    @JUnitTest
    fun returnsNullWhenNoChoiceMatches() {
        val c = choices("a", "b")
        assertNull(Grammar.pickByAnswers(c, listOf("zzz"), emptySet()))
        assertNull(Grammar.pickByAnswers(c, emptyList(), emptySet()))
    }
}
