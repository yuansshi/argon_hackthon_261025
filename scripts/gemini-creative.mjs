#!/usr/bin/env node
// Explicit project credential only. Never log provider exception bodies or keys.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { loadProjectCredential } from '../credentials.mjs';
import { extractAudio } from '../gemini.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, '.runtime');
const projectCredentialFile = process.env.PROJECT_GEMINI_CREDENTIAL_FILE;
const argon = 'gemini-4-argon';
const tts = 'gemini-3.8-flash-lite-tts';
const prompt = `Act as the product designer and hackathon demo writer for Blitz Learning.
Give a concise actionable UI design AND an honest 125–135-word 60-second narration, as JSON only.
The app converts passive video watching into active math practice. Its subject-neutral front door
will later cover many subjects, but only math is playable now; other subjects must say Coming soon.
People choose a math quest, a problem, and an original clearly nonhuman tutor (robot, fox,
or fantasy creature). Do not propose a live humanlike or human anime agent. A human portrait can
only be static decoration. Use no copyrighted franchises. A local deterministic checker is the
authority on numeric answers. Three consecutive correct fresh questions earn three stars;
one and two correct yield one and two stars. A wrong attempt resets the streak, not best stars.
Give an intentional modern, delightful editorial visual direction, not a generic purple AI dashboard.
Preserve the math question's visual priority; the tutor must never overlap the prompt or diagram.
No facial emotion, attention, identity, age, disability, or understanding inference. Optional camera
is for learner-shared written work, with explicit opt-in. Re-engagement is based on explicit check-ins,
answers and inactivity, never a claim that facial appearance proves attention or understanding.
The engineering prototype is being implemented now; do not claim proven gains or a production service.
Gemini 4 Argon provides reasoning/explanations, and Gemini Live supports optional spoken multimodal
discussion. AI explanation failure must not invent grades or award stars. Local practice works offline.
The 60-second video will show REAL captured app screens and controlled local practice, then Gemini
architecture and an honest roadmap. Do not imply the screen capture itself demonstrates live AI.
The roadmap includes more subjects, evaluation of learning outcomes, deployment/privacy hardening,
and opt-in re-engagement checks (NOT face-based attention detection).
Return this JSON shape:
{"design":{"concept":"...","palette":{"background":"#...","ink":"#...","accent":"#..."},
"typography":"...","homeLayout":["..."],"learningLayout":["..."],"questRewards":"...",
"tutorDirection":"...","accessibility":["..."],"microcopy":{"hero":"...","subhead":"..."}},
"demo":{"narration":"125–135 spoken words; warm clear English; no markdown",
"beats":[{"start":0,"end":8,"screen":"...","message":"..."}],"claimsToAvoid":["..."]}}
Keep the design under 450 words. Timed beats cover exactly 0–60 seconds with no gaps.`;

function allText(interaction) {
  return (interaction.steps ?? []).filter(step => step.type === 'model_output')
    .flatMap(step => step.content ?? []).filter(part => part.type === 'text')
    .map(part => part.text ?? '').join('');
}

async function saveState(filename, state) {
  await mkdir(runtime, { recursive: true });
  await writeFile(path.join(runtime, filename), JSON.stringify(state, null, 2), { mode: 0o600 });
}

async function runDesign(client) {
  const filename = 'creative-design.json';
  let state;
  try { state = JSON.parse(await readFile(path.join(runtime, filename), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let interaction;
  if (state?.id) {
    interaction = await client.interactions.get(state.id);
  } else {
    interaction = await client.interactions.create({
      model: argon, background: true, store: true,
      generation_config: { thinking_level: 'high', max_output_tokens: 1_000_000 },
      input: prompt, response_format: { type: 'text', mime_type: 'application/json' },
    });
    state = { id: interaction.id, model: argon, createdAt: new Date().toISOString() };
  }
  await saveState(filename, { ...state, status: interaction.status });
  console.log(`Design interaction ${interaction.id}; ${interaction.status}.`);
  const deadline = Date.now() + 15 * 60_000;
  while (['queued', 'in_progress'].includes(interaction.status)) {
    if (Date.now() >= deadline) throw new Error(`RESUME: node scripts/gemini-creative.mjs design (${interaction.id})`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    interaction = await client.interactions.get(interaction.id);
    await saveState(filename, { ...state, status: interaction.status });
  }
  if (interaction.status === 'requires_action') throw new Error(`ACTION_REQUIRED: ${interaction.id}; no local tools configured.`);
  if (['incomplete', 'failed', 'cancelled'].includes(interaction.status)) throw new Error(`DESIGN_${interaction.status.toUpperCase()}: ${interaction.id}`);
  if (interaction.status !== 'completed') throw new Error(`UNKNOWN_STATUS: ${interaction.id}`);
  const text = allText(interaction);
  const result = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  if (!result.design || !result.demo?.narration || !Array.isArray(result.demo.beats)) throw new Error('INVALID_DESIGN_RESULT');
  const evidence = { model: argon, status: 'completed', requestedSettings: {
    background: true, store: true, thinking_level: 'high', max_output_tokens: 1_000_000,
  }, completedAt: new Date().toISOString(), outputSource: 'all model_output text parts', ...result };
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await writeFile(path.join(root, 'docs/gemini-design-review.json'), JSON.stringify(evidence, null, 2));
  await writeFile(path.join(root, 'docs/demo-script.json'), JSON.stringify(result.demo, null, 2));
  console.log('Design and demo script saved; model completed successfully.');
}

async function runSpeech(client) {
  const demo = JSON.parse(await readFile(path.join(root, 'docs/demo-script.json'), 'utf8'));
  const response = await client.interactions.create({
    model: tts, store: false, background: false,
    input: [{ type: 'user_input', content: [{ type: 'text', text: demo.narration,
      annotations: [{ type: 'speech_metadata', style: 'Warm, curious and energetic hackathon storyteller. Natural adult English. Clear conversational delivery at approximately 135 words per minute. Vary pitch and emphasis, especially on three stars and learning by doing. Brief breath pauses. Not a sales announcer. Read only the transcript.' }],
    }] }],
    response_format: { type: 'audio', mime_type: 'audio/wav' },
    generation_config: { speech_config: [{ voice: 'Kore' }] },
  });
  if (response.status !== 'completed') throw new Error(`TTS_${String(response.status).toUpperCase()}`);
  const audio = extractAudio(response);
  await mkdir(path.join(root, 'reports'), { recursive: true });
  await writeFile(path.join(root, 'reports/demo-narration.wav'), audio.buffer);
  await saveState('creative-tts.json', { model: tts, status: response.status, generatedAt: new Date().toISOString(), bytes: audio.buffer.length });
  console.log(`Narration saved; ${tts} completed; ${audio.buffer.length} bytes.`);
}

async function main() {
  // The caller cannot accidentally select an ambient/global Gemini key here.
  if (!projectCredentialFile) throw new Error('MISSING_DESIGNATED_PROJECT_CREDENTIAL');
  const credential = loadProjectCredential({ PROJECT_GEMINI_CREDENTIAL_FILE: projectCredentialFile });
  if (!credential) throw new Error('MISSING_DESIGNATED_PROJECT_CREDENTIAL');
  const client = new GoogleGenAI({ apiKey: credential.apiKey, httpOptions: { timeout: 120_000 } });
  if (process.argv[2] === 'design') await runDesign(client);
  else if (process.argv[2] === 'speech') await runSpeech(client);
  else throw new Error('Usage: node scripts/gemini-creative.mjs design|speech');
}

main().catch(error => {
  // Controlled messages are safe; never print SDK diagnostic bodies.
  const message = String(error?.message ?? '');
  const controlled = /^(RESUME:|ACTION_REQUIRED:|DESIGN_|UNKNOWN_STATUS:|INVALID_DESIGN_RESULT|TTS_|Usage:|MISSING_DESIGNATED_PROJECT_CREDENTIAL)/.test(message);
  console.error(controlled ? message : `Creative request failed safely (HTTP ${Number(error?.status ?? error?.statusCode ?? 0)}). Resume existing saved interaction rather than duplicating it.`);
  process.exitCode = 1;
});
