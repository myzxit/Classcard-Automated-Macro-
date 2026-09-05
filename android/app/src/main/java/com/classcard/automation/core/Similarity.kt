package com.classcard.automation.core

/**
 * 파이썬 `difflib.SequenceMatcher(None, a, b).ratio()` 이식.
 *
 * Test.py / Matching.py 의 `_ratio` 가 0.6 임계값으로 유사도 폴백을 판단하므로,
 * 값이 원본과 같아야 동작이 같아진다. difflib 과 동일하게
 * "재귀적 최장 일치 블록의 총 길이 M" 으로 `2M / (len(a)+len(b))` 를 계산한다.
 *
 * (difflib 의 autojunk 휴리스틱은 길이 200 초과 시퀀스에만 적용되고 여기 입력은
 *  단어/짧은 뜻풀이라 사실상 걸리지 않으므로 생략했다.)
 */
object Similarity {

    fun ratio(a: String?, b: String?): Double {
        if (a.isNullOrEmpty() || b.isNullOrEmpty()) return 0.0
        val matches = matchCount(a, b, 0, a.length, 0, b.length)
        return 2.0 * matches / (a.length + b.length)
    }

    /** difflib 의 get_matching_blocks 와 같은 재귀 분할로 일치 문자 수를 센다. */
    private fun matchCount(a: String, b: String, alo: Int, ahi: Int, blo: Int, bhi: Int): Int {
        val (i, j, k) = findLongestMatch(a, b, alo, ahi, blo, bhi)
        if (k == 0) return 0
        var total = k
        if (alo < i && blo < j) total += matchCount(a, b, alo, i, blo, j)
        if (i + k < ahi && j + k < bhi) total += matchCount(a, b, i + k, ahi, j + k, bhi)
        return total
    }

    /** difflib.SequenceMatcher.find_longest_match 이식. 반환: (i, j, size) */
    private fun findLongestMatch(
        a: String, b: String, alo: Int, ahi: Int, blo: Int, bhi: Int,
    ): Triple<Int, Int, Int> {
        val b2j = HashMap<Char, MutableList<Int>>()
        for (idx in blo until bhi) {
            b2j.getOrPut(b[idx]) { mutableListOf() }.add(idx)
        }

        var bestI = alo
        var bestJ = blo
        var bestSize = 0
        var j2len = HashMap<Int, Int>()

        for (i in alo until ahi) {
            val newJ2Len = HashMap<Int, Int>()
            for (j in b2j[a[i]].orEmpty()) {
                if (j < blo) continue
                if (j >= bhi) break
                val k = (j2len[j - 1] ?: 0) + 1
                newJ2Len[j] = k
                if (k > bestSize) {
                    bestI = i - k + 1
                    bestJ = j - k + 1
                    bestSize = k
                }
            }
            j2len = newJ2Len
        }

        return Triple(bestI, bestJ, bestSize)
    }
}
