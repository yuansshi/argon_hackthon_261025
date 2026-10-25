import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cleanProgress, mergeBestStars, starsMarkup, mathVisual, QUEST_IDS } from '../public/blitz-state.js';
import { tutorArtwork } from '../public/tutor-avatar.js';

const read = name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
const [html, css, app] = await Promise.all(['index.html','styles.css','blitz-app.js'].map(read));

test('Blitz home is subject-neutral and only math is advertised as available', () => {
  assert.match(html, /<title>Blitz Learning<\/title>/);
  assert.match(html, /Make your next/);
  assert.match(html, /Science[\s\S]*Coming soon/);
  assert.match(html, /Languages[\s\S]*Coming soon/);
  assert.match(html, /id="how-it-works"/);
  assert.match(html, /id="roadmap"/);
});
test('every controller DOM reference exists exactly once', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of app.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(id), `Missing ${id}`);
});
test('lesson has one input, separated math workspace and tutor rail', () => {
  const lesson = html.split('id="lesson-view"')[1].split('<dialog')[0];
  assert.equal((lesson.match(/<input\b/g) || []).length, 1);
  assert.match(lesson, /class="lesson-board"/);
  assert.match(lesson, /class="tutor-aside"/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 286px/);
  assert.doesNotMatch(css, /\.active-avatar\s*\{[^}]*position:\s*fixed/);
});
test('only aggregate allowlisted best-star counts survive storage', () => {
  assert.deepEqual(cleanProgress({ 'pond-loop': 2, fractions: 8, 'number-patterns': -1, message: 'secret', sessionId:'bearer' }), { 'pond-loop': 2 });
  assert.deepEqual(cleanProgress(null), {});
  assert.deepEqual(cleanProgress([]), {});
  assert.deepEqual(mergeBestStars({ 'pond-loop':3 },'pond-loop',1), {'pond-loop':3});
  assert.deepEqual(mergeBestStars({},'arbitrary',3),{});
  assert.equal((app.match(/localStorage\.setItem/g) || []).length, 1);
  assert.match(app, /localStorage\.setItem\(PROGRESS_KEY, JSON\.stringify\(state\.best\)\)/);
});
test('star renderer clamps counts and renders three symbols', () => {
  assert.equal((starsMarkup(99).match(/class="earned"/g) || []).length, 3);
  assert.equal((starsMarkup(-1).match(/class="earned"/g) || []).length, 0);
  assert.equal((starsMarkup(2).match(/<svg/g) || []).length, 3);
});
test('pond fallback represents authored 60m,36m,48m quantities rather than a fixed ten', () => {
  for (const circumference of [60,36,48]) {
    const gaps = circumference / 6;
    const {markup,description} = mathVisual({type:'pond',circumference,spacing:6,gaps,shrubsPerGap:2});
    assert.equal((markup.match(/data-tree=/g) || []).length,gaps);
    assert.equal((markup.match(/data-shrub=/g) || []).length,gaps*2);
    assert.match(description,new RegExp(`${circumference}-metre`));
  }
  assert.match(app,/visibleShrubs: question\.visual\.shrubsPerGap > 0 \? question\.visual\.shrubsPerGap : 0/);
});
test('fraction visual uses correct authored count and shaded parts', () => {
  const {markup,description} = mathVisual({type:'fraction',parts:8,shaded:3});
  assert.equal((markup.match(/fill="#a691c4"/g) || []).length,3);
  assert.match(description,/3 shaded parts out of 8/);
});
test('equal groups are represented by authored counters', () => {
  const {markup,description}=mathVisual({type:'groups',groups:4,perGroup:3});
  assert.equal((markup.match(/<circle/g) || []).length,12);
  assert.match(description,/4 equal groups, with 3 dots/);
});
test('pattern labels only interpolate finite numbers', () => {
  const {markup}=mathVisual({type:'pattern',sequence:[3,'<script>',null]});
  assert.doesNotMatch(markup,/<script>/);
  assert.match(markup,/>\?<\/text>/);
});
test('original illustrated tutors and static fictional portrait are clearly disclosed', () => {
  for (const id of ['pip','sage','nova']) {
    assert.match(tutorArtwork(id), /original/);
    assert.match(tutorArtwork(id), /<svg/);
  }
  assert.match(tutorArtwork('alex'),/static image/);
  assert.doesNotMatch(app,/new PhotoAvatar/);
  assert.match(app,/tutorId: 'pip'/);
});
test('cloud consent starts unchecked and is explicit for Argon and Live', () => {
  assert.match(app,/\$\('cloud-consent'\)\.checked = false/);
  assert.match(app,/if \(!\$\('cloud-consent'\)\.checked\) return/);
  assert.match(app,/api\('\/api\/blitz\/tutor', \{ sessionId, questionId, message, cloudConsent: true \}/);
  assert.match(app,/questSessionId: state\.session\.sessionId, questionId: state\.question\.id/);
  assert.match(app,/videoConsent: false/);
});
test('Live supports typed learner turns without routing text to numeric grading', () => {
  const submit=app.split('async function checkAnswer')[1].split('async function markHinted')[0];
  assert.match(submit,/if \(state\.connected\)/);
  assert.match(submit,/socketSend\(\{ type: 'text', text: answer \}\)/);
  assert.match(app,/state\.connected \? 'Send to tutor '/);
});
test('a stale Live startup failure cannot clean up a newer conversation', () => {
  const start = app.split('async function startLive()')[1].split('async function handleLive')[0];
  assert.match(start,/catch \(error\) \{\s*if \(epoch !== state\.liveEpoch\) return;\s*await endLive/);
});
test('media is explicitly enabled, bounded, and released on hidden, end, and pagehide', () => {
  assert.match(app,/navigator\.mediaDevices\.getUserMedia\(\{ audio: false/);
  assert.match(app,/await waitCameraConsent\(\)/);
  assert.match(app,/blob\.size > 256\*1024/);
  assert.match(app,/at-state\.lastFrame >= 1100/);
  assert.match(app,/addEventListener\('visibilitychange'/);
  assert.match(app,/addEventListener\('pagehide'/);
  assert.match(app,/track\.stop\(\)/);
  assert.match(app,/!microphone\.enabled &&/);
  assert.match(app,/!state\.cameraStream &&/);
  assert.match(app,/if \(epoch !== state\.liveEpoch \|\| !state\.connecting\) return/);
});
test('AI jobs retain an ID for polling, reject stale results, and never award stars themselves', () => {
  assert.match(app,/state\.resumableJob = \{ id: job\.jobId, sessionId, questionId \}/);
  assert.match(app,/retained\?\.sessionId === sessionId && retained\.questionId === questionId/);
  assert.match(app,/result\.questionId && result\.questionId !== questionId/);
  assert.match(app,/No model response was invented/);
  assert.doesNotMatch(app,/state\.progress\.stars\+\+|state\.progress\.streak\+\+/);
});
test('accessibility includes labels, keyboard focus, reduced motion, and mobile stack', () => {
  assert.match(html,/class="skip-link"/);
  assert.match(html,/<label for="answer-input"/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css,/@media \(max-width: 600px\)/);
  assert.match(css,/\.lesson-layout \{ display: flex; flex-direction: column/);
  assert.match(html,/not judging attention or emotions/);
});
test('all four authored quest identifiers are recognized for aggregate progress', () => {
  assert.deepEqual(QUEST_IDS,['pond-loop','equal-groups','fractions','number-patterns']);
});
