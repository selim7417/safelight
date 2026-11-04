// Publishes the production build to the gh-pages branch, which GitHub Pages serves.
// Run with: npm run deploy  (commit your changes first, so the site always matches the code)
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });
const read = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();

if (read('git', ['status', '--porcelain'])) {
  console.error('You have uncommitted changes. Commit them first, so the site matches the code.');
  process.exit(1);
}
const remote = read('git', ['remote', 'get-url', 'origin']);
const source = read('git', ['rev-parse', '--short', 'HEAD']);
const note = process.argv[2];

run('npm', ['run', 'build']);

const dir = mkdtempSync(join(tmpdir(), 'safelight-deploy-'));
try {
  cpSync('dist', dir, { recursive: true });
  // Tells GitHub Pages to serve the files as they are.
  writeFileSync(join(dir, '.nojekyll'), '');
  run('git', ['init', '-q', '-b', 'gh-pages'], dir);
  run('git', ['add', '-A'], dir);
  run('git', ['commit', '-q', '-m', `Deploy ${source}`, ...(note ? ['-m', note] : [])], dir);
  // The branch only ever holds the latest build, so it's replaced outright.
  // Signs in through the GitHub CLI (gh), so no separate git password is needed.
  run('git', ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', '-q', '--force', remote, 'gh-pages'], dir);
  console.log(`Published ${source} to the gh-pages branch.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
