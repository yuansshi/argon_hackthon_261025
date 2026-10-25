#!/usr/bin/env node
// Scoped publication utility. Explicit designated GitHub credential only.
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const { githubCandidates, loadDesignatedGitHubToken } = require('./github-askpass.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = 'yuansshi/argon_hackthon_261025';
const repoPath = `/repos/${repository}`;
const remote = `https://github.com/${repository}.git`;
let token;
async function api(endpoint, method = 'GET', body, selectedToken = token) {
  if (!endpoint.startsWith('/') || endpoint.includes('://')) throw new Error('INVALID_API_PATH');
  let response;
  try {
    response = await fetch(`https://api.github.com${endpoint}`, {
      method, redirect: 'error', headers: { Authorization: `Bearer ${selectedToken}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000),
    });
  } catch { return { unavailable: true, transportError: true, method, endpoint: endpoint.split('?')[0] }; }
  if (!response.ok) return { httpStatus: response.status, unavailable: true };
  return response.json();
}
async function probe() {
  const output = [];
  for (const candidate of githubCandidates()) {
    const [user, repo] = await Promise.all([api('/user', 'GET', undefined, candidate.token), api(repoPath, 'GET', undefined, candidate.token)]);
    output.push({ credentialKind: candidate.kind,
      user: user.unavailable ? user : { login: user.login, id: user.id },
      repository: repo.unavailable ? repo : { full_name: repo.full_name, default_branch: repo.default_branch, permissions: repo.permissions } });
  }
  console.log(JSON.stringify({ mode: 'read-only credential probe', candidates: output }, null, 2));
}
async function policy() {
  const [user, repo] = await Promise.all([api('/user'), api(repoPath)]);
  if (user.unavailable || repo.unavailable || repo.full_name.toLowerCase() !== repository.toLowerCase()) throw new Error('AUTHENTICATED_REPOSITORY_VERIFICATION_FAILED');
  const branchName = encodeURIComponent(repo.default_branch);
  const [branch, protection, rules, rulesets, actions, statuses, checks] = await Promise.all([
    api(`${repoPath}/branches/${branchName}`), api(`${repoPath}/branches/${branchName}/protection`),
    api(`${repoPath}/rules/branches/${branchName}?per_page=100`), api(`${repoPath}/rulesets?includes_parents=true&per_page=100`),
    api(`${repoPath}/actions/permissions`), api(`${repoPath}/commits/${branchName}/status`),
    api(`${repoPath}/commits/${branchName}/check-runs?per_page=100`),
  ]);
  const result = { checkedAt: new Date().toISOString(), mode: 'read-only', credentialKind: process.env.PROJECT_GITHUB_CREDENTIAL_KIND ?? 'unique-designated',
    authenticatedUser: { login: user.login, id: user.id },
    repository: { full_name: repo.full_name, private: repo.private, default_branch: repo.default_branch,
      archived: repo.archived, permissions: repo.permissions, allow_merge_commit: repo.allow_merge_commit,
      allow_squash_merge: repo.allow_squash_merge, allow_rebase_merge: repo.allow_rebase_merge,
      allow_auto_merge: repo.allow_auto_merge, delete_branch_on_merge: repo.delete_branch_on_merge },
    defaultBranch: branch.unavailable ? branch : { name: branch.name, protected: branch.protected, head: branch.commit?.sha },
    branchProtection: protection.unavailable ? protection : { enforce_admins: protection.enforce_admins,
      required_status_checks: protection.required_status_checks, required_pull_request_reviews: protection.required_pull_request_reviews,
      restrictions: protection.restrictions && { users: protection.restrictions.users?.map(item => item.login), teams: protection.restrictions.teams?.map(item => item.slug) },
      required_conversation_resolution: protection.required_conversation_resolution,
      required_linear_history: protection.required_linear_history, lock_branch: protection.lock_branch },
    activeBranchRules: rules,
    rulesets: Array.isArray(rulesets) ? rulesets.map(item => ({ id: item.id, name: item.name, target: item.target, source_type: item.source_type, enforcement: item.enforcement })) : rulesets,
    actionsPermissions: actions,
    headStatuses: statuses.unavailable ? statuses : { state: statuses.state, total_count: statuses.total_count,
      statuses: statuses.statuses?.map(item => ({ context: item.context, state: item.state })) },
    headChecks: checks.unavailable ? checks : { total_count: checks.total_count,
      check_runs: checks.check_runs?.map(item => ({ id: item.id, name: item.name, status: item.status, conclusion: item.conclusion, head_sha: item.head_sha })) },
  };
  await mkdir(path.join(root, '.runtime'), { recursive: true });
  await writeFile(path.join(root, '.runtime/github-policy.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
}
function confirmWrite() { if (!process.argv.includes('--confirm-remote-write')) throw new Error('REMOTE_WRITE_REQUIRES_EXPLICIT_FLAG'); }
async function push(branch) {
  if (!/^blitz-[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(branch ?? '') || branch.includes('..')) throw new Error('INVALID_TASK_BRANCH');
  const child = spawn('git', ['-c', 'credential.helper=', '-c', 'credential.useHttpPath=true',
    '-c', 'http.https://github.com/.extraheader=', '-c', 'http.followRedirects=false',
    'push', '--porcelain', remote, `HEAD:refs/heads/${branch}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME,
      PROJECT_GITHUB_CREDENTIAL_FILE: process.env.PROJECT_GITHUB_CREDENTIAL_FILE,
      PROJECT_GITHUB_CREDENTIAL_KIND: process.env.PROJECT_GITHUB_CREDENTIAL_KIND,
      GIT_ASKPASS: path.join(root, 'scripts/github-askpass.cjs'), GIT_TERMINAL_PROMPT: '0',
      GIT_TRACE: '0', GIT_TRACE_CURL: '0', GIT_CURL_VERBOSE: '0' },
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk.toString(); });
  const code = await new Promise(resolve => child.on('close', resolve));
  console.log(output.split(token).join('[REDACTED]').replace(/(?:github_pat_|ghp_)[A-Za-z0-9_]+/g, '[REDACTED]'));
  if (code !== 0) throw new Error('GIT_PUSH_FAILED');
}
async function prStatus(number) {
  if (!/^\d+$/.test(number ?? '')) throw new Error('INVALID_PR_NUMBER');
  const pr = await api(`${repoPath}/pulls/${number}`);
  if (pr.unavailable) throw new Error(`PR_HTTP_${pr.httpStatus}`);
  const [reviews, statuses, checks] = await Promise.all([
    api(`${repoPath}/pulls/${number}/reviews?per_page=100`), api(`${repoPath}/commits/${pr.head.sha}/status`),
    api(`${repoPath}/commits/${pr.head.sha}/check-runs?per_page=100`),
  ]);
  console.log(JSON.stringify({ number: pr.number, html_url: pr.html_url, state: pr.state, draft: pr.draft,
    merged: pr.merged, mergeable: pr.mergeable, mergeable_state: pr.mergeable_state,
    head: { ref: pr.head.ref, sha: pr.head.sha }, base: { ref: pr.base.ref, sha: pr.base.sha },
    requested_reviewers: pr.requested_reviewers?.map(item => item.login), requested_teams: pr.requested_teams?.map(item => item.slug),
    reviews: Array.isArray(reviews) ? reviews.map(item => ({ user: item.user.login, state: item.state, commit_id: item.commit_id })) : reviews,
    statuses: statuses.unavailable ? statuses : { state: statuses.state, total_count: statuses.total_count,
      statuses: statuses.statuses?.map(item => ({ context: item.context, state: item.state })) },
    checks: checks.unavailable ? checks : { total_count: checks.total_count,
      check_runs: checks.check_runs?.map(item => ({ id: item.id, name: item.name, status: item.status, conclusion: item.conclusion, head_sha: item.head_sha })) },
  }, null, 2));
}
async function main() {
  const [mode, argument] = process.argv.slice(2);
  if (mode === 'probe') return probe();
  token = loadDesignatedGitHubToken();
  if (mode === 'policy') return policy();
  if (mode === 'push') { confirmWrite(); return push(argument); }
  if (mode === 'pr-status') return prStatus(argument);
  if (mode === 'pr') {
    confirmWrite();
    if (!/^blitz-[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(argument ?? '') || argument.includes('..')) throw new Error('INVALID_TASK_BRANCH');
    if (!process.env.GITHUB_PR_BODY_FILE) throw new Error('MISSING_PR_BODY_FILE');
    const body = await readFile(process.env.GITHUB_PR_BODY_FILE, 'utf8');
    if (body.length > 65_000) throw new Error('INVALID_PR_BODY_SIZE');
    const repo = await api(repoPath); if (repo.full_name !== repository) throw new Error('REPOSITORY_VERIFICATION_FAILED');
    const pr = await api(`${repoPath}/pulls`, 'POST', { title: 'Build Blitz Learning interactive math prototype', head: argument, base: repo.default_branch, body });
    if (pr.transportError) throw new Error('PR_OUTCOME_UNKNOWN_CHECK_EXISTING_REQUESTS_BEFORE_RETRY');
    if (pr.unavailable) throw new Error(`PR_HTTP_${pr.httpStatus}`);
    console.log(JSON.stringify({ number: pr.number, html_url: pr.html_url, state: pr.state }, null, 2)); return;
  }
  throw new Error('Usage: github-publish.mjs probe|policy|push BRANCH|pr BRANCH|pr-status NUMBER');
}
main().catch(error => {
  const message = String(error?.message ?? '');
  const controlled = /^(MISSING_|INVALID_|AMBIGUOUS_|AUTHENTICATED_|REPOSITORY_|REMOTE_|GIT_PUSH_FAILED|PR_HTTP_|PR_OUTCOME_|Usage:)/.test(message);
  console.error(controlled ? message : 'GitHub operation failed safely; no credential or provider body logged.');
  process.exitCode = 1;
});
