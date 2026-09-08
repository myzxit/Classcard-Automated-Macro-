package com.classcard.automation

import com.classcard.automation.modules.Grammar
import com.classcard.automation.modules.Test as TestModule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
}
