import test from 'node:test';
import assert from 'node:assert/strict';
import { blitzTutorRequest, validateBlitzTutorResult } from '../blitz-gemini.mjs';
import { QUESTS, TUTORS } from '../quests.mjs';

test('Argon explanations use bounded current-quest context and explicit high-background settings', () => {
  const quest = QUESTS.find(item => item.id === 'fractions');
  const tutor = TUTORS.find(item => item.id === 'pip');
  const request = blitzTutorRequest({ quest, tutor, problem: quest.problems[0], message: 'Why is the bottom number four?' });
  assert.equal(request.model, 'gemini-4-argon');
  assert.equal(request.background, true); assert.equal(request.store, true);
  assert.equal(request.generation_config.thinking_level, 'high');
  assert.equal(request.generation_config.max_output_tokens, 1_000_000);
  assert.match(request.input, /fractions|fraction|equal parts/);
  assert.match(request.input, /Pip/);
  assert.doesNotMatch(request.input, /60 metres|ten willows/);
  assert.match(request.system_instruction, /do not award stars/i);
  assert.equal(request.response_format.schema.additionalProperties, false);
});

test('explanation results cannot carry scores, code or unsupported state fields', () => {
  const good = { feedback: 'Let’s compare equal parts.', explanation: 'Count all four parts first.', checkQuestion: 'How many parts make the whole?' };
  assert.deepEqual(validateBlitzTutorResult(good), good);
  for (const bad of [null, [], { ...good, stars: 3 }, { ...good, explanation: '' }, { ...good, checkQuestion: 1 }, { ...good, feedback: 'x'.repeat(4001) }]) {
    assert.throws(() => validateBlitzTutorResult(bad), /INVALID_BLITZ_TUTOR_RESULT/);
  }
});

test('invalid or oversized learner context is rejected before a provider call', () => {
  assert.throws(() => blitzTutorRequest({ quest: QUESTS[0], tutor: TUTORS[0], problem: QUESTS[0].problems[0], message: 'x'.repeat(2001) }), /INVALID_BLITZ_CONTEXT/);
});
