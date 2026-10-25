import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDesignatedGeminiKey, loadProjectCredential } from '../credentials.mjs';

const fakeKey = 'AIza' + 'x'.repeat(35);
const otherFakeKey = 'AIza' + 'y'.repeat(35);

test('only explicitly designated environment variable is used', () => {
  assert.equal(loadProjectCredential({ GEMINI_API_KEY: fakeKey, GOOGLE_API_KEY: fakeKey }), null);
  assert.equal(loadProjectCredential({ PROJECT_GEMINI_API_KEY: fakeKey }).apiKey, fakeKey);
});
test('selects labelled Gemini section without selecting another service credential', () => {
  const text = `# Other service\n${otherFakeKey}\n# Gemini\nAPI token: ${fakeKey}\n# Another service\n${otherFakeKey}`;
  assert.equal(extractDesignatedGeminiKey(text), fakeKey);
});
test('recognizes explicit Gemini environment label', () => {
  assert.equal(extractDesignatedGeminiKey(`GEMINI_API_KEY=${fakeKey}`), fakeKey);
});
test('rejects missing, ambiguous or unlabelled credentials', () => {
  assert.throws(() => extractDesignatedGeminiKey(otherFakeKey), /exactly one/);
  assert.throws(() => extractDesignatedGeminiKey(`# Gemini\n${fakeKey}\n${otherFakeKey}`), /exactly one/);
  assert.throws(() => extractDesignatedGeminiKey('No keys here.'), /exactly one/);
});
