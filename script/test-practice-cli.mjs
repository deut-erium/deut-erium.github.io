import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./challenge-practice-cli.mjs', import.meta.url));
const witness = JSON.parse(readFileSync(new URL('../agent_out/challenge-runtime/session/chaos-collision.json', import.meta.url))).collision;

function run(args, input = '') {
  return spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8' });
}

test('CLI adapter runs a real local Chaos session over stdin/stdout', () => {
  const result = run(['chaos'], `${witness.first}\n${witness.second}\n`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /practice\{local_dummy_reward\}/);
  assert.equal(result.stderr, '');
});

test('CLI adapter exposes only the allowlisted runtimes and variants', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /law-and-order/);
  const bad = run(['law-and-order', '--variant', 'unknown']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Unsupported challenge variant/);
});
