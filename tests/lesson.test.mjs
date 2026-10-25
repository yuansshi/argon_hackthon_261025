import test from 'node:test';
import assert from 'node:assert/strict';
import { LESSON, getNode, assessAnswer } from '../lesson.mjs';

test('lesson has six adult case-study nodes and complete source coverage', () => {
  assert.deepEqual(LESSON.nodes.map(node => node.id), ['situation', 'gaps', 'closure', 'pairs', 'transfer', 'solution']);
  assert.match(LESSON.audience, /Adults aged 18/);
  assert.equal(LESSON.sourceVideo, '/media/source.mp4');
  assert.deepEqual([...new Set(LESSON.nodes.flatMap(node => node.sourceSceneIds))].sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.ok(LESSON.coverage.length >= 12);
});

test('every node satisfies the UI and assessment contract', () => {
  for (const node of LESSON.nodes) {
    for (const key of ['id', 'title', 'objective', 'narration', 'caption', 'revealNarration', 'revealCaption']) assert.ok(node[key].length > 0);
    assert.equal(node.diagram.mode, node.id === 'situation' ? 'overview' : node.id);
    assert.equal(node.diagram.gaps, node.diagram.trees);
    assert.equal(node.diagram.shrubsPerGap, 2);
    assert.ok(node.checkpoint.choices.some(choice => choice.id === node.checkpoint.correctChoiceId));
    assert.equal(new Set(node.checkpoint.choices.map(choice => choice.id)).size, node.checkpoint.choices.length);
    for (const choice of node.checkpoint.choices) {
      if (choice.id !== node.checkpoint.correctChoiceId) assert.ok(node.checkpoint.misconceptions[choice.id]);
    }
  }
});

test('original problem and explicit transfer example retain the required quantities', () => {
  assert.equal(getNode('transfer').diagram.gaps, 6);
  for (const node of LESSON.nodes.filter(node => node.id !== 'transfer')) assert.equal(node.diagram.gaps, 10);
  assert.match(getNode('situation').narration, /60 metres/);
  assert.match(getNode('situation').narration, /every 6 metres along the curved bank/);
  assert.match(getNode('closure').revealNarration, /no eleventh willow/);
  assert.match(getNode('pairs').revealNarration, /one ten times two is two tens/);
  assert.match(getNode('pairs').revealNarration, /1 × 2 = 2/);
  assert.match(getNode('solution').revealNarration, /shrubs 19 and 20/);
  assert.match(getNode('transfer').narration, /36 metres/);
  assert.match(getNode('transfer').narration, /shape alone does not tell us its perimeter or spacing/);
  assert.match(getNode('transfer').revealNarration, /6 times 2 gives 12 shrubs/);
});

test('prediction copy does not announce checkpoint results before an attempt', () => {
  const checks = [
    ['gaps', /(?:10|ten) (?:gaps|equal|sections)|equals 10/iu],
    ['closure', /(?:10|ten) (?:distinct )?willows|no eleventh|one more tree than gaps/iu],
    ['pairs', /(?:20|twenty)|two tens/iu],
    ['transfer', /(?:12|twelve) shrubs|(?:6|six) gaps/iu],
    ['solution', /(?:20|twenty)|(?:10|ten) gaps/iu],
  ];
  for (const [id, answerPattern] of checks) {
    const node = getNode(id);
    assert.doesNotMatch(`${node.narration} ${node.caption}`, answerPattern, id);
  }
  assert.match(getNode('gaps').caption, /= \? gaps/);
  assert.match(getNode('pairs').caption, /= \? shrubs/);
  assert.match(getNode('transfer').caption, /= \? gaps/);
  assert.match(getNode('gaps').revealCaption, /= 10 gaps/);
  assert.match(getNode('pairs').revealCaption, /= 20 shrubs/);
  assert.match(getNode('transfer').revealCaption, /= 12 shrubs/);
});

test('closure and final solution require an actual explanation in addition to a choice', () => {
  assert.deepEqual(LESSON.nodes.filter(node => node.requiresExplanation).map(node => node.id), ['closure', 'solution']);
  for (const id of ['closure', 'solution']) {
    const node = getNode(id);
    assert.ok(node.explanationPrompt.length > 30);
    assert.ok(node.explanationCriteria.length > 0);
    assert.ok(node.explanationCriteria.every(criterion => typeof criterion === 'string' && criterion.length > 30));
  }
  assert.match(getNode('closure').explanationCriteria.join(' '), /same Willow 1/);
  assert.match(getNode('solution').explanationCriteria.join(' '), /60 ÷ 6 counts/);
  assert.match(getNode('solution').explanationCriteria.join(' '), /10 × 2 counts/);
  assert.match(getNode('solution').explanationCriteria.join(' '), /closing pair/);
});

test('correct choices, complete labels, and curated answers are accepted', () => {
  for (const node of LESSON.nodes) {
    const correct = node.checkpoint.choices.find(choice => choice.id === node.checkpoint.correctChoiceId);
    for (const answer of [correct.id, correct.label, ...node.checkpoint.acceptedAnswers]) {
      assert.equal(assessAnswer(node.id, answer).understanding, 'correct', `${node.id}: ${answer}`);
    }
  }
  assert.equal(assessAnswer('gaps', 10).understanding, 'correct');
  assert.equal(assessAnswer('pairs', '  TWENTY SHRUBS.  ').understanding, 'correct');
});

test('wrong choices return misconception-specific explanations', () => {
  for (const node of LESSON.nodes) {
    for (const choice of node.checkpoint.choices.filter(choice => choice.id !== node.checkpoint.correctChoiceId)) {
      const result = assessAnswer(node.id, choice.id);
      assert.equal(result.understanding, 'incorrect');
      assert.equal(result.misconception, node.checkpoint.misconceptions[choice.id].code);
      assert.ok(result.explanation.length > 20);
      assert.equal(assessAnswer(node.id, choice.label).understanding, 'incorrect');
    }
  }
});

test('negations and contradictory sentences never pass through number matching', () => {
  const cases = [
    ['gaps', 'not 10'], ['gaps', '10 or 11'], ['gaps', '10 gaps but actually 11'],
    ['closure', 'not ten trees'], ['closure', 'there are 10 and 11 willows'],
    ['pairs', '20, no, 22'], ['pairs', 'not 20 shrubs'], ['pairs', 'I got 10 × 2 = 20 but 22 is my answer'],
    ['transfer', '12 or 20'], ['transfer', 'not twelve'],
    ['situation', 'not shrubs'], ['solution', 'not divide-then-multiply'],
  ];
  for (const [id, answer] of cases) assert.notEqual(assessAnswer(id, answer).understanding, 'correct', `${id}: ${answer}`);
});

test('unrecognised explanations stay uncertain rather than being falsely graded', () => {
  assert.equal(assessAnswer('closure', 'The last endpoint is already occupied by the first tree.').understanding, 'uncertain');
  for (const answer of [null, undefined, {}, [], true, '']) assert.equal(assessAnswer('gaps', answer).understanding, 'uncertain');
  assert.equal(assessAnswer('gaps', '8').understanding, 'incorrect');
  assert.equal(assessAnswer('pairs', 19).understanding, 'incorrect');
  assert.equal(getNode('missing'), undefined);
  assert.throws(() => assessAnswer('missing', '10'), RangeError);
});
