#!/usr/bin/env node
'use strict';
const fs = require('node:fs');

function githubCandidates() {
  const filename = process.env.PROJECT_GITHUB_CREDENTIAL_FILE;
  if (!filename) throw new Error('MISSING_DESIGNATED_GITHUB_CREDENTIAL_FILE');
  const stat = fs.statSync(filename);
  if (!stat.isFile() || stat.size > 128 * 1024) throw new Error('INVALID_CREDENTIAL_DOCUMENT');
  const tokens = new Map();
  let section = false, level = 0, nearbyLabel = 0;
  for (const line of fs.readFileSync(filename, 'utf8').split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      if (section && heading[1].length <= level) section = false;
      if (/\bgithub\b/i.test(heading[2])) { section = true; level = heading[1].length; }
      nearbyLabel = 0;
    }
    const explicitLabel = /\bgithub\b|\bPROJECT_GITHUB_(?:TOKEN|API_TOKEN)\b/i.test(line);
    if (explicitLabel) nearbyLabel = 3;
    if (section || explicitLabel || nearbyLabel > 0) {
      for (const match of line.matchAll(/\b(?:github_pat_[A-Za-z0-9_]{20,255}|ghp_[A-Za-z0-9]{20,255})\b/g)) {
        tokens.set(match[0], { token: match[0], kind: match[0].startsWith('github_pat_') ? 'fine-grained' : 'classic' });
      }
    }
    nearbyLabel = Math.max(0, nearbyLabel - 1);
  }
  return [...tokens.values()];
}
function loadDesignatedGitHubToken() {
  const kind = process.env.PROJECT_GITHUB_CREDENTIAL_KIND;
  if (kind && !['fine-grained', 'classic'].includes(kind)) throw new Error('INVALID_GITHUB_CREDENTIAL_KIND');
  const candidates = githubCandidates().filter(item => !kind || item.kind === kind);
  if (candidates.length !== 1) throw new Error('AMBIGUOUS_OR_MISSING_LABELED_GITHUB_TOKEN');
  return candidates[0].token;
}
module.exports = { githubCandidates, loadDesignatedGitHubToken };

if (require.main === module) {
  // Invoked only by Git with stdout connected to its private askpass pipe.
  // Never invoke manually, and never supply credentials to another host.
  try {
    const prompt = process.argv[2] ?? '';
    if (!/https:\/\/(?:x-access-token@)?github\.com(?:\/|['":])/i.test(prompt)) process.exit(1);
    if (/^Username\b/i.test(prompt)) process.stdout.write('x-access-token\n');
    else if (/^Password\b/i.test(prompt)) process.stdout.write(`${loadDesignatedGitHubToken()}\n`);
    else process.exit(1);
  } catch { process.exit(1); }
}
