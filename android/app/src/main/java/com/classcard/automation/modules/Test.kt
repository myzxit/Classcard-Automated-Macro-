package com.classcard.automation.modules

import com.classcard.automation.core.AntiBlur
import com.classcard.automation.core.Driver
import com.classcard.automation.core.Norm
import com.classcard.automation.core.Similarity
import com.classcard.automation.core.StopFlag
import kotlin.random.Random

/** Test.py 이식 — 단어 객관식 테스트 자동 풀이. */
object Test {

    private const val GO_RESULT_SELECTOR = "a.btn-go-result"

    /** 진단용: true 면 문제별 파싱 결과를 로그에 출력. */
    var DEBUG = false

    /**
     * 테스트 목표 점수(0~100). 이 점수가 나오도록 일부러 틀릴 문항 수를 자동 계산한다.
     * 예) 90 -> 10%만 일부러 틀림, 100 -> 다 맞음.
     */
    var TARGET_SCORE = 90

    /** 보기 하나. (번호, 원문, 정규화 텍스트) */
    internal data class Option(val num: Int, val raw: String, val norm: String)

    private data class Question(
        val qid: String,
        val flipped: Boolean,
        val promptRaw: String,
        val options: List<Option>,
    )

    /**
     * 정규화된 양방향 맵.
     * fwd[mnorm(front)] = back(raw), bwd[mnorm(back)] = front(raw)
     */
    class Lookups(val fwd: Map<String, String>, val bwd: Map<String, String>)

    fun buildLookups(d: Driver?, answerDict: AnswerDict?): Lookups? {
        if (answerDict.isNullOrEmpty()) {
            d?.log("[테스트] 오류: 단어장(answer_dict)이 없습니다.")
            return null
        }
        val fwd = HashMap<String, String>()
        val bwd = HashMap<String, String>()
        for ((back, front) in answerDict) {
            if (front.isNotEmpty()) fwd[Norm.mnorm(front)] = back
            if (back.isNotEmpty()) bwd[Norm.mnorm(back)] = front
        }
        d?.log("[테스트] 매칭 데이터 로드 완료 (단어 ${answerDict.size}개)")
        return Lookups(fwd, bwd)
    }

    /**
     * 현재 보이는 문제(.flip-card.showing)만 읽는다.
     *  - flipped: 'flip' 클래스 = 뒷면(6개 보기)이 활성화된 상태
     *  - prompt:  .flip-card-front .front-hidden 텍스트
     *  - options: .flip-card-back 의 보이는 라벨 (번호 = for 끝자리)
     *  - qid:     test_question[] 값 (전환 감지용)
     */
    private const val READ_QUESTION_JS = """
        var card = document.querySelector('.flip-card.showing');
        if (!card) return { found: false };

        var qid = '';
        var qi = card.querySelector('input[name="test_question[]"]');
        if (qi) qid = qi.value;

        var flipped = card.classList.contains('flip');

        var prompt = '';
        var fh = card.querySelector('.flip-card-front .front-hidden');
        if (fh) prompt = (fh.textContent || '').trim();
        if (!prompt) {
            var fb = card.querySelector('.flip-card-front .cc-table');
            if (fb) prompt = (fb.textContent || '').trim();
        }

        var options = [];
        var seen = {};
        var labels = card.querySelectorAll('.flip-card-back label[for^="radio_"]:not(.hidden)');
        for (var i = 0; i < labels.length; i++) {
            var l = labels[i];
            var f = l.getAttribute('for') || '';
            var parts = f.split('_');
            var num = parseInt(parts[parts.length - 1], 10);
            if (!num || seen[num]) continue;
            seen[num] = true;
            var cc = l.querySelector('.cc-table');
            var t = ((cc ? cc.textContent : l.textContent) || '').trim();
            if (!t) continue;
            options.push({ num: num, text: t });
        }

        return { found: true, qid: qid, flipped: flipped, prompt: prompt, options: options };
    """

    private suspend fun readQuestion(d: Driver): Question? {
        val data = d.evalObjectOrNull(READ_QUESTION_JS) ?: return null
        if (!data.optBoolean("found", false)) return null

        val options = mutableListOf<Option>()
        val arr = data.optJSONArray("options")
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val num = o.optInt("num", 0)
                val raw = o.optString("text", "").trim()
                if (num != 0 && raw.isNotEmpty()) options.add(Option(num, raw, Norm.mnorm(raw)))
            }
        }

        return Question(
            qid = data.optString("qid", ""),
            flipped = data.optBoolean("flipped", false),
            promptRaw = data.optString("prompt", "").trim(),
            options = options,
        )
    }

    /**
     * 현재 보기에서 정답 번호를 찾는다.
     * (prompt -> 정답 -> 보기, 실패 시 보기 -> 짝 -> prompt 역방향, 그래도 실패 시 유사도 폴백)
     */
    internal fun solve(promptRaw: String, options: List<Option>, lk: Lookups): Pair<Int?, String?> {
        val pm = Norm.mnorm(promptRaw)

        // 1) 프롬프트 -> 정답 -> 보기 (정확/부분)
        val ans = lk.fwd[pm] ?: lk.bwd[pm]
        if (ans != null) {
            val am = Norm.mnorm(ans)
            for (o in options) if (o.norm == am) return o.num to ans
            for (o in options) {
                if (am.isNotEmpty() && (am.contains(o.norm) || o.norm.contains(am))) return o.num to ans
            }
        }

        // 2) 역방향: 각 보기의 짝을 구해 프롬프트와 비교 (정확/부분)
        for (o in options) {
            val cp = lk.fwd[o.norm] ?: lk.bwd[o.norm]
            if (cp != null && Norm.mnorm(cp) == pm) return o.num to o.raw
        }
        for (o in options) {
            val cp = lk.fwd[o.norm] ?: lk.bwd[o.norm] ?: continue
            val cpm = Norm.mnorm(cp)
            if (cpm.isNotEmpty() && (cpm.contains(pm) || pm.contains(cpm))) return o.num to o.raw
        }

        // 3) 유사도 폴백: 정답 텍스트와 가장 비슷한 보기
        if (ans != null) {
            val am = Norm.mnorm(ans)
            var bestNum: Int? = null
            var best = 0.0
            for (o in options) {
                val s = Similarity.ratio(am, o.norm)
                if (s > best) {
                    best = s
                    bestNum = o.num
                }
            }
            if (bestNum != null && best >= 0.6) return bestNum to ans
        }

        // 4) 유사도 폴백(역방향): 각 보기의 짝과 프롬프트 비교
        var bestNum: Int? = null
        var best = 0.0
        var bestAns: String? = null
        for (o in options) {
            val cp = lk.fwd[o.norm] ?: lk.bwd[o.norm] ?: continue
            val s = Similarity.ratio(Norm.mnorm(cp), pm)
            if (s > best) {
                best = s
                bestNum = o.num
                bestAns = o.raw
            }
        }
        if (bestNum != null && best >= 0.6) return bestNum to bestAns

        return null to null
    }

    /** '나가기' 버튼 클릭 (텍스트 우선, 없으면 set 링크 폴백). */
    private suspend fun clickExit(d: Driver, stop: StopFlag, timeoutMs: Long = 8000): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val clicked = d.evalBool(
                """
                var links = document.querySelectorAll('a');
                for (var i = 0; i < links.length; i++) {
                    var a = links[i];
                    if (a.offsetParent === null) continue;
                    if ((a.textContent || '').indexOf('나가기') >= 0) { a.click(); return true; }
                }
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
     * 결과 화면(btn-go-result)이 보이면 제출결과확인 -> X -> 나가기 순으로 빠져나와
     * set 상세 화면 복귀 후 stop.
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

        // 1) 제출 결과 확인
        d.clickFirstVisible(GO_RESULT_SELECTOR)
        stop.sleep(800)

        // 2) X 닫기
        if (d.waitForVisible("i.cc.times", 8000, stop)) {
            d.clickFirstVisible("i.cc.times")
        }
        stop.sleep(800)

        // 3) 나가기 -> set 상세 화면
        clickExit(d, stop, timeoutMs = 8000)
        stop.sleep(500)

        stop.set()
        return true
    }

    private suspend fun countTotal(d: Driver): Int? = d.evalIntOrNull(
        """return document.querySelectorAll('.flip-card input[name="test_question[]"]').length;"""
    )

    /**
     * TARGET_SCORE 이상이 나오도록 일부러 틀릴 문항 순번(1-based) 집합.
     * 틀릴 개수 = floor(total * (100 - TARGET_SCORE) / 100) — 내림이라 점수는 항상 목표 이상.
     */
    fun planWrongIndices(total: Int?, targetScore: Int = TARGET_SCORE): Set<Int> {
        if (total == null || total <= 0) return emptySet()
        var nWrong = (total * (100 - targetScore) / 100.0).toInt()
        nWrong = nWrong.coerceIn(0, total)
        if (nWrong == 0) return emptySet()
        return (1..total).shuffled().take(nWrong).toSet()
    }

    val run: ModeFn = { d, answerDict, stop ->
        d.log("[테스트] 시작")

        AntiBlur.inject(d) // 백그라운드 실행 시 '이탈 감지' 우회

        val lk = buildLookups(d, answerDict)
        if (lk == null) {
            d.log("[테스트] 종료")
        } else {
            val total = countTotal(d)
            val wrongIdx = planWrongIndices(total)
            if (DEBUG && total != null) {
                d.log("[테스트] 총 ${total}문항 / 일부러 틀릴 순번: ${wrongIdx.sorted().ifEmpty { "없음" }}")
            }

            var lastQid: String? = null            // 이미 답한 문제 ID (전환 감지)
            val spaceAttempts = HashMap<String, Int>()  // qid별 SPACE flip 시도 횟수
            var answeredCount = 0                  // 실제로 답한 수 (오답 주입 인덱스)

            try {
                while (!stop.isSet) {
                    if (checkEndAndStop(d, stop)) break
                    if (Memorize.startStudyIfNeeded(d, stop)) continue

                    val q = readQuestion(d)
                    if (q == null || q.options.isEmpty()) {
                        if (stop.await(300)) break
                        continue
                    }

                    val (matchNum, answer) = solve(q.promptRaw, q.options, lk)

                    if (DEBUG) {
                        val state = if (q.flipped) "보기" else "단어"
                        d.log("[감지] $state | prompt='${q.promptRaw}' | 정답번호=$matchNum | qid=${q.qid}")
                    }

                    // 이미 답한 문제 -> 다음 문제로 넘어갈 때까지 대기
                    if (q.qid.isNotEmpty() && q.qid == lastQid) {
                        if (stop.await(300)) break
                        continue
                    }

                    // 단어 카드(아직 안 뒤집힘) -> SPACE 로 6개 보기로 넘김. 최대 8회 재시도.
                    if (!q.flipped) {
                        val n = spaceAttempts[q.qid] ?: 0
                        if (n < 8) {
                            d.pressSpace()
                            spaceAttempts[q.qid] = n + 1
                        }
                        if (stop.await(500)) break
                        continue
                    }

                    // 6개 보기 활성 -> 답 선택
                    answeredCount++
                    val makeWrong = answeredCount in wrongIdx
                    val allNums = q.options.map { it.num }

                    val choose: Int
                    if (matchNum != null && !makeWrong) {
                        choose = matchNum
                    } else {
                        val wrongNums = allNums.filter { it != matchNum }
                        choose = if (wrongNums.isNotEmpty()) wrongNums[Random.nextInt(wrongNums.size)]
                        else (allNums.firstOrNull() ?: 1)
                        if (makeWrong) {
                            d.log("[테스트] ${answeredCount}번째: 의도적 오답 ('${q.promptRaw}')")
                        } else if (matchNum == null) {
                            d.log("[테스트] ${answeredCount}번째: 매칭 실패 -> 랜덤 ('${q.promptRaw}')")
                        }
                    }

                    if (DEBUG) {
                        d.log("[테스트][$answeredCount] '${q.promptRaw}' -> 정답='$answer' -> ${choose}번 선택")
                    }

                    // 활성 직후 너무 빨리 누르면 씹힘 -> 0.5초 후 입력
                    if (stop.await(500)) break
                    d.pressDigit(choose)
                    lastQid = q.qid
                    if (stop.await(500)) break
                }
            } catch (e: Throwable) {
                if (!stop.isSet) d.log("[테스트] 오류: ${e.message}")
            } finally {
                d.log("[테스트] 종료")
            }
        }
    }
}
