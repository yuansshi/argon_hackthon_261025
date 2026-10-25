export const PROGRESS_KEY = 'blitz-learning.best-stars.v1';
export const QUEST_IDS = ['pond-loop', 'equal-groups', 'fractions', 'number-patterns'];
export function cleanProgress(value) {
  const output = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  for (const id of QUEST_IDS) {
    const stars = Number(value[id]);
    if (Number.isInteger(stars) && stars >= 0 && stars <= 3) output[id] = stars;
  }
  return output;
}
export function mergeBestStars(saved, questId, stars) {
  const result = cleanProgress(saved);
  if (QUEST_IDS.includes(questId) && Number.isInteger(stars) && stars >= 0 && stars <= 3) result[questId] = Math.max(result[questId] || 0, stars);
  return result;
}
export function starsMarkup(count = 0) {
  const safe = Math.max(0, Math.min(3, Number(count) || 0));
  return [0, 1, 2].map(index => `<svg viewBox="0 0 24 24" aria-hidden="true"${index < safe ? ' class="earned"' : ''}><path d="m12 2.5 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z"/></svg>`).join('');
}
export function questArtwork(id) {
  if (id === 'pond-loop') return '<svg viewBox="0 0 60 60" aria-hidden="true"><ellipse cx="30" cy="32" rx="21" ry="13" fill="#b9d5d0" stroke="#6a9982" stroke-width="2"/><path d="M12 29V18m36 11V18M26 17V8m13 46V43M10 44V35" stroke="#607e47" stroke-width="3"/><path d="m5 21 7-12 7 12m22 0 7-12 7 12m-36-9 7-11 7 11M32 47l7-11 7 11M3 39l7-11 7 11" fill="#88a86b"/></svg>';
  if (id === 'equal-groups') return '<svg viewBox="0 0 60 60" aria-hidden="true"><g fill="#f4d2af" stroke="#c9864f" stroke-width="1.6"><rect x="5" y="8" width="22" height="20" rx="5"/><rect x="33" y="8" width="22" height="20" rx="5"/><rect x="5" y="33" width="22" height="20" rx="5"/><rect x="33" y="33" width="22" height="20" rx="5"/></g><g fill="#b66f3d"><circle cx="12" cy="18" r="3"/><circle cx="20" cy="18" r="3"/><circle cx="40" cy="18" r="3"/><circle cx="48" cy="18" r="3"/><circle cx="12" cy="43" r="3"/><circle cx="20" cy="43" r="3"/><circle cx="40" cy="43" r="3"/><circle cx="48" cy="43" r="3"/></g></svg>';
  if (id === 'fractions') return '<svg viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="23" fill="#e0d9f0" stroke="#8b78ad" stroke-width="2"/><path d="M30 7a23 23 0 0 1 23 23H30z" fill="#a48bcb"/><path d="M30 7v46M7 30h46" stroke="#fffefa" stroke-width="3"/></svg>';
  return '<svg viewBox="0 0 60 60" aria-hidden="true"><path d="M7 48h10V36h10V24h10V12h15" fill="none" stroke="#c49536" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="29" r="4" fill="#d8b45e"/><circle cx="30" cy="12" r="4" fill="#dfbf76"/><path d="m43 8 10 4-5 9" fill="none" stroke="#c49536" stroke-width="3" stroke-linecap="round"/></svg>';
}

const bounded = (value, min, max) => Math.max(min, Math.min(max, Number(value) || min));
export function mathVisual(visual = {}) {
  const frame = content => `<svg viewBox="0 0 600 230" role="img" aria-label="${description}">${content}</svg>`;
  let description = '', content = '';
  if (visual.type === 'groups') {
    const groups = Math.round(bounded(visual.groups, 1, 8)), perGroup = Math.round(bounded(visual.perGroup, 1, 9));
    description = `${groups} equal groups, with ${perGroup} dots in each group.`;
    const columns = Math.min(groups, 4), rows = Math.ceil(groups / columns), w = Math.min(118, 540 / columns), h = rows > 1 ? 92 : 135;
    for (let group = 0; group < groups; group++) {
      const x = 300 - columns * w / 2 + (group % columns) * w + 5, y = (230 - rows * h) / 2 + Math.floor(group / columns) * h + 5;
      content += `<rect x="${x}" y="${y}" width="${w - 10}" height="${h - 10}" rx="13" fill="#f9e8d8" stroke="#c89d78" stroke-width="1.5"/>`;
      for (let dot = 0; dot < perGroup; dot++) {
        const dc = Math.min(3, perGroup), dr = Math.ceil(perGroup / dc);
        content += `<circle cx="${x + (w - 10) / 2 + (dot % dc - (dc - 1) / 2) * 23}" cy="${y + (h - 10) / 2 + (Math.floor(dot / dc) - (dr - 1) / 2) * 23}" r="7" fill="#c67c48"/>`;
      }
    }
  } else if (visual.type === 'fraction') {
    const parts = Math.round(bounded(visual.parts, 2, 12)), shaded = Math.round(bounded(visual.shaded, 0, parts));
    description = `${shaded} shaded ${shaded === 1 ? 'part' : 'parts'} out of ${parts} equal parts. Count the whole before naming a fraction.`;
    const x0 = 55, width = 490 / parts;
    for (let i = 0; i < parts; i++) content += `<rect x="${x0 + i * width}" y="57" width="${width}" height="111" fill="${i < shaded ? '#a691c4' : '#ece7f3'}" stroke="#fffefa" stroke-width="4"/>`;
    content += '<rect x="55" y="57" width="490" height="111" fill="none" stroke="#8c76a9" stroke-width="2" rx="5"/>';
  } else if (visual.type === 'pattern') {
    const sequence = (Array.isArray(visual.sequence) ? visual.sequence : [3,6,9,null]).slice(0, 7);
    const width = Math.min(90, 510 / Math.max(1,sequence.length)), left = 300 - sequence.length * width / 2;
    description = `Number pattern: ${sequence.map(value => value === null ? 'missing number' : Number.isFinite(Number(value)) ? Number(value) : '?').join(', ')}.`;
    sequence.forEach((value, index) => { const safeValue = value === null ? '?' : String(Number.isFinite(Number(value)) ? Number(value) : '?'); content += `<rect x="${left + index * width + 5}" y="65" width="${width - 10}" height="92" rx="12" fill="${value === null ? '#f4e5bf' : '#f8f3e6'}" stroke="${value === null ? '#b18730' : '#d9cba3'}" stroke-width="2"${value === null ? ' stroke-dasharray="5 4"' : ''}/><text x="${left + index * width + width / 2}" y="123" text-anchor="middle" font-family="Georgia,serif" font-size="34" fill="#735827">${safeValue}</text>`; });
  } else {
    description = 'A circular pond with trees equally spaced around its bank.';
    content = '<ellipse cx="300" cy="115" rx="145" ry="78" fill="#bcd7d0" stroke="#7b9e88" stroke-width="4"/>';
    const count = Math.round(bounded(visual.gaps || Number(visual.circumference) / Number(visual.spacing), 3, 24));
    const shrubs = Math.round(bounded(visual.shrubsPerGap, 0, 3));
    for (let i = 0; i < count; i++) {
      const a = i * Math.PI * 2 - Math.PI / 2, x = 300 + Math.cos(a) * 155, y = 115 + Math.sin(a) * 80;
      content += `<g data-tree="${i}"><path d="M${x} ${y + 8}v-20" stroke="#756144" stroke-width="4"/><path d="m${x - 13} ${y - 6} 13-24 13 24z" fill="#7e9f64"/></g>`;
      for (let s = 1; s <= shrubs; s++) { const angle = (i + s / (shrubs + 1)) * Math.PI * 2 / count - Math.PI / 2; content += `<circle data-shrub="${i}-${s}" cx="${300 + Math.cos(angle) * 155}" cy="${115 + Math.sin(angle) * 80}" r="5" fill="#426d52"/>`; }
    }
    description = `A ${Number(visual.circumference) || 60}-metre circular pond. Trees are equally spaced ${Number(visual.spacing) || 6} metres apart.${shrubs ? ' Shrubs fill each gap between trees.' : ''}`;
  }
  return { markup: frame(content), description };
}
