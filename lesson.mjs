/** Adult foundational-math case study, adapted from the supplied lesson. */
export const LESSON = {
  id: 'closed-loop-landscaping',
  title: 'A landscaping plan: intervals around a closed loop',
  audience: 'Adults aged 18 and over reviewing foundational mathematics',
  description: 'Work through a landscaping estimate, explain your reasoning, and test the same method on a different loop. No time limit: ask for another explanation whenever you need one.',
  sourceVideo: '/media/source.mp4',
  nodes: [
    {
      id: 'situation',
      title: 'Read the landscaping specification',
      objective: 'Separate the quantities supplied from the quantity requested.',
      narration: 'Consider a landscaping estimate for a circular fishpond in a forest park. Its circumference—the distance all the way around—is 60 metres. A willow is planted every 6 metres along the curved bank. Two oleander shrubs are planted evenly inside every gap between neighbouring willows. We need the total number of shrubs, not the number of willows. First, identify what the estimate asks you to count.',
      caption: '60 m around the bank · 6 m between willows · 2 shrubs inside each gap. Find the shrubs.',
      revealNarration: 'The requested estimate is the number of oleander shrubs. The 60-metre circumference is the total distance around the circular fishpond. The willows, spaced every 6 metres along the curved bank, mark the gaps. Two shrubs sit evenly inside each gap. Keep those quantities separate as we build the estimate.',
      revealCaption: 'Find oleander shrubs. Use the circumference and willow spacing to find the groups that hold them.',
      diagram: { mode: 'overview', gaps: 10, trees: 10, shrubsPerGap: 2 },
      checkpoint: {
        prompt: 'Which quantity must the final answer give?',
        choices: [
          { id: 'willows', label: 'The number of willow trees' },
          { id: 'shrubs', label: 'The number of oleander shrubs' },
          { id: 'metres', label: 'The length of the bank in metres' },
        ],
        correctChoiceId: 'shrubs',
        acceptedAnswers: ['shrubs', 'oleander shrubs', 'the number of shrubs', 'the number of oleander shrubs'],
        explanation: 'The question asks for oleander shrubs. The circumference and willow spacing help us find the gaps that hold those shrubs.',
        misconceptions: {
          willows: { code: 'counting-wrong-plant', explanation: 'The willows mark the gap boundaries. The requested estimate is for the smaller oleander shrubs inside those gaps.' },
          metres: { code: 'length-versus-count', explanation: 'The 60 metres is already known. It is a length used to calculate a plant count; the final answer needs units of shrubs.' },
        },
      },
      sourceSceneIds: [1, 2, 3],
    },
    {
      id: 'gaps',
      title: 'Partition the circumference',
      objective: 'Use total length divided by interval length to count intervals.',
      narration: 'A gap, or interval, follows the curved bank from one willow to its neighbour. It measures 6 metres along that curve, not across the pond. How many equal 6-metre sections fit into 60 metres? You can add six repeatedly until you reach the total, or divide the total length by the length of one gap. Take your time and predict the number of gaps before checking the explanation.',
      caption: '60 m ÷ 6 m per gap = ? gaps. Measure along the curve.',
      revealNarration: 'A gap, or interval, follows the curved bank from one willow to its neighbour. It measures 6 metres along that curve, not across the pond. Ten equal 6-metre sections fit into 60 metres. You can add six repeatedly, or divide: 60 divided by 6 equals 10 gaps. The units help: metres divided by metres per gap gives a number of gaps.',
      revealCaption: '60 m ÷ 6 m per gap = 10 gaps. Measure along the curve.',
      diagram: { mode: 'gaps', gaps: 10, trees: 10, shrubsPerGap: 2 },
      checkpoint: {
        prompt: 'How many 6-metre gaps make the 60-metre loop?',
        choices: [
          { id: '6', label: '6 gaps' },
          { id: '60', label: '60 gaps' },
          { id: '10', label: '10 gaps' },
        ],
        correctChoiceId: '10',
        acceptedAnswers: ['10', 'ten', '10 gaps', 'ten gaps', '10 intervals', '60 / 6 = 10', '60 ÷ 6 = 10'],
        explanation: 'Ten sections of 6 metres cover 60 metres: 6 + 6 + 6 + 6 + 6 + 6 + 6 + 6 + 6 + 6 = 60. Therefore 60 ÷ 6 = 10 gaps.',
        misconceptions: {
          '6': { code: 'interval-length-versus-count', explanation: 'Six is the length of one gap in metres. The count of gaps is the total length, 60, divided by that length, 6.' },
          '60': { code: 'total-length-versus-count', explanation: 'Sixty counts metres, not gaps. Each gap uses 6 metres, so group the 60 metres into sections of 6.' },
        },
      },
      sourceSceneIds: [4, 5],
    },
    {
      id: 'closure',
      title: 'Do not count the start twice',
      objective: 'Explain why a closed loop has as many boundary trees as gaps.',
      narration: 'We have found ten gaps around the loop. Place Willow 1 at the starting marker and imagine walking clockwise, planting a willow at each new endpoint. Pay special attention to the final gap: it returns to the starting marker. Is that endpoint new, or is a willow already there? Predict how many distinct willows mark the complete loop. Count each physical tree only once.',
      caption: '10 gaps around a closed loop = ? distinct willows. Inspect the final endpoint.',
      revealNarration: 'Place Willow 1 at the starting marker. Walk clockwise through nine gaps, planting a willow at each new endpoint. You now have ten willows, with one gap left to walk. The tenth gap returns to Willow 1, which is already planted. There is no new endpoint and no eleventh willow. For this closed loop, 10 gaps correspond to 10 willows. A straight row with both ends planted is different: it would have one more tree than gaps.',
      revealCaption: 'The tenth gap returns to Willow 1. Closed loop: 10 gaps = 10 willows.',
      requiresExplanation: true,
      explanationPrompt: 'Why does completing the last gap not require one more willow? Explain what happens at its endpoint.',
      explanationCriteria: [
        'The last gap returns to the same Willow 1, so its endpoint is not a new tree and must not be counted again.',
      ],
      diagram: { mode: 'closure', gaps: 10, trees: 10, shrubsPerGap: 2 },
      checkpoint: {
        prompt: 'Ten gaps complete the loop. How many distinct willow trees mark them?',
        choices: [
          { id: '11', label: '11 willows' },
          { id: '10', label: '10 willows' },
          { id: '9', label: '9 willows' },
        ],
        correctChoiceId: '10',
        acceptedAnswers: ['10', 'ten', '10 willows', 'ten willows', '10 trees', 'ten trees'],
        explanation: 'There are 10 distinct willows. Gap 10 ends at Willow 1, so counting its endpoint again would count the same tree twice.',
        misconceptions: {
          '11': { code: 'open-row-endpoint-rule', explanation: 'Eleven would apply to ten gaps in an open row with both ends planted. Here the last endpoint is the starting willow, not a new tree.' },
          '9': { code: 'omitting-closing-interval', explanation: 'Nine gaps take you from Willow 1 to Willow 10. The tenth gap returns to Willow 1; closing the loop removes no willow.' },
        },
      },
      sourceSceneIds: [6, 7],
    },
    {
      id: 'pairs',
      title: 'Turn gaps into a shrub estimate',
      objective: 'Multiply a number of equal groups by the number in each group.',
      narration: 'Every one of the ten gaps contains two shrubs, evenly spaced inside it. We need to count the shrubs, not just the groups. Try counting by twos for each gap, adding 2 ten times, or multiplying the number of gaps by the shrubs per gap. Work out the total in whichever way makes the groups clearest to you, then give your estimate.',
      caption: '10 equal groups × 2 shrubs per group = ? shrubs. You can count, add, or multiply.',
      revealNarration: 'Every one of the ten gaps contains two shrubs, evenly spaced inside it. Count ten pairs: 2, 4, 6, 8, 10, 12, 14, 16, 18, 20. This is repeated addition: add 2 ten times. Multiplication records the same calculation as 10 times 2 equals 20 shrubs. You can also use place value. One times two is two: 1 × 2 = 2. So one ten times two is two tens, or twenty. Each of two counting groups holds ten shrubs, so two tens make twenty.',
      revealCaption: '10 equal groups × 2 shrubs per group = 20 shrubs. Ten additions of 2 give the same total.',
      diagram: { mode: 'pairs', gaps: 10, trees: 10, shrubsPerGap: 2 },
      checkpoint: {
        prompt: 'There are 10 gaps with 2 shrubs inside each gap. How many shrubs are required?',
        choices: [
          { id: '20', label: '20 shrubs' },
          { id: '10', label: '10 shrubs' },
          { id: '22', label: '22 shrubs' },
        ],
        correctChoiceId: '20',
        acceptedAnswers: ['20', 'twenty', '20 shrubs', 'twenty shrubs', '10 × 2 = 20', '10 * 2 = 20', '10 x 2 = 20'],
        explanation: 'Each of the 10 gaps contributes 2 shrubs, so 10 × 2 = 20. Repeated addition gives the same result: ten pairs make two tens.',
        misconceptions: {
          '10': { code: 'groups-versus-items', explanation: 'Ten is the number of gaps, or groups. Each group contains two shrubs, so double the number of groups to count the shrubs.' },
          '22': { code: 'extra-closing-group', explanation: 'Twenty-two counts eleven pairs. There are only ten gaps: the closing gap is included in those ten, not an extra gap.' },
        },
      },
      sourceSceneIds: [8, 9],
    },
    {
      id: 'transfer',
      title: 'Test the rule on a new plan',
      objective: 'Transfer the method to explicit new dimensions without carrying over old numbers.',
      narration: 'The same closed-loop counting rule can apply to a square, triangle, or rectangle when the perimeter can be partitioned into the stated equal intervals. The shape alone does not tell us its perimeter or spacing. Here is a separate estimate: a closed path has a perimeter of 36 metres, a willow every 6 metres along the path, and two shrubs inside each gap. Use the new total length, not the pond’s 60 metres. Find the gaps first, then the shrubs.',
      caption: 'New plan: 36 m ÷ 6 m per gap = ? gaps; ? gaps × 2 shrubs per gap = ? shrubs.',
      revealNarration: 'The same closed-loop counting rule can apply to a square, triangle, or rectangle when the perimeter can be partitioned into the stated equal intervals. The shape alone does not tell us its perimeter or spacing. For this separate 36-metre loop, 36 divided by 6 gives 6 gaps. With two shrubs inside each gap, 6 times 2 gives 12 shrubs. The method stays the same, but the original pond’s 60-metre circumference does not carry over.',
      revealCaption: 'New plan: 36 ÷ 6 = 6 gaps; 6 × 2 = 12 shrubs. New dimensions, same method.',
      diagram: { mode: 'transfer', gaps: 6, trees: 6, shrubsPerGap: 2 },
      checkpoint: {
        prompt: 'A separate 36-metre closed loop has a willow every 6 metres and 2 shrubs in each gap. How many shrubs are needed?',
        choices: [
          { id: '14', label: '14 shrubs' },
          { id: '20', label: '20 shrubs' },
          { id: '12', label: '12 shrubs' },
        ],
        correctChoiceId: '12',
        acceptedAnswers: ['12', 'twelve', '12 shrubs', 'twelve shrubs', '36 / 6 * 2 = 12', '36 ÷ 6 × 2 = 12'],
        explanation: 'For this new plan, 36 ÷ 6 = 6 gaps. Six pairs give 6 × 2 = 12 shrubs. The closed-loop rule stays the same; the dimensions change.',
        misconceptions: {
          '14': { code: 'open-row-endpoint-rule', explanation: 'Fourteen uses seven pairs. This closed loop has 36 ÷ 6 = 6 gaps, including the closing gap, so it needs six pairs.' },
          '20': { code: 'carrying-over-old-dimensions', explanation: 'Twenty was the estimate for the 60-metre pond. This separate path is 36 metres long, so calculate its gaps again: 36 ÷ 6 = 6.' },
        },
      },
      sourceSceneIds: [11],
    },
    {
      id: 'solution',
      title: 'Check the closing gap and write the estimate',
      objective: 'Explain and verify the full two-step solution.',
      narration: 'Return to the original 60-metre pond, with a willow every 6 metres and two shrubs inside each gap. Explain the solution as if you were checking a landscaping estimate for a colleague. Which calculation finds the gaps, and which counts the shrubs inside them? Check that the closing gap is included without counting the starting willow twice. Choose the calculation that matches your reasoning, or explain the two steps in your own words.',
      caption: 'Teach it back: find the gaps → count the shrubs. Include the closing gap exactly once.',
      revealNarration: 'Return to the original 60-metre pond. The closing gap between Willow 10 and Willow 1 still needs its pair: shrubs 19 and 20. Nothing is left out, and the starting willow is not counted twice. Write the estimate in two steps. First, 60 divided by 6 equals 10 gaps. Second, 10 times 2 equals 20 shrubs. Division finds the equal intervals; multiplication counts the shrubs in those intervals. The answer is 20 oleander shrubs. You can explain these two steps in your own words or return to the diagram to count.',
      revealCaption: 'Original plan: 60 ÷ 6 = 10 gaps; 10 × 2 = 20 shrubs. Closing gap contains shrubs 19 and 20.',
      requiresExplanation: true,
      explanationPrompt: 'Explain what 60 ÷ 6 counts, why you then multiply by 2, and how the closing gap is included.',
      explanationCriteria: [
        '60 ÷ 6 counts the equal intervals around the pond, giving 10 intervals.',
        '10 × 2 counts the two shrubs inside each of those 10 intervals, giving 20 shrubs.',
        'The closing pair is included in the 10 intervals; no extra interval is added when the loop returns to the start.',
      ],
      diagram: { mode: 'solution', gaps: 10, trees: 10, shrubsPerGap: 2 },
      checkpoint: {
        prompt: 'Which calculation correctly solves the original pond estimate?',
        choices: [
          { id: 'plus-one', label: '(60 ÷ 6 + 1) × 2 = 22 shrubs' },
          { id: 'divide-then-multiply', label: '60 ÷ 6 = 10 gaps; 10 × 2 = 20 shrubs' },
          { id: 'total-only', label: '60 ÷ 6 = 10 shrubs' },
        ],
        correctChoiceId: 'divide-then-multiply',
        acceptedAnswers: ['60 ÷ 6 = 10 gaps; 10 × 2 = 20 shrubs', '60 / 6 = 10 gaps; 10 * 2 = 20 shrubs', '(60 / 6) * 2 = 20', '(60 ÷ 6) × 2 = 20'],
        explanation: 'First find 10 intervals with 60 ÷ 6. Then count two shrubs per interval with 10 × 2 = 20. This includes the closing pair, shrubs 19 and 20.',
        misconceptions: {
          'plus-one': { code: 'extra-closing-group', explanation: 'Do not add an interval at the start. The ten calculated intervals already include the closing gap, so adding one creates a pair that does not belong.' },
          'total-only': { code: 'groups-versus-items', explanation: 'The first division finds gaps, not shrubs. Complete the estimate by multiplying the 10 gaps by 2 shrubs per gap.' },
        },
      },
      sourceSceneIds: [10, 12],
    },
  ],
  coverage: [
    'Circular fishpond in a forest park; circumference is the total 60-metre distance around its boundary.',
    'Willows are spaced 6 metres apart measured along the curved bank, not across the pond.',
    'Two evenly spaced oleander shrubs sit inside each interval; the requested count is shrubs, not willows.',
    '60 ÷ 6 = 10 equal gaps, understood through partitioning and repeated addition as well as division.',
    'Starting at Willow 1, nine intervals reach Willow 10; the tenth interval returns to Willow 1 without an eleventh tree.',
    'A closed loop has matching counts of distinct boundary trees and intervals; an open row with both ends planted differs.',
    'Ten pairs count by twos to twenty; ten additions of 2 and 10 × 2 = 20 describe the same groups.',
    'Place value explains the product: one ten times two is two tens, or twenty.',
    'Shrubs 19 and 20 occupy the closing gap between Willow 10 and Willow 1.',
    'Full solution: 60 ÷ 6 = 10 gaps, then 10 × 2 = 20 oleander shrubs.',
    'Closed square, triangle, and rectangle loops share the counting rule without inheriting the original dimensions; intervals must partition the perimeter.',
    'An explicit new 36-metre loop with 6-metre intervals and two shrubs per gap needs 12 shrubs.',
  ],
};

export function getNode(id) {
  return LESSON.nodes.find(node => node.id === id);
}

function normalise(value) {
  return String(value).normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.!?]+$/u, '').trim();
}

/**
 * Only exact choices and curated complete answers are graded locally.
 * A sentence containing the right number is not evidence of understanding.
 * Open explanations remain uncertain so a tutor can ask a follow-up.
 */
export function assessAnswer(nodeId, answer) {
  const node = getNode(nodeId);
  if (!node) throw new RangeError(`Unknown lesson node: ${nodeId}`);
  if (typeof answer !== 'string' && typeof answer !== 'number') {
    return { understanding: 'uncertain', misconception: null, explanation: 'Choose an answer or describe your reasoning so we can check it together.' };
  }
  const text = normalise(answer);
  const checkpoint = node.checkpoint;
  const choice = checkpoint.choices.find(candidate => normalise(candidate.id) === text || normalise(candidate.label) === text);
  if (choice) {
    if (choice.id === checkpoint.correctChoiceId) {
      return { understanding: 'correct', misconception: null, explanation: checkpoint.explanation };
    }
    const misconception = checkpoint.misconceptions[choice.id];
    return { understanding: 'incorrect', misconception: misconception?.code ?? null, explanation: misconception?.explanation ?? 'Revisit the quantities in the question, then try again.' };
  }
  if (checkpoint.acceptedAnswers.some(accepted => normalise(accepted) === text)) {
    return { understanding: 'correct', misconception: null, explanation: checkpoint.explanation };
  }
  // A bare numeric response can be judged without interpreting a free explanation.
  if (/^[+-]?\d+(?:\.\d+)?$/u.test(text)) {
    return { understanding: 'incorrect', misconception: null, explanation: 'That number does not match this checkpoint. Explain how you calculated it, or revisit the diagram and try again.' };
  }
  return { understanding: 'uncertain', misconception: null, explanation: 'Let’s check your reasoning rather than guess from a number in your sentence. Which step did you use, and what does its result count?' };
}
