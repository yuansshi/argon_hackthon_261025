import { randomUUID } from 'node:crypto';

// Authored, reviewed problems: the model never decides achievement scores.
const pond = (id, circumference, shrubs = false) => ({
  id, title: circumference === 60 ? 'The original pond' : 'A new practice pond',
  prompt: `A closed pond path is ${circumference} metres around. Trees are planted every 6 metres.${shrubs ? ' There are 2 shrubs in every gap between trees. How many shrubs are there?' : ' How many distinct trees are needed?'}`,
  unit: shrubs ? 'shrubs' : 'trees', answer: circumference / 6 * (shrubs ? 2 : 1),
  hint: shrubs ? 'First count the equal gaps by dividing the path length by 6. Then place two shrubs in every gap.' : 'Divide the distance around the pond by the distance between trees. On a closed loop, the end is the same tree as the start.',
  explanation: `${circumference} ÷ 6 = ${circumference / 6} equal gaps. A closed loop has one distinct tree per gap.${shrubs ? ` With 2 shrubs per gap, ${circumference / 6} × 2 = ${circumference / 3} shrubs.` : ` So there are ${circumference / 6} trees, not ${circumference / 6 + 1}.`}`,
  visual: { type: 'pond', circumference, spacing: 6, gaps: circumference / 6, shrubsPerGap: shrubs ? 2 : 0, nodeId: shrubs ? 'pairs' : 'gaps' },
});
const group = (id, prompt, groups, perGroup, answer, hint, explanation) => ({ id, title: 'Equal groups', prompt, answer, unit: 'items', hint, explanation, visual: { type: 'groups', groups, perGroup } });
const fraction = (id, parts, shaded) => ({ id, title: 'Part of a whole',
  prompt: `One whole is split into ${parts} equal parts, and ${shaded} ${shaded === 1 ? 'part is' : 'parts are'} highlighted. What fraction of the whole is highlighted?`,
  answer: `${shaded}/${parts}`, unit: 'fraction', inputPlaceholder: 'For example, 1/4',
  hint: 'The denominator counts all equal parts. The numerator counts the highlighted parts. Equivalent fractions are accepted.',
  explanation: `${shaded} of the ${parts} equal parts are highlighted, so the fraction is ${shaded}/${parts}.`, visual: { type: 'fraction', parts, shaded } });
const pattern = (id, sequence, answer, rule) => ({ id, title: 'Find the next step',
  prompt: `What number comes next: ${sequence.join(', ')}, …?`, answer, unit: 'number',
  hint: 'Compare each neighboring pair. Does the same addition, subtraction, multiplication or division work every time?',
  explanation: `${rule} The next number is ${answer}.`, visual: { type: 'pattern', sequence: [...sequence, null] } });

export const QUESTS = [
  { id: 'pond-loop', title: 'Around the pond', subtitle: 'Loops, gaps & equal spacing', description: 'Turn a path into equal intervals. Then count trees and shrubs without counting the start twice.', subject: 'math', level: 'Foundation', minutes: 5, icon: 'pond',
    problems: [pond('pond-original-trees', 60), pond('pond-original-shrubs', 60, true), pond('pond-transfer-trees', 36), pond('pond-transfer-shrubs', 36, true), pond('pond-practice-trees', 48), pond('pond-practice-shrubs', 48, true)] },
  { id: 'equal-groups', title: 'Make it equal', subtitle: 'Multiply & divide with groups', description: 'Build and share equal groups, from trays and rows to pairs and packs.', subject: 'math', level: 'Foundation', minutes: 4, icon: 'groups',
    problems: [
      group('groups-trays', 'There are 4 trays with 3 cups on each tray. How many cups are there altogether?', 4, 3, 12, 'Add 3 four times, or multiply the number of trays by the cups on each tray.', '4 equal groups of 3 make 4 × 3 = 12 cups.'),
      group('groups-rows', 'An event has 5 rows of 4 chairs. How many chairs are there?', 5, 4, 20, 'Each row contributes the same number of chairs. Multiply rows by chairs per row.', '5 × 4 = 20 chairs.'),
      group('groups-share', 'Share 18 counters equally between 3 people. How many counters does each person receive?', 3, 6, 6, 'Divide the total counters by the number of people.', '18 ÷ 3 = 6 counters per person. Three groups of 6 return to 18.'),
      group('groups-packs', 'Pack 24 bottles into packs of 4. How many packs can you make?', 6, 4, 6, 'Ask how many groups of 4 fit into 24.', '24 ÷ 4 = 6 packs.'),
      group('groups-pairs', 'A display holds 7 pairs of gloves. How many individual gloves is that?', 7, 2, 14, 'A pair contains two items. Count two for each pair.', '7 × 2 = 14 individual gloves.'),
      group('groups-boxes', 'Share 30 pencils equally between 5 boxes. How many pencils go in each box?', 5, 6, 6, 'Divide the total by the number of equal boxes.', '30 ÷ 5 = 6 pencils in each box.'),
    ] },
  { id: 'fractions', title: 'A piece of the whole', subtitle: 'See fractions, not just symbols', description: 'Connect highlighted equal parts with fraction notation. Equivalent fractions count too.', subject: 'math', level: 'Foundation', minutes: 4, icon: 'fraction',
    problems: [fraction('fraction-quarter', 4, 1), fraction('fraction-eighths', 8, 3), fraction('fraction-half', 6, 3), fraction('fraction-threequarters', 4, 3), fraction('fraction-twothirds', 3, 2), fraction('fraction-fourfifths', 5, 4)] },
  { id: 'number-patterns', title: 'Crack the pattern', subtitle: 'Spot a rule. Predict a step.', description: 'Use evidence from neighboring numbers to find additive and multiplicative patterns.', subject: 'math', level: 'Foundation', minutes: 4, icon: 'pattern',
    problems: [pattern('pattern-add3', [3, 6, 9], 12, 'Add 3 each time: 9 + 3 = 12.'), pattern('pattern-sub3', [20, 17, 14], 11, 'Subtract 3 each time: 14 − 3 = 11.'), pattern('pattern-double', [2, 4, 8], 16, 'Multiply by 2 each time: 8 × 2 = 16.'), pattern('pattern-add5', [5, 10, 15], 20, 'Add 5 each time: 15 + 5 = 20.'), pattern('pattern-add3offset', [1, 4, 7], 10, 'Add 3 each time: 7 + 3 = 10.'), pattern('pattern-half', [32, 16, 8], 4, 'Divide by 2 each time: 8 ÷ 2 = 4.')] },
];

export const TUTORS = [
  { id: 'alex', name: 'Alex', kind: 'human', description: 'A fictional AI presenter. Calm, clear, step by step.', voice: 'Charon', color: '#86bba0', style: 'Warm and measured. Use practical examples and one question at a time. You are an openly fictional synthetic presenter, never a real person.' },
  { id: 'nova', name: 'Nova', kind: 'anime', description: 'An original illustrated explorer with bright, curious energy.', voice: 'Puck', color: '#bb9bfa', style: 'Bright and curious, but not rushed. Use an occasional space-exploration analogy. You are an original fictional illustrated character, not an existing franchise character.' },
  { id: 'pip', name: 'Pip', kind: 'robot', description: 'A friendly robot who turns tricky steps into tiny experiments.', voice: 'Kore', color: '#f7c75d', style: 'Playfully precise. Treat mistakes as experiments. Say one small step, then ask the learner to predict the next. You are an original fictional robot AI tutor.' },
  { id: 'sage', name: 'Sage', kind: 'fox', description: 'A thoughtful fox who gives you room to reason.', voice: 'Fenrir', color: '#f69c73', style: 'Patient and thoughtful. Ask about the reason behind an answer and offer an analogy when useful. You are an original fictional fox AI tutor.' },
];

export class QuestError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const getQuest = id => QUESTS.find(quest => quest.id === id);
export const getTutor = id => TUTORS.find(tutor => tutor.id === id);
export const publicQuest = ({ problems, ...quest }) => ({ ...quest, problemCount: problems.length });
export const publicTutor = ({ style, ...tutor }) => tutor;
export function questCatalog() { return { quests: QUESTS.map(publicQuest), tutors: TUTORS.map(publicTutor) }; }

function issueQuestion(session) { session.questionId = randomUUID(); session.hinted = Boolean(session.coachingActive); }
export function createQuestSession({ questId, tutorId = 'alex', cloudConsent = false }) {
  const quest = getQuest(questId), tutor = getTutor(tutorId);
  if (!quest) throw new QuestError(400, 'Choose a supported math quest.');
  if (!tutor) throw new QuestError(400, 'Choose a supported tutor.');
  const session = { id: randomUUID(), questId, tutorId, cloudConsent: cloudConsent === true, index: 0, streak: 0, bestStreak: 0, correct: 0, answered: 0, usedTokens: new Set(), completed: false, coachingActive: 0, lastSeen: Date.now(), requests: [] };
  issueQuestion(session); return session;
}
export function questProgress(session) {
  return { streak: session.streak, bestStreak: session.bestStreak, stars: Math.min(3, session.bestStreak), answered: session.answered, correct: session.correct, remaining: getQuest(session.questId).problems.length - session.answered, completed: session.completed, threeStarGoalReached: session.bestStreak >= 3 };
}
export function publicQuestion(session) {
  if (session.completed) return null;
  const problem = getQuest(session.questId).problems[session.index];
  return { id: session.questionId, problemId: problem.id, number: session.index + 1, total: getQuest(session.questId).problems.length, title: problem.title, prompt: problem.prompt, unit: problem.unit, inputPlaceholder: problem.inputPlaceholder ?? 'Type your answer', visual: problem.visual, awardEligible: !session.hinted && !session.coachingActive };
}
export function publicQuestSession(session) {
  return { sessionId: session.id, quest: publicQuest(getQuest(session.questId)), tutor: publicTutor(getTutor(session.tutorId)), question: publicQuestion(session), progress: questProgress(session), mode: 'local-practice', provider: 'verified-local' };
}

const WORD_NUMBERS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
function numericValue(answer) {
  let text = answer.toLowerCase().trim().replace(/[.!]$/, '').replace(/^(?:the answer is|it is|there are|there is)\s+/, '');
  text = text.replace(/\s+(?:trees?|shrubs?|cups?|chairs?|counters?|packs?|gloves?|pencils?|bottles?|items?|people|groups?|per person|in each box)$/, '').trim();
  if (Object.hasOwn(WORD_NUMBERS, text)) return WORD_NUMBERS[text];
  const fractionMatch = text.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (fractionMatch && Number(fractionMatch[2]) !== 0) return Number(fractionMatch[1]) / Number(fractionMatch[2]);
  if (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return Number(text);
  const words = { 'one half': .5, 'a half': .5, half: .5, 'one quarter': .25, 'a quarter': .25, 'three quarters': .75, 'two thirds': 2 / 3, 'four fifths': .8 };
  return words[text] ?? null;
}
function activeProblem(session, token) {
  if (typeof token !== 'string' || token !== session.questionId || session.usedTokens.has(token) || session.completed) throw new QuestError(409, 'This question was already answered or is no longer active. Use the current question.');
  return getQuest(session.questId).problems[session.index];
}
export function answerQuest(session, token, answer) {
  const problem = activeProblem(session, token);
  if (typeof answer !== 'string' || !answer.trim() || answer.length > 2000) throw new QuestError(400, 'Enter an answer of 1 to 2000 characters.');
  const value = numericValue(answer), expected = numericValue(String(problem.answer));
  if (value === null || !Number.isFinite(value)) {
    session.streak = 0;
    return { understanding: 'uncertain', correct: null, feedback: 'I cannot verify that answer yet. Try a number or fraction, or ask for a hint. No stars were awarded.', explanation: '', question: publicQuestion(session), nextQuestion: publicQuestion(session), progress: questProgress(session), completed: false, provider: 'verified-local' };
  }
  const question = publicQuestion(session), correct = Math.abs(value - expected) <= 1e-9, coached = session.hinted || session.coachingActive;
  session.usedTokens.add(token); session.answered++;
  if (correct) { session.correct++; session.streak = coached ? 0 : session.streak + 1; session.bestStreak = Math.max(session.bestStreak, session.streak); }
  else session.streak = 0;
  const feedback = correct ? (coached ? 'Correct. This was hinted practice, so no star was awarded.' : session.streak >= 3 ? 'Three distinct correct answers in a row. Three stars earned!' : `Correct. ${session.streak} in a row — keep building your streak.`) : 'Not quite. Your streak resets, but your best stars stay. Review the explanation and try the next problem.';
  session.index++;
  session.completed = session.bestStreak >= 3 || session.index >= getQuest(session.questId).problems.length;
  if (!session.completed) issueQuestion(session);
  return { understanding: correct ? 'correct' : 'incorrect', correct, feedback, explanation: problem.explanation, question, nextQuestion: publicQuestion(session), progress: questProgress(session), completed: session.completed, provider: 'verified-local' };
}
export function hintQuest(session, token) {
  const problem = activeProblem(session, token);
  session.hinted = true; session.streak = 0;
  return { hint: problem.hint, feedback: 'Hinted practice: this problem will not award a star. Your best stars are kept.', question: publicQuestion(session), progress: questProgress(session), provider: 'verified-local' };
}
