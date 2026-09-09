/**
 * 문법 모듈의 순수 로직 검증 (확장프로그램판).
 *
 * 문법훈련은 이식할 원본 파이썬이 없어 reference.json 기준값이 없다. 대신
 * 안드로이드판 GrammarLogicTest 와 **같은 표**를 두어, 두 이식본이 같은 보기를
 * 고르는지 확인한다.
 *
 * 실행:  node --test extension/test/grammar.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import * as N from '../engine/norm.js';
import { buildLookups } from '../engine/modules/games.js';
import {
  pickChoice, lookupAnswer, nextClassAction,
  nextScrambleIndex, nextPairAttempt, nextGroupPick, fillValues,
} from '../engine/modules/grammar.js';

const choices = (...texts) =>
  texts.map((t, i) => ({ index: i, raw: t, norm: N.mnorm(t) }));

test('정답을 정확히 알 때 그 보기를 고른다', () => {
  const c = choices('has been', 'have been', 'had being', 'is been');
  assert.equal(pickChoice(c, 'have been', new Set()), 1);
});

test('대소문자·공백 차이는 무시한다', () => {
  const c = choices('Has Been', 'have  been', 'had being');
  assert.equal(pickChoice(c, 'HAVE BEEN', new Set()), 1);
});

test('정답 문장이 보기를 포함하면 그 보기를 고른다', () => {
  const c = choices('in', 'on', 'at');
  assert.equal(pickChoice(c, 'at night', new Set()), 2);
});

test('정답을 모르면 첫 보기를 고른다', () => {
  const c = choices('a', 'b', 'c');
  assert.equal(pickChoice(c, null, new Set()), 0);
});

test('이미 틀린 보기는 건너뛴다', () => {
  const c = choices('a', 'b', 'c');
  assert.equal(pickChoice(c, null, new Set([0])), 1);
  assert.equal(pickChoice(c, null, new Set([0, 1])), 2);
});

test('보기가 전부 오답으로 표시되면 처음부터 다시 고른다', () => {
  const c = choices('a', 'b');
  assert.equal(pickChoice(c, null, new Set([0, 1])), 0);
});

test('단어장이 가리키는 보기가 이미 오답이면 다른 보기를 고른다', () => {
  const c = choices('a', 'b', 'c');
  assert.equal(pickChoice(c, 'c', new Set([2])), 0);
});

test('보기가 없으면 null', () => {
  assert.equal(pickChoice([], 'a', new Set()), null);
});

test('단어장에서 양방향으로 정답을 찾는다', () => {
  const dict = new Map([['그는 학교에 갔다', 'He went to school']]);
  const lk = buildLookups(dict);

  assert.equal(lookupAnswer('그는 학교에 갔다', lk), 'He went to school');
  assert.equal(lookupAnswer('He went to school', lk), '그는 학교에 갔다');
});

test('지문에 군더더기가 붙어도 포함 관계로 찾는다', () => {
  const dict = new Map([['나는 배가 고프다', 'I am hungry']]);
  const lk = buildLookups(dict);

  assert.equal(lookupAnswer('빈칸에 알맞은 것은? I am hungry', lk), '나는 배가 고프다');
});

test('못 찾으면 null', () => {
  const dict = new Map([['사과', 'apple']]);
  const lk = buildLookups(dict);

  assert.equal(lookupAnswer('전혀 다른 문장', lk), null);
  assert.equal(lookupAnswer('사과', null), null);
});

// ---------------------------------------------------------------- 클래스 페이지

const unit = (i, name, stages, opts = {}) => ({
  i, name, locked: !!opts.locked, hasTitle: opts.hasTitle !== false, stages,
});
const stage = (key, title, locked = false) => ({ key, title, locked });

test('잠기지 않은 첫 단계를 STAGE_ORDER 순서로 고른다', () => {
  const units = [unit(0, '강조구문', [
    stage('0_1', '연습 문제 A'),
    stage('0_0', '개념 톡'),
    stage('0_2', '연습 문제 B', true),
  ])];
  const act = nextClassAction(units, new Set());
  assert.equal(act.action, 'stage');
  assert.equal(act.stage.title, '개념 톡');
});

test('이미 눌러 본 단계는 건너뛴다', () => {
  const units = [unit(0, '강조구문', [stage('0_0', '개념 톡'), stage('0_1', '연습 문제 A')])];
  const act = nextClassAction(units, new Set(['0_0']));
  assert.equal(act.stage.title, '연습 문제 A');
});

test('잠긴 유닛은 통째로 건너뛴다', () => {
  const units = [
    unit(0, '잠긴 유닛', [stage('0_0', '개념 톡')], { locked: true }),
    unit(1, '열린 유닛', [stage('1_0', '실전 문제')]),
  ];
  const act = nextClassAction(units, new Set());
  assert.equal(act.unit.name, '열린 유닛');
  assert.equal(act.stage.title, '실전 문제');
});

test('단계가 안 보이는 유닛은 먼저 펼친다', () => {
  const units = [unit(0, '접힌 유닛', [])];
  const act = nextClassAction(units, new Set());
  assert.equal(act.action, 'open');
  assert.equal(act.unit.i, 0);
});

test('할 일이 없으면 none', () => {
  const units = [unit(0, '끝난 유닛', [stage('0_0', '개념 톡')])];
  assert.equal(nextClassAction(units, new Set(['0_0'])).action, 'none');
  assert.equal(nextClassAction([], new Set()).action, 'none');
});

test('STAGE_ORDER 에 없는 이름은 뒤로 밀린다', () => {
  const units = [unit(0, 'u', [stage('0_0', '알 수 없는 단계'), stage('0_1', '서술형 문제')])];
  assert.equal(nextClassAction(units, new Set()).stage.title, '서술형 문제');
});

// ---------------------------------------------------------------- 어순 배열

const tile = (i, text, used = false) => ({ index: i, raw: text, norm: N.mnorm(text), used });

test('정답 순서대로 타일을 고른다', () => {
  const tiles = [tile(0, 'nice'), tile(1, 'You'), tile(2, 'look')];
  assert.equal(nextScrambleIndex('You look nice', tiles, []), 1);
  assert.equal(nextScrambleIndex('You look nice', tiles, [1]), 2);
  assert.equal(nextScrambleIndex('You look nice', tiles, [1, 2]), 0);
});

test('문장을 다 만들면 null', () => {
  const tiles = [tile(0, 'You'), tile(1, 'win')];
  assert.equal(nextScrambleIndex('You win', tiles, [0, 1]), null);
});

test('타일에 구두점이 붙어 있어도 찾는다', () => {
  const tiles = [tile(0, 'today.'), tile(1, 'It')];
  assert.equal(nextScrambleIndex('It is today.', tiles, []), 1);
});

test('이미 쓴 타일과 정답을 모를 때', () => {
  const tiles = [tile(0, 'a', true), tile(1, 'b'), tile(2, 'c')];
  assert.equal(nextScrambleIndex(null, tiles, []), 1);       // 안 쓴 첫 타일
  assert.equal(nextScrambleIndex(null, tiles, [1]), 2);
  assert.equal(nextScrambleIndex(null, [tile(0, 'a', true)], []), null);
});

// ---------------------------------------------------------------- 짝맞추기

const cell = (i, text, done = false) => ({ index: i, raw: text, done });

test('아직 안 맞춘 칸끼리 짝을 시도한다', () => {
  const L = [cell(0, 'A'), cell(1, 'B')];
  const R = [cell(0, '가'), cell(1, '나')];
  assert.deepEqual(nextPairAttempt(L, R, new Set()), { left: 0, right: 0 });
  assert.deepEqual(nextPairAttempt(L, R, new Set(['0_0'])), { left: 0, right: 1 });
});

test('맞춘 칸(done)은 건너뛴다', () => {
  const L = [cell(0, 'A', true), cell(1, 'B')];
  const R = [cell(0, '가', true), cell(1, '나')];
  assert.deepEqual(nextPairAttempt(L, R, new Set()), { left: 1, right: 1 });
  assert.equal(nextPairAttempt(L, R, new Set(['1_1'])), null);
});

// ---------------------------------------------------------------- 분류형

const row = (i, text, opts, done = false) => ({
  index: i, text, done,
  options: opts.map((t, j) => ({ index: j, key: `${i}_${j}`, raw: t, norm: N.mnorm(t) })),
});

test('아직 안 푼 줄부터 보기를 고른다', () => {
  const rows = [row(0, 'apple', ['셀 수 있음', '셀 수 없음'], true),
                row(1, 'water', ['셀 수 있음', '셀 수 없음'])];
  assert.deepEqual(nextGroupPick(rows, null, new Map()), { row: 1, option: 0 });
});

test('그 줄에서 틀린 보기는 다시 고르지 않는다', () => {
  const rows = [row(0, 'water', ['셀 수 있음', '셀 수 없음'])];
  const wrong = new Map([[0, new Set([0])]]);
  assert.deepEqual(nextGroupPick(rows, null, wrong), { row: 0, option: 1 });
});

test('정답 문장에 줄 이름과 보기가 있으면 그것을 고른다', () => {
  const rows = [row(0, 'water', ['셀 수 있음', '셀 수 없음'])];
  assert.deepEqual(
    nextGroupPick(rows, 'water 셀 수 없음, apple 셀 수 있음', new Map()),
    { row: 0, option: 1 },
  );
});

test('풀 줄이 없으면 null', () => {
  assert.equal(nextGroupPick([row(0, 'a', ['x', 'y'], true)], null, new Map()), null);
});

// ---------------------------------------------------------------- 빈칸 채우기

test('빈칸이 하나면 정답을 통째로 넣는다', () => {
  assert.deepEqual(fillValues(1, 'It was the man that stole my bag.', ''),
    ['It was the man that stole my bag.']);
});

test('빈칸 수와 정답 단어 수가 같으면 하나씩 나눠 넣는다', () => {
  assert.deepEqual(fillValues(3, 'It is Paul', ''), ['It', 'is', 'Paul']);
});

test('정답 단어가 더 많으면 마지막 칸에 몰아 넣는다', () => {
  assert.deepEqual(fillValues(2, 'It is Paul who', ''), ['It', 'is Paul who']);
});

test('정답을 모르면 화면의 힌트 단어를 순서대로 넣는다', () => {
  assert.deepEqual(fillValues(3, null, 'the, tallest, student, is, who, Paul'),
    ['the', 'tallest', 'student']);
});

test('힌트가 빈칸보다 적으면 남는 칸은 비운다', () => {
  assert.deepEqual(fillValues(3, null, 'a, b'), ['a', 'b', '']);
});

test('정답도 힌트도 없으면 빈 목록', () => {
  assert.deepEqual(fillValues(2, null, ''), []);
  assert.deepEqual(fillValues(0, 'x', 'y'), []);
});
