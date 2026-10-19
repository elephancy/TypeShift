import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { guardedRunner, readOnlyFetch, deployGuarded } from './guarded_deploy.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

function fixture() {
  const directory = path.resolve('client');
  const env = { CLOUDFLARE_API_TOKEN: 'synthetic-token' };
  const binary = path.join(directory, 'opennext.js');
  const wrangler = path.join(directory, 'wrangler.js');
  const temporary = path.join(directory, `.ops-deploy-${'a'.repeat(32)}.json`);
  const config = path.join(directory, 'wrangler.jsonc');
  const migration = path.join(directory, 'cloudflare/d1/migrations/0001_initial.sql');
  const calls = [];
  let authority = true;
  const runner = guardedRunner({ node: process.execPath, binary, wrangler, directory, config, migration, env,
    guard: async () => { calls.push({ guard: true }); if (!authority) throw new Error('CI authority moved'); },
    run: async (command, args, options) => { calls.push({ command, args, options }); },
  });
  return { runner, calls, directory, env, binary, wrangler, temporary, config, migration,
    options: { cwd: directory, env }, setAuthority: value => { authority = value; } };
}

test('exact central build/deploy keeps all schema flags and checks before both mutations', async () => {
  const f = fixture();
  await f.runner(process.execPath, [f.binary, 'build', '--config', f.temporary], f.options);
  await f.runner(process.execPath, [f.binary, 'deploy', '--config', f.temporary], f.options);
  assert.deepEqual(f.calls.map(x => x.guard ? 'guard' : x.args[1]), ['guard', 'd1', 'build', 'guard', 'deploy']);
  assert.deepEqual(f.calls[1].args, [f.wrangler, 'd1', 'execute', 'typeshift-prod', '--config', f.config,
    '--remote', '--file', f.migration, '--yes']);
  assert.equal(f.runner.complete(), true);
});

test('failed initial source guard prevents schema and build', async () => {
  const f = fixture();
  f.setAuthority(false);
  await assert.rejects(f.runner(process.execPath, [f.binary, 'build', '--config', f.temporary], f.options));
  assert.deepEqual(f.calls, [{ guard: true }]);
  assert.equal(f.runner.complete(), false);
});

test('source or rerun changes during build prevent the actual publication command', async () => {
  const f = fixture();
  await f.runner(process.execPath, [f.binary, 'build', '--config', f.temporary], f.options);
  f.setAuthority(false);
  await assert.rejects(f.runner(process.execPath, [f.binary, 'deploy', '--config', f.temporary], f.options));
  assert.equal(f.calls.filter(x => x.args?.[1] === 'deploy').length, 0);
  assert.equal(f.runner.complete(), false);
});

test('unknown Wrangler/OpenNext commands or changed argument bounds cannot mutate', async () => {
  const cases = [f => [f.binary, 'delete', '--config', f.temporary], f => [f.binary, 'publish', '--config', f.temporary],
    f => [f.wrangler, 'deploy', '--config', f.temporary], f => [f.binary, 'build', '--config', f.temporary, '--force'],
    f => [f.binary, 'build', '--config=' + f.temporary], f => [f.binary, 'build', '--config', f.config],
    f => [f.binary, 'build', '--config', path.join(f.directory, '..', path.basename(f.temporary))]];
  for (const args of cases) {
    const f = fixture();
    await assert.rejects(f.runner(process.execPath, args(f), f.options));
    assert.equal(f.calls.length, 0);
  }
});

test('foreign executables, working directory, environment or shell options are rejected', async () => {
  for (const change of ['node', 'cwd', 'env', 'shell']) {
    const f = fixture();
    const options = { ...f.options };
    let command = process.execPath;
    if (change === 'node') command += '-other';
    if (change === 'cwd') options.cwd = path.dirname(f.directory);
    if (change === 'env') options.env = { ...f.env };
    if (change === 'shell') options.shell = true;
    await assert.rejects(f.runner(command, [f.binary, 'build', '--config', f.temporary], options));
    assert.equal(f.calls.length, 0);
  }
});

test('publication requires the successful build and its exact ephemeral config', async () => {
  const f = fixture();
  await assert.rejects(f.runner(process.execPath, [f.binary, 'deploy', '--config', f.temporary], f.options));
  await f.runner(process.execPath, [f.binary, 'build', '--config', f.temporary], f.options);
  await assert.rejects(f.runner(process.execPath, [f.binary, 'build', '--config', f.temporary], f.options));
  const other = path.join(f.directory, `.ops-deploy-${'b'.repeat(32)}.json`);
  await assert.rejects(f.runner(process.execPath, [f.binary, 'deploy', '--config', other], f.options));
  await f.runner(process.execPath, [f.binary, 'deploy', '--config', f.temporary], f.options);
  await assert.rejects(f.runner(process.execPath, [f.binary, 'deploy', '--config', f.temporary], f.options));
  assert.equal(f.calls.filter(x => x.args?.[1] === 'deploy').length, 1);
});

test('central policy/settings reads remain allowed; direct API writes and foreign endpoints fail', async () => {
  const calls = [];
  const fetcher = readOnlyFetch(async (...args) => { calls.push(args); return { status: 200 }; });
  await fetcher('https://ops.elfeel.me/standards/cloudflare/policy.json');
  await fetcher('https://api.cloudflare.com/client/v4/accounts/test/workers/scripts/typeshift/script-settings', { method: 'GET' });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(([, options]) => options.redirect === 'error'));
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.throws(() => fetcher('https://api.cloudflare.com/client/v4/accounts/test', { method }));
  }
  assert.throws(() => fetcher('https://attacker.invalid/policy.json'));
  assert.equal(calls.length, 2);
});

test('real wrapper orchestrates guarded adapter stages without giving GitHub proof credentials to application children', async () => {
  const policy = await mkdtemp(path.join(tmpdir(), 'typeshift-guard-test-'));
  try {
    const source = '# synthetic proof helper, execution is mocked at the process boundary\n';
    await writeFile(path.join(policy, 'deploy_ci_proof.py'), source);
    const env = { CI_POLICY_ROOT: policy, GH_TOKEN: 'synthetic-github-token', CLOUDFLARE_API_TOKEN: 'synthetic-cloudflare-token',
      EXPECTED_HELPER_SHA256: createHash('sha256').update(source).digest('hex'), EXPECTED_PROOF: '{}', CI_TRIGGER: '{}' };
    const calls = [];
    const binary = path.join(path.resolve('client'), 'opennext.js');
    const wrangler = path.join(path.resolve('client'), 'wrangler.js');
    const loader = async () => ({ localBin: async engine => engine === 'opennext' ? binary : wrangler,
      deploy: async (_options, dependencies) => {
        const directory = path.resolve('client');
        const temporary = path.join(directory, `.ops-deploy-${'a'.repeat(32)}.json`);
        const options = { cwd: directory, env: dependencies.env };
        await dependencies.runner(process.execPath, [binary, 'build', '--config', temporary], options);
        await dependencies.runner(process.execPath, [binary, 'deploy', '--config', temporary], options);
        return { deployed: true, observability_verified: true };
      } });
    await deployGuarded({ env, adapterLoader: loader, run: async (command, args, options) => calls.push({ command, args, options }) });
    const guards = calls.filter(x => x.command === '/usr/bin/python3');
    assert.equal(guards.length, 3);
    assert.ok(guards.every(x => x.options.env.GH_TOKEN === 'synthetic-github-token' && x.options.env.CLOUDFLARE_API_TOKEN === undefined));
    const application = calls.filter(x => x.command === process.execPath);
    assert.deepEqual(application.map(x => x.args[1]), ['d1', 'build', 'deploy']);
    assert.ok(application.every(x => x.options.env.GH_TOKEN === undefined && x.options.env.EXPECTED_PROOF === undefined
      && x.options.env.CLOUDFLARE_API_TOKEN === 'synthetic-cloudflare-token'));
    let loaded = false;
    await assert.rejects(deployGuarded({ env: { ...env, EXPECTED_HELPER_SHA256: '0'.repeat(64) },
      adapterLoader: async () => { loaded = true; }, run: async () => assert.fail('Tampered policy must not execute') }));
    assert.equal(loaded, false);
  } finally {
    assert.equal(path.dirname(policy), path.resolve(tmpdir()));
    assert.ok(path.basename(policy).startsWith('typeshift-guard-test-'));
    await rm(policy, { recursive: true, force: true });
  }
});
