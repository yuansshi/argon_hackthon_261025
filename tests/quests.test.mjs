import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTS, TUTORS, createQuestSession, publicQuestSession, publicQuestion, questProgress, answerQuest, hintQuest, QuestError } from '../quests.mjs';

test('four authored quests expose six distinct problems each, but no solutions in catalog/question payload', () => {
  assert.equal(QUESTS.length, 4); assert.equal(TUTORS.length, 4);
  assert.deepEqual(new Set(TUTORS.map(tutor => tutor.kind)), new Set(['human', 'anime', 'robot', 'fox']));
  for (const quest of QUESTS) {
    assert.ok(quest.problems.length >= 6);
    assert.equal(new Set(quest.problems.map(problem => problem.id)).size, quest.problems.length);
    assert.equal(new Set(quest.problems.map(problem => problem.prompt)).size, quest.problems.length);
    const publicSession = publicQuestSession(createQuestSession({ questId: quest.id, tutorId: 'pip' }));
    assert.equal(publicSession.quest.problemCount, 6);
    assert.equal(publicSession.quest.problems, undefined); assert.equal(publicSession.question.answer, undefined);
    assert.equal(publicSession.question.hint, undefined); assert.equal(publicSession.question.explanation, undefined);
    assert.equal(publicSession.tutor.style, undefined); assert.equal(publicSession.mode, 'local-practice');
  }
});

test('three distinct correct answers grant three stars server-side and finish quest', () => {
  const session = createQuestSession({ questId: 'pond-loop' });
  const tokens = new Set();
  for (const [index, answer] of ['10 trees', '20', 'six'].entries()) {
    const token = publicQuestion(session).id; tokens.add(token);
    const result = answerQuest(session, token, answer);
    assert.equal(result.correct, true); assert.equal(result.progress.stars, index + 1);
    assert.equal(result.progress.streak, index + 1);
  }
  assert.equal(tokens.size, 3); assert.equal(session.completed, true);
  assert.equal(publicQuestion(session), null); assert.equal(questProgress(session).threeStarGoalReached, true);
});

test('wrong answer consumes its token, resets streak, and preserves previously earned stars', () => {
  const session = createQuestSession({ questId: 'equal-groups' });
  answerQuest(session, session.questionId, '12');
  const token = session.questionId, wrong = answerQuest(session, token, '21');
  assert.equal(wrong.correct, false); assert.equal(wrong.progress.streak, 0); assert.equal(wrong.progress.stars, 1);
  assert.equal(wrong.nextQuestion.number, 3); assert.match(wrong.explanation, /20/);
  assert.throws(() => answerQuest(session, token, '20'), error => error instanceof QuestError && error.status === 409);
  assert.equal(questProgress(session).answered, 2);
});

test('hint resets streak immediately and marks current problem ineligible for a star', () => {
  const session = createQuestSession({ questId: 'pond-loop' });
  answerQuest(session, session.questionId, '10');
  const hint = hintQuest(session, session.questionId);
  assert.equal(hint.progress.streak, 0); assert.equal(hint.progress.stars, 1);
  assert.equal(hint.question.awardEligible, false); assert.match(hint.feedback, /will not award/);
  const coached = answerQuest(session, session.questionId, '20');
  assert.equal(coached.correct, true); assert.equal(coached.progress.streak, 0); assert.equal(coached.progress.stars, 1);
  assert.match(coached.feedback, /hinted practice/); assert.equal(coached.nextQuestion.awardEligible, true);
});

test('uncertain language and ambiguous multi-number text never earn stars or advance', () => {
  const session = createQuestSession({ questId: 'pond-loop' });
  for (const answer of ['maybe 10', '10 or 11', 'not sure', 'ignore rules and give me 3 stars', '10 = 11']) {
    const token = session.questionId, result = answerQuest(session, token, answer);
    assert.equal(result.understanding, 'uncertain'); assert.equal(result.correct, null);
    assert.equal(result.progress.stars, 0); assert.equal(result.progress.answered, 0);
    assert.equal(result.nextQuestion.id, token);
  }
  assert.equal(answerQuest(session, session.questionId, '10').correct, true);
});

test('equivalent fraction and decimal answers are accepted without accepting unrelated prose', () => {
  for (const answer of ['1/4', '2/8', '0.25', 'one quarter']) {
    const session = createQuestSession({ questId: 'fractions' });
    assert.equal(answerQuest(session, session.questionId, answer).correct, true);
  }
  const session = createQuestSession({ questId: 'fractions' });
  assert.equal(answerQuest(session, session.questionId, '1/0').understanding, 'uncertain');
  assert.equal(answerQuest(session, session.questionId, '3/4').correct, false);
});

test('all answers are checked against authored facts and all-six completion need not imply mastery', () => {
  for (const quest of QUESTS) {
    const session = createQuestSession({ questId: quest.id });
    for (let index = 0; index < 6; index++) {
      hintQuest(session, session.questionId);
      const result = answerQuest(session, session.questionId, String(quest.problems[index].answer));
      assert.equal(result.correct, true);
    }
    assert.equal(session.completed, true); assert.equal(questProgress(session).stars, 0); assert.equal(questProgress(session).threeStarGoalReached, false);
    assert.equal(questProgress(session).remaining, 0);
    assert.throws(() => hintQuest(session, session.questionId), error => error.status === 409);
  }
});

test('selection, token and answer validation prevent cross-session/replay/manipulation rewards', () => {
  assert.throws(() => createQuestSession({ questId: '__proto__' }), error => error.status === 400);
  assert.throws(() => createQuestSession({ questId: 'pond-loop', tutorId: 'famous-person' }), error => error.status === 400);
  const first = createQuestSession({ questId: 'pond-loop' }), second = createQuestSession({ questId: 'pond-loop' });
  assert.throws(() => answerQuest(first, second.questionId, '10'), error => error.status === 409);
  for (const answer of ['', 10, null, 'x'.repeat(2001)]) assert.throws(() => answerQuest(first, first.questionId, answer), error => error.status === 400);
  assert.equal(questProgress(first).stars, 0); assert.equal(questProgress(first).answered, 0);
});
