"""원본 파이썬 모듈의 '순수 로직' 함수를 실제로 호출해 기준값(JSON)을 만든다.

이 JSON 을 코틀린 유닛 테스트가 읽어, 이식한 함수가 같은 입력에 같은 출력을 내는지
대조한다. (원본 코드를 그대로 import 하므로 '내가 기억하는 원본'이 아니라 진짜 원본이다.)
"""
import json
import sys
import difflib
import contextlib

import Scramble
import RecallSentence
import Test
import Matching
import TestSentence
import MemorizeSentence
import Spell

_redirect = contextlib.redirect_stdout(sys.stderr)
_redirect.__enter__()

out = {}

# ---------------------------------------------------------------- 정규화 함수들
MNORM_INPUTS = [
    "1. 끌어서 떼어내다, 제거하다 2. 성공하다",
    "pull off",
    "  Hello,  World! 123 ",
    "<b>강조</b>&nbsp;텍스트",
    "in(to)",
    "The Man's car, isn't it?",
    "…dash–em—",
    "",
]
out["mnorm"] = [[s, Test.mnorm(s)] for s in MNORM_INPUTS]
out["matching_mnorm"] = [[s, Matching.mnorm(s)] for s in MNORM_INPUTS]
out["knorm"] = [[s, Scramble.knorm(s)] for s in MNORM_INPUTS]
out["wnorm"] = [[s, Scramble.wnorm(s)] for s in MNORM_INPUTS]
out["norm_en"] = [[s, TestSentence.norm_en(s)] for s in MNORM_INPUTS]
out["normalize_kor"] = [[s, TestSentence.normalize_kor(s)] for s in MNORM_INPUTS]
out["normalize_text"] = [[s, MemorizeSentence.normalize_text(s)] for s in MNORM_INPUTS]
out["strip_parens_simple"] = [[s, TestSentence.strip_parens(s)] for s in MNORM_INPUTS]
out["strip_parens"] = [[s, RecallSentence.strip_parens(s)] for s in MNORM_INPUTS]
out["normalize_unicode"] = [[s, RecallSentence.normalize_unicode(s)] for s in MNORM_INPUTS]
out["wkey"] = [[s, RecallSentence._wkey(s)] for s in MNORM_INPUTS]
out["scramble_mnorm"] = [[s, Scramble._mnorm(s)] for s in MNORM_INPUTS]

# ---------------------------------------------------------------- 토큰화
TOKENIZE_INPUTS = [
    "I go in(to) the room.",
    "You'll never walk alone",
    "The man - who knows - left, quietly.",
    "She said “hello” and left…",
    "a b c",
    "well-known problem",
]
out["tokenize"] = [[s, RecallSentence.tokenize(s)] for s in TOKENIZE_INPUTS]
out["tokenize_loose"] = [[s, RecallSentence.tokenize_loose(s)] for s in TOKENIZE_INPUTS]
out["parse_english_words"] = [
    [s, TestSentence.parse_english_words(s)] for s in TOKENIZE_INPUTS
]
out["split_target_words"] = [
    [s, Scramble.split_target_words(s)] for s in TOKENIZE_INPUTS
]
out["split_subtokens"] = [
    [s, TestSentence._split_subtokens(s)]
    for s in ["state-of-the-art", "go(to)school", "plain", "(and) then"]
]

# ---------------------------------------------------------------- difflib ratio
RATIO_PAIRS = [
    ("끌어서떼어내다제거하다", "끌어서떼어내다"),
    ("abcdefg", "abcdfg"),
    ("apple", "orange"),
    ("", "abc"),
    ("동일한문장", "동일한문장"),
    ("성공하다", "실패하다"),
]
out["ratio"] = [[a, b, difflib.SequenceMatcher(None, a, b).ratio()] for a, b in RATIO_PAIRS]

# ---------------------------------------------------------------- Scramble 정렬
SCRAMBLE_CASES = [
    # (정답 문장, 이미 배치된 박스, 화면 후보 타일)
    ("I can live without.", [], ["without.", "I", "live", "can"]),
    ("I can live without.", ["I", "can"], ["without.", "live"]),
    ("I can live without.", ["I", "can", "live", "without."], ["x"]),
    ("He bought a car, a bike.", ["He", "bought", "a"], ["car,", "a", "bike."]),
    ("You'll be fine", ["You'll"], ["fine", "be"]),
    ("The end .", ["The"], ["end", "."]),
]
scramble_out = []
for target, placed, cands in SCRAMBLE_CASES:
    words = Scramble.split_target_words(target)
    idx, need = Scramble.find_next_index(words, placed, cands)
    scramble_out.append({
        "target": target, "placed": placed, "cands": cands,
        "words": words,
        "align": Scramble._align_index(words, placed),
        "idx": idx, "need": need,
    })
out["scramble"] = scramble_out

# ---------------------------------------------------------------- RecallSentence 매칭
SENTENCES = [
    "I can live without it.",
    "I can live with it.",
    "She went to the park yesterday.",
    "He is a well-known writer.",
]
recall_out = []
for prefix in ([], ["I", "can"], ["I", "can", "live", "without"], ["She"], ["He", "is"]):
    d = {i: s for i, s in enumerate(SENTENCES)}
    recall_out.append({
        "prefix": prefix,
        "matches": RecallSentence.find_matching_sentences(prefix, d),
        "subseq": [
            RecallSentence.find_subsequence_end(prefix, RecallSentence.tokenize(s))
            for s in SENTENCES
        ],
        "punct_split": RecallSentence.is_prefix_punct_split(prefix),
    })
out["recall_matching"] = recall_out

out["recall_by_candidates"] = []
for cands in (["She", "went", "to"], ["I", "can", "live"], ["zzz"]):
    d = {i: s for i, s in enumerate(SENTENCES)}
    out["recall_by_candidates"].append({
        "cands": cands,
        "result": RecallSentence.find_sentence_by_candidates(
            cands, d, RecallSentence.tokenize
        ),
    })

# ---------------------------------------------------------------- Spell 정답 찾기
SPELL_DICT = {"사과": "apple", "달리다": "run", "1. 켜다 2. 자극하다": "turn on"}
out["spell_find_answer"] = [
    [p, Spell.find_answer(SPELL_DICT, p)]
    for p in ["사과", " 달리다 ", "apple", "1. 켜다 2. 자극하다", "없는말"]
]

# ---------------------------------------------------------------- TestSentence 매핑
TS_DICT = {
    "나는 그것 없이 살 수 있다.": "I can live without it.",
    "그녀는 (어제) 공원에 갔다.": "She went to the park yesterday.",
}
m, mnp = TestSentence.build_maps(TS_DICT)
out["test_sentence_match"] = [
    [p, TestSentence.match_english(p, m, mnp)]
    for p in [
        "나는 그것 없이 살 수 있다.",
        "나는  그것 없이 살 수 있다.",
        "그녀는 공원에 갔다.",
        "모르는 문장",
    ]
]

# ---------------------------------------------------------------- Test.solve
TEST_DICT = {"사과": "apple", "달리다": "run", "1. 끌어서 떼어내다, 제거하다": "pull off"}
fwd, bwd = Test.build_lookups(TEST_DICT)
SOLVE_CASES = [
    ("apple", [(1, "달리다"), (2, "사과"), (3, "끌어서 떼어내다, 제거하다")]),
    ("사과", [(1, "run"), (2, "apple"), (3, "pull off")]),
    ("pull off", [(1, "사과"), (2, "끌어서 떼어내다, 제거하다"), (3, "달리다")]),
    ("모르는단어", [(1, "사과"), (2, "달리다")]),
]
solve_out = []
for prompt, opts in SOLVE_CASES:
    options = [(n, raw, Test.mnorm(raw)) for n, raw in opts]
    num, ans = Test.solve(prompt, options, fwd, bwd)
    solve_out.append({
        "prompt": prompt,
        "options": [[n, raw] for n, raw in opts],
        "num": num,
        "answer": ans,
    })
out["test_solve"] = solve_out

# ---------------------------------------------------------------- Matching.find_pair
MATCH_CARDS = [
    {"front": "apple", "back": "사과"},
    {"front": "run", "back": "달리다"},
    {"front": "pull off", "back": "1. 끌어서 떼어내다, 제거하다"},
]
mfwd, mbwd = {}, {}
for c in MATCH_CARDS:
    mfwd[Matching.mnorm(c["front"])] = c["back"]
    mbwd[Matching.mnorm(c["back"])] = c["front"]
lefts = [(i, t, Matching.mnorm(t)) for i, t in enumerate(["run", "apple"])]
rights = [(i, t, Matching.mnorm(t)) for i, t in enumerate(["사과", "달리다"])]
li, ri, lraw, rraw = Matching.find_pair(lefts, rights, mfwd, mbwd)
out["matching_pair"] = {
    "left": [t for _, t, _ in lefts],
    "right": [t for _, t, _ in rights],
    "li": li, "ri": ri, "lraw": lraw, "rraw": rraw,
}

# ---------------------------------------------------------------- 오답 계획 개수
out["plan_wrong_counts"] = [
    [total, target, len(Test._plan_wrong_indices.__wrapped__(total))
     if False else int(total * (100 - target) / 100.0)]
    for total, target in [(20, 90), (25, 90), (10, 100), (7, 70), (0, 90)]
]

with open('/tmp/pyref/reference.json', 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print('written', file=sys.stderr)
