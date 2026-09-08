package com.classcard.automation.modules

import com.classcard.automation.core.Driver
import com.classcard.automation.core.StopFlag
import com.classcard.automation.core.jsStr

/** 전체/한세트 자동화의 시그니처. 파이썬 `run_*_loop(driver, stop_event)` 대응. */
typealias FlowFn = suspend (Driver, StopFlag) -> Unit

/** AutoAll.py 이식 — 단어장 전체 자동화 / 한 세트 자동화. */
object AutoAll {

    private const val SET_ITEM_SELECTOR = ".set-item"
    private const val SET_NAME_LINK_SELECTOR = ".set-item a.set-name-a"
    private const val MEMORIZE_BTN_SELECTOR = ".btn-summary[onclick*=\"/Memorize/\"]"
    private const val RECALL_BTN_SELECTOR = ".btn-summary[onclick*=\"/Recall/\"]"
    private const val MATCH_BTN_SELECTOR = ".btn-summary[onclick*=\"/Match/\"]"
    private const val SPELL_BTN_SELECTOR = ".btn-summary[onclick*=\"/Spell/\"]"
    private const val TEST_BTN_SELECTOR = ".btn-start-speedquiz"

    /**
     * 문법훈련 버튼. 실제 마크업을 확인하지 못해 후보를 여러 개 둔다.
     * 셋홈에 이 버튼이 없으면(=문법이 없는 set) 그 단계는 통째로 건너뛴다.
     */
    private const val GRAMMAR_BTN_SELECTOR =
        ".btn-summary[onclick*=\"/Grammar\"], .btn-summary[onclick*=\"/Syntax\"], " +
            ".btn-summary[onclick*=\"grammar\"], .btn-start-grammar"

    /** 단어 테스트: 최고점수가 이 점수 이상이면 완료로 간주. */
    var TEST_PASS_SCORE = 90

    /** 문장 테스트: 패스 기준 점수. */
    var SENTENCE_TEST_PASS_SCORE = 90

    /**
     * 매칭(단어): 최고기록이 이 점수 이상이면 완료로 간주.
     * 목표 점수(Matching.EXIT_SCORE = 8500)보다 낮게 두어, 7000 이상 받아 둔 set 은
     * 다시 돌리지 않는다.
     */
    var MATCH_PASS_SCORE = 7000

    /** 스크램블(문장): 최고기록이 이 점수 이상이면 완료로 간주 (목표는 8500). */
    var SCRAMBLE_PASS_SCORE = 7000

    private const val TEST_NEXT_BTN_SELECTOR = ".btn-condition-next"    // '다음' 버튼
    private const val TEST_START_BTN_SELECTOR = ".btn-quiz-start"       // '테스트 시작' 버튼
    private const val TEST_OK_BTN_SELECTOR = ".modal-content .btn-ok"   // '응시'/'새로 시작' 확인
    private const val VIEW_TYPE_TOGGLE_SELECTOR = "a[data-toggle=\"dropdown\"] .str_view_type"
    private const val START_LEARNING_BTN_SELECTOR = ".btn-opt-start"
    private const val FULL_CARDS_DATA_IDX = "6"
    private const val FULL_CARDS_LABEL = "전체 카드 학습"

    private data class SetItem(val idx: String, val name: String, val sentence: Boolean)

    fun isSentenceSet(setName: String): Boolean = setName.trim().endsWith("(예문)")

    /**
     * set 상세 페이지에서 문장 set 판별: 매칭/스크램블 버튼 텍스트가
     * '스크램블'이면 문장 set, '매칭'이면 단어 set (둘 다 /Match/ URL).
     * 이름의 '(예문)' 접미사보다 확실하다.
     */
    private suspend fun isSentenceSetDetail(d: Driver): Boolean = d.evalBool(
        """
        var btn = document.querySelector(${MATCH_BTN_SELECTOR.jsStr()});
        if (!btn) return false;
        return (btn.textContent || '').indexOf('스크램블') >= 0;
        """
    )

    /** 셋 목록에서 (data-idx, 이름, 문장여부)를 읽는다. */
    private suspend fun getSetItems(d: Driver): List<SetItem> {
        val arr = d.evalArrayOrNull(
            """
            var anchors = document.querySelectorAll(${SET_NAME_LINK_SELECTOR.jsStr()});
            var out = [];
            for (var i = 0; i < anchors.length; i++) {
                var a = anchors[i];
                // <a> 첫 텍스트 노드만 ("18 카드" 같은 span 텍스트 제외)
                var n = a.firstChild;
                var name = (n ? (n.textContent || '') : '').trim();
                if (!name) name = ((a.textContent || '').split('\n')[0] || '').trim();
                var si = a.closest('.set-item');
                var sentence = si ? !!si.querySelector('.set-icon.sentence') : false;
                out.push({ idx: a.getAttribute('data-idx'), name: name, sentence: sentence });
            }
            return out;
            """
        ) ?: return emptyList()

        val result = mutableListOf<SetItem>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val idx = if (o.isNull("idx")) "" else o.optString("idx", "")
            result.add(SetItem(idx, o.optString("name", ""), o.optBoolean("sentence", false)))
        }
        return result
    }

    private suspend fun waitForSetDetail(d: Driver, timeoutMs: Long, stop: StopFlag? = null): Boolean =
        d.waitForSelector(".btn-summary", timeoutMs, stop)

    private suspend fun waitForSetList(d: Driver, timeoutMs: Long, stop: StopFlag? = null): Boolean =
        d.waitForSelector(SET_ITEM_SELECTOR, timeoutMs, stop)

    /** 테스트(스피드퀴즈) 페이지의 문제 카드(.flip-card)가 뜰 때까지 대기. */
    private suspend fun waitForTestPage(d: Driver, timeoutMs: Long, stop: StopFlag? = null): Boolean =
        d.waitForSelector(".flip-card", timeoutMs, stop)

    /**
     * '진행 중인 테스트' 확인 모달이 뜨면 '응시' -> '새로 시작'(보이는 .btn-ok)을 클릭.
     * 모달은 0~2개 연속으로 뜰 수 있으며, 안 뜨면 그냥 통과.
     */
    private suspend fun handleTestRestartModals(
        d: Driver, stop: StopFlag, maxClicks: Int = 3, appearTimeoutMs: Long = 2500,
    ) {
        for (i in 0 until maxClicks) {
            if (!d.waitForVisible(TEST_OK_BTN_SELECTOR, appearTimeoutMs, stop)) break
            if (stop.isSet) return
            d.clickFirstVisible(TEST_OK_BTN_SELECTOR)
            d.log("[전체] 테스트 확인 모달 처리 (.btn-ok 클릭)")
            if (stop.await(700)) return
        }
    }

    /** data-rate (학습 완료율) >= 100 이면 완료로 간주. */
    private suspend fun isModeCompleted(d: Driver, btnSelector: String): Boolean = d.evalBool(
        """
        var btn = document.querySelector(${btnSelector.jsStr()});
        if (!btn) return false;
        var el = btn.querySelector('[data-rate]');
        if (!el) return false;
        var rate = parseInt(el.getAttribute('data-rate'), 10);
        if (isNaN(rate)) return false;
        return rate >= 100;
        """
    )

    /** 테스트 버튼의 '최고점수'가 passScore 이상이면 완료로 간주. */
    private suspend fun isTestDone(d: Driver, passScore: Int): Boolean {
        val score = d.evalIntOrNull(
            """
            var btn = document.querySelector(${TEST_BTN_SELECTOR.jsStr()});
            if (!btn) return null;
            var m = (btn.textContent || '').match(/(\d+)\s*점/);
            return m ? parseInt(m[1], 10) : null;
            """
        ) ?: return false
        return score >= passScore
    }

    /** 매칭 버튼의 '최고기록' 점수가 passScore 이상이면 완료로 간주. */
    private suspend fun isMatchDone(d: Driver, passScore: Int): Boolean {
        val score = d.evalIntOrNull(
            """
            var btn = document.querySelector(${MATCH_BTN_SELECTOR.jsStr()});
            if (!btn) return null;
            var m = (btn.textContent || '').match(/([\d,]+)\s*점/);
            return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
            """
        ) ?: return false
        return score >= passScore
    }

    /** 스펠 버튼이 선생님 지정 '필수'인지 (class에 required). 자율이면 false. */
    private suspend fun isSpellRequired(d: Driver): Boolean = d.evalBool(
        """
        var btn = document.querySelector(${SPELL_BTN_SELECTOR.jsStr()});
        if (!btn) return false;
        return btn.classList.contains('required');
        """
    )

    /** 현재 active 옵션이 '전체 카드 학습'(data-idx=6)인지. */
    private suspend fun isFullCardsMode(d: Driver): Boolean = d.evalBool(
        """
        var active = document.querySelector('.sel-show-type.active');
        if (!active) return false;
        return active.getAttribute('data-idx') === ${FULL_CARDS_DATA_IDX.jsStr()};
        """
    )

    /** 학습 구간 드롭다운을 '전체 카드 학습'으로 설정. */
    private suspend fun ensureFullCardsMode(d: Driver, stop: StopFlag): Boolean {
        if (isFullCardsMode(d)) return true

        val toggled = d.evalBool(
            """
            var label = document.querySelector(${VIEW_TYPE_TOGGLE_SELECTOR.jsStr()});
            if (!label) return false;
            var a = label.closest('a[data-toggle="dropdown"]');
            if (!a) return false;
            a.click();
            return true;
            """
        )
        if (!toggled) {
            d.log("[전체] 학습구간 드롭다운을 찾지 못했습니다.")
            return false
        }

        if (stop.await(500)) return false

        val clicked = d.evalBool(
            """
            var opt = document.querySelector('.sel-show-type[data-idx="$FULL_CARDS_DATA_IDX"]');
            if (!opt) {
                var els = document.querySelectorAll('.sel-show-type');
                for (var i = 0; i < els.length; i++) {
                    if ((els[i].textContent || '').trim() === ${FULL_CARDS_LABEL.jsStr()}) {
                        opt = els[i];
                        break;
                    }
                }
            }
            if (!opt) return false;
            opt.click();
            return true;
            """
        )
        if (!clicked) {
            d.log("[전체] '$FULL_CARDS_LABEL' 옵션을 찾지 못했습니다.")
            return false
        }

        // 변경 확인 (원본 WebDriverWait 5초)
        val deadline = System.currentTimeMillis() + 5000
        while (System.currentTimeMillis() < deadline) {
            if (isFullCardsMode(d)) {
                d.log("[전체] 학습구간 -> '$FULL_CARDS_LABEL'")
                return true
            }
            if (stop.await(200)) return false
        }
        d.log("[전체] 학습구간 변경 확인 실패.")
        return false
    }

    /** 모드 진입 후 나오는 '암기학습/리콜학습 (N구간)' 시작 버튼을 클릭. */
    private suspend fun clickStartLearning(d: Driver, stop: StopFlag): Boolean {
        if (!d.waitForVisible(START_LEARNING_BTN_SELECTOR, 10000, stop)) {
            d.log("[전체] 시작 버튼($START_LEARNING_BTN_SELECTOR)을 찾지 못했습니다.")
            return false
        }
        if (stop.isSet) return false
        return d.clickFirstVisible(START_LEARNING_BTN_SELECTOR)
    }

    private suspend fun clickModeButton(d: Driver, btnSelector: String): Boolean {
        val ok = d.clickFirst(btnSelector)
        if (!ok) d.log("[전체] 버튼 클릭 실패 ($btnSelector)")
        return ok
    }

    /**
     * 모드 함수에는 자식 StopFlag 를 넘겨 모드 종료 시의 stop 이 전체 자동화로 전파되지
     * 않게 격리한다. 부모가 중지되면 자식도 중지된 것으로 본다.
     * (원본 run_mode_isolated 의 propagate 스레드를 StopFlag 부모-자식 관계로 대체)
     */
    private suspend fun runModeIsolated(
        d: Driver, modeFn: ModeFn, answerDict: AnswerDict?, parentStop: StopFlag,
    ) {
        val modeStop = StopFlag(parentStop)
        try {
            modeFn(d, answerDict, modeStop)
        } finally {
            modeStop.set()
        }
    }

    private data class ModeStep(val label: String, val selector: String, val fn: ModeFn)

    /**
     * 현재 set 상세(셋홈) 페이지에서 그 set 의 전체 모드를 순서대로 수행.
     * 순서: 암기 -> 리콜 -> (단어·필수면)스펠 -> 매칭/스크램블 -> 테스트.
     */
    private suspend fun processSetDetail(
        d: Driver, sentenceMode: Boolean, stop: StopFlag,
    ) {
        // 문장 set 은 문장 테스트(패스 90점), 단어 set 은 단어 테스트
        val testPass = if (sentenceMode) SENTENCE_TEST_PASS_SCORE else TEST_PASS_SCORE

        // 스펠은 단어 set + 선생님이 '필수'로 지정한 경우에만 (자율이면 건너뜀)
        val spellRequired = !sentenceMode && isSpellRequired(d)

        val memorizeDone = isModeCompleted(d, MEMORIZE_BTN_SELECTOR)
        val recallDone = isModeCompleted(d, RECALL_BTN_SELECTOR)
        val testDone = isTestDone(d, testPass)
        // 문장 set 은 스크램블, 단어 set 은 매칭
        val gameDone =
            if (sentenceMode) isMatchDone(d, SCRAMBLE_PASS_SCORE) else isMatchDone(d, MATCH_PASS_SCORE)
        // 스펠: 필수가 아니면 완료로 간주(스킵), 필수면 data-rate 로 판단
        val spellDone = !spellRequired || isModeCompleted(d, SPELL_BTN_SELECTOR)

        if (memorizeDone && recallDone && testDone && gameDone && spellDone) {
            d.log("[전체] 모든 모드 완료 — set 스킵")
            return
        }

        ensureFullCardsMode(d, stop)
        if (stop.await(500)) return
        if (stop.isSet) return

        // 이 driver 의 현재 set 에서 바로 단어장을 만든다 (계정 간 덮어쓰기 없음)
        val data = HtmlParser.getData(d)
        if (data.isNullOrEmpty()) {
            d.log("[전체] 단어장 추출 실패.")
            return
        }

        val answerDict = HtmlParser.dictFromCards(data)
        if (answerDict.isNullOrEmpty()) {
            d.log("[전체] answer_dict 생성 실패.")
            return
        }

        val modeSteps = mutableListOf(
            ModeStep(
                "암기", MEMORIZE_BTN_SELECTOR,
                if (sentenceMode) MemorizeSentence.run else Memorize.run,
            ),
            ModeStep(
                "리콜", RECALL_BTN_SELECTOR,
                if (sentenceMode) RecallSentence.run else Recall.run,
            ),
        )
        // 리콜 다음, 테스트 전: 문장 set 은 스크램블, 단어 set 은 (필수면)스펠 -> 매칭
        if (sentenceMode) {
            modeSteps.add(ModeStep("스크램블", MATCH_BTN_SELECTOR, Scramble.run))
        } else {
            if (spellRequired) modeSteps.add(ModeStep("스펠", SPELL_BTN_SELECTOR, Spell.run))
            modeSteps.add(ModeStep("매칭", MATCH_BTN_SELECTOR, Matching.run))
        }
        // 문법훈련은 있는 set 에서만 (버튼이 없으면 조용히 건너뛴다)
        if (d.evalBool("return !!document.querySelector(${GRAMMAR_BTN_SELECTOR.jsStr()});")) {
            modeSteps.add(ModeStep("문법", GRAMMAR_BTN_SELECTOR, Grammar.run))
        }
        modeSteps.add(
            ModeStep(
                "테스트", TEST_BTN_SELECTOR,
                if (sentenceMode) TestSentence.run else Test.run,
            )
        )

        for (step in modeSteps) {
            if (stop.isSet) break

            val alreadyDone = when (step.label) {
                "테스트" -> isTestDone(d, testPass)
                "매칭" -> isMatchDone(d, MATCH_PASS_SCORE)
                "스크램블" -> isMatchDone(d, SCRAMBLE_PASS_SCORE)
                else -> isModeCompleted(d, step.selector)
            }
            if (alreadyDone) {
                d.log("[전체] ${step.label} 이미 완료 — 스킵.")
                continue
            }

            if (!clickModeButton(d, step.selector)) {
                d.log("[전체] ${step.label} 버튼 클릭 실패. 스킵.")
                continue
            }

            if (stop.await(1000)) break

            if (step.label == "테스트") {
                // 1. '다음' 버튼
                if (!d.waitForVisible(TEST_NEXT_BTN_SELECTOR, 5000, stop) ||
                    !d.clickFirstVisible(TEST_NEXT_BTN_SELECTOR)
                ) {
                    d.log("[전체] 테스트 '다음' 버튼 클릭 실패")
                    continue
                }
                d.log("[전체] 테스트 '다음' 버튼 클릭 완료")

                if (stop.await(800)) break  // 화면 전환 여유 시간

                // 2. '테스트 시작' 버튼
                if (!d.waitForVisible(TEST_START_BTN_SELECTOR, 5000, stop) ||
                    !d.clickFirstVisible(TEST_START_BTN_SELECTOR)
                ) {
                    d.log("[전체] '테스트 시작' 버튼 클릭 실패")
                    continue
                }
                d.log("[전체] '테스트 시작' 버튼 클릭 완료")

                // 2.5 '진행 중인 테스트' 확인 모달(응시 -> 새로 시작) 처리
                handleTestRestartModals(d, stop)
                if (stop.isSet) break

                // 3. 최종 플립 카드 페이지(문제 화면) 진입 대기
                if (!waitForTestPage(d, 10000, stop)) {
                    d.log("[전체] 테스트 페이지 진입 실패. 스킵.")
                    continue
                }
            } else {
                // 암기 / 리콜 / 스펠 / 매칭 / 스크램블은 시작 버튼 클릭
                if (!clickStartLearning(d, stop)) {
                    d.log("[전체] ${step.label} 시작 버튼 클릭 실패. 스킵.")
                    continue
                }
            }

            if (stop.await(1000)) break

            runModeIsolated(d, step.fn, answerDict, stop)

            if (stop.isSet) break

            if (!waitForSetDetail(d, 15000, stop)) {
                d.log("[전체] ${step.label} 후 set 페이지 복귀 실패.")
                break
            }
        }
    }

    /** 현재 열려 있는 set 상세(셋홈) 페이지의 그 set 만 전체 모드 수행 후 종료. */
    val runSingleSet: FlowFn = { d, stop ->
        d.log("[한세트] 시작 ([중지]로 멈춤)")
        if (!waitForSetDetail(d, 3000, stop)) {
            d.log("[한세트] set 상세(셋홈) 페이지에서 실행하세요.")
        } else {
            try {
                val sentenceMode = isSentenceSetDetail(d)
                val setName = d.title().trim()
                d.log("[한세트] [${if (sentenceMode) "문장" else "단어"}] $setName")
                processSetDetail(d, sentenceMode, stop)
            } catch (e: Throwable) {
                if (!stop.isSet) d.log("[한세트] 오류: ${e.message}")
            } finally {
                d.log("[한세트] 종료")
            }
        }
    }

    /** 단어장 목록 페이지에서 맨 아래 set 부터 위로 순차 처리. */
    val runFullAutomation: FlowFn = { d, stop ->
        d.log("[전체] 시작 ([중지]로 멈춤)")

        if (!waitForSetList(d, 3000, stop)) {
            d.log("[전체] .set-item을 찾을 수 없습니다. 단어장 목록 페이지에서 시작하세요.")
        } else {
            // set 목록 URL 저장 (테스트 '나가기' 등으로 히스토리가 오염돼도 확실히 복귀)
            val setListUrl = d.currentUrl()

            suspend fun backToSetList(timeoutMs: Long = 10000): Boolean {
                d.loadUrl(setListUrl)
                d.waitForLoad(timeoutMs)
                return waitForSetList(d, timeoutMs, stop)
            }

            val processedIdx = HashSet<String>()

            try {
                while (!stop.isSet) {
                    val sets = getSetItems(d)
                    if (sets.isEmpty()) {
                        d.log("[전체] set 목록이 비어있습니다. 종료.")
                        break
                    }

                    val target = sets.reversed().firstOrNull {
                        it.idx.isNotEmpty() && it.idx !in processedIdx
                    }
                    if (target == null) {
                        d.log("[전체] 모든 set 처리 완료.")
                        break
                    }

                    // 셋 목록 아이콘으로 판별, 폴백으로 이름의 '(예문)'
                    var sentenceMode = target.sentence || isSentenceSet(target.name)

                    val clicked = d.evalBool(
                        """
                        var a = document.querySelector(
                            '.set-item a.set-name-a[data-idx=' + JSON.stringify(${target.idx.jsStr()}) + ']');
                        if (!a) return false;
                        a.click();
                        return true;
                        """
                    )
                    if (!clicked) {
                        d.log("[전체] set 클릭 실패: ${target.name}")
                        processedIdx.add(target.idx)
                        continue
                    }

                    if (!waitForSetDetail(d, 10000, stop)) {
                        d.log("[전체] set 상세 페이지 진입 실패. 다음 set로 이동.")
                        processedIdx.add(target.idx)
                        backToSetList(5000)
                        continue
                    }

                    if (stop.isSet) break

                    // 상세 페이지의 매칭/스크램블 버튼 텍스트로 확정 (이름보다 확실)
                    sentenceMode = sentenceMode || isSentenceSetDetail(d)
                    d.log("[전체] [${if (sentenceMode) "문장" else "단어"}] ${target.name}")

                    processSetDetail(d, sentenceMode, stop)

                    if (stop.isSet) break

                    processedIdx.add(target.idx)

                    if (!backToSetList(10000)) {
                        d.log("[전체] 단어장 목록 페이지 복귀 실패. 종료.")
                        break
                    }

                    if (stop.await(1000)) break
                }
            } catch (e: Throwable) {
                if (!stop.isSet) d.log("[전체] 오류: ${e.message}")
            } finally {
                d.log("[전체] 종료")
            }
        }
    }
}
