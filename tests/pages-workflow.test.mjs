import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');

test('Pages deployment runs only after the tested main-branch build', () => {
  assert.match(workflow, /push:\s*\n\s+branches: \[main\]/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /if: github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /needs: build/);
  assert.match(workflow, /run: npm ci --ignore-scripts[\s\S]*run: npm test[\s\S]*run: npm run build:pages[\s\S]*actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /path: dist-pages/);
  assert.doesNotMatch(workflow, /pull_request_target|path: ['"]?\.\/?(?:['"]?\s*$)/m);
});

test('Pages uses environment protection and no application credentials', () => {
  assert.match(workflow, /^permissions:\s*\n  contents: read/m);
  const deploy = workflow.split('  deploy:')[1];
  assert.match(deploy, /pages: write/);
  assert.match(deploy, /id-token: write/);
  assert.match(deploy, /environment:\s*\n\s+name: github-pages/);
  assert.match(deploy, /actions\/deploy-pages@v4/);
  assert.doesNotMatch(workflow, /secrets\.|write-all|contents: write|GEMINI_API_KEY|credentials|access_info/);
});
