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
import { pickChoice, lookupAnswer } from '../engine/modules/grammar.js';

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
