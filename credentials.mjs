import { readFileSync, statSync } from 'node:fs';

// Only a credential deliberately designated for this app may be read. Never
// consult Gemini CLI, browser credentials, global .env files, or other key stores.
const KEY_PATTERN = /\bAIza[\w-]{35}\b/g;

export function extractDesignatedGeminiKey(document) {
  if (typeof document !== 'string') throw new TypeError('Credential document must be text.');
  const lines = document.split(/\r?\n/);
  const candidates = new Set();
  let inGeminiSection = false;
  let sectionLevel = 0;
  let nearbyGeminiLabel = 0;
  for (const line of lines) {
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      if (inGeminiSection && heading[1].length <= sectionLevel) inGeminiSection = false;
      if (/\bgemini\b/i.test(heading[2])) {
        inGeminiSection = true;
        sectionLevel = heading[1].length;
      }
      nearbyGeminiLabel = 0;
    }
    const explicitLabel = /\bgemini\b|\bPROJECT_GEMINI_API_KEY\b|\bGEMINI_API_KEY\b/i.test(line);
    if (explicitLabel) nearbyGeminiLabel = 3;
    if (inGeminiSection || explicitLabel || nearbyGeminiLabel > 0) {
      for (const value of line.matchAll(KEY_PATTERN)) candidates.add(value[0]);
    }
    nearbyGeminiLabel = Math.max(0, nearbyGeminiLabel - 1);
  }
  if (candidates.size !== 1) {
    throw new Error('The designated file must identify exactly one Gemini API key. Configure PROJECT_GEMINI_API_KEY instead if its format is different.');
  }
  return [...candidates][0];
}

export function loadProjectCredential(env = process.env) {
  if (env.PROJECT_GEMINI_API_KEY?.trim()) {
    return { apiKey: env.PROJECT_GEMINI_API_KEY.trim(), source: 'designated environment variable' };
  }
  const filename = env.PROJECT_GEMINI_CREDENTIAL_FILE;
  if (!filename) return null;
  const stat = statSync(filename);
  if (!stat.isFile() || stat.size > 128 * 1024) throw new Error('Designated credential file is not a small regular file.');
  const apiKey = extractDesignatedGeminiKey(readFileSync(filename, 'utf8'));
  return { apiKey, source: 'explicitly designated credential file' };
}
