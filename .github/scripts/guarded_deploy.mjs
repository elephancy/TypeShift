// TypeShift CI only: keep the central Ops adapter, guard each production mutation.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ADAPTER_URL = 'https://ops.elfeel.me/standards/cloudflare/deploy.mjs';

export function execute(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 && signal === null ? resolve() : reject(new Error('Guarded deployment child failed')));
  });
}

export function guardedRunner({ node, binary, wrangler, directory, config, migration, env, guard, run = execute }) {
  let built = false;
  let deployed = false;
  let temporary;
  const runner = async (command, args, options) => {
    if (command !== node || !Array.isArray(args) || args.length !== 4 || args[0] !== binary
        || !['build', 'deploy'].includes(args[1]) || args[2] !== '--config'
        || typeof args[3] !== 'string' || path.dirname(args[3]) !== directory
        || !/^\.ops-deploy-[a-f0-9]{32}\.json$/.test(path.basename(args[3]))
        || options?.cwd !== directory || options?.env !== env
        || Object.keys(options).some(key => !['cwd', 'env'].includes(key))) {
      throw new Error('Central adapter command changed; deployment requires review');
    }
    if (args[1] === 'build') {
      if (built || deployed) throw new Error('Unexpected deployment build order');
      temporary = args[3];
      // Preserve the existing schema-before-build order, with a fresh source check.
      await guard();
      await run(node, [wrangler, 'd1', 'execute', 'typeshift-prod', '--config', config,
        '--remote', '--file', migration, '--yes'], options);
      await run(command, args, options);
      built = true;
    } else {
      if (!built || deployed || args[3] !== temporary) throw new Error('Unexpected deployment publication order');
      // OpenNext build may be slow: CI/main/attempt authority must still be current.
      await guard();
      await run(command, args, options);
      deployed = true;
    }
  };
  runner.complete = () => built && deployed;
  return runner;
}

export function readOnlyFetch(fetcher) {
  return (url, options = {}) => {
    const parsed = new URL(url);
    if ((options.method ?? 'GET').toUpperCase() !== 'GET'
        || !['https://ops.elfeel.me', 'https://api.cloudflare.com'].includes(parsed.origin)) {
      throw new Error('Unexpected central adapter API operation');
    }
    return fetcher(url, { ...options, redirect: 'error' });
  };
}

export async function loadAdapter(fetcher, directory) {
  const response = await fetcher(ADAPTER_URL, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (response.status !== 200 || response.url !== ADAPTER_URL
      || !/^(application|text)\/javascript(?:;|$)/i.test(response.headers.get('content-type') ?? '')
      || !response.body) throw new Error('Central Ops adapter response is invalid');
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > 256 * 1024) throw new Error('Central Ops adapter exceeds its size limit');
    chunks.push(Buffer.from(chunk));
  }
  if (!length) throw new Error('Central Ops adapter is empty');
  const filename = path.join(directory, 'central-deploy.mjs');
  await writeFile(filename, Buffer.concat(chunks), { flag: 'wx', mode: 0o600 });
  const adapter = await import(pathToFileURL(filename).href);
  if (typeof adapter.deploy !== 'function' || typeof adapter.localBin !== 'function') throw new Error('Central Ops adapter interface changed');
  return adapter;
}

export async function deployGuarded({ env = process.env, fetcher = globalThis.fetch, run = execute, adapterLoader = loadAdapter } = {}) {
  const policyRoot = env.CI_POLICY_ROOT;
  if (!path.isAbsolute(policyRoot ?? '')) throw new Error('Trusted CI policy directory is missing');
  const directory = path.resolve('client');
  const config = path.join(directory, 'wrangler.jsonc');
  const migration = path.join(directory, 'cloudflare/d1/migrations/0001_initial.sql');
  const node = process.execPath;
  const guardEnv = Object.fromEntries(['GH_TOKEN', 'SOURCE_EVENT', 'SOURCE_REPOSITORY', 'SOURCE_REF', 'SOURCE_SHA',
    'CI_TRIGGER', 'EXPECTED_PROOF', 'EXPECTED_HELPER_SHA256', 'CI_POLICY_ROOT'].map(key => [key, env[key] ?? '']));
  const guard = async () => {
    const filename = path.join(policyRoot, 'deploy_ci_proof.py');
    const hash = createHash('sha256').update(await readFile(filename)).digest('hex');
    if (!/^[a-f0-9]{64}$/.test(guardEnv.EXPECTED_HELPER_SHA256) || hash !== guardEnv.EXPECTED_HELPER_SHA256) throw new Error('Trusted CI proof helper changed');
    await run('/usr/bin/python3', ['-I', filename, 'revalidate'], { cwd: directory, env: guardEnv });
  };
  await guard();
  const temporary = await mkdtemp(path.join(tmpdir(), 'typeshift-central-adapter-'));
  try {
    const adapter = await adapterLoader(fetcher, temporary);
    const binary = await adapter.localBin('opennext', directory);
    const wrangler = await adapter.localBin('wrangler', directory);
    // GitHub proof credentials do not belong in the application build/deploy child.
    const deploymentEnv = { ...env };
    for (const key of Object.keys(guardEnv)) delete deploymentEnv[key];
    const runner = guardedRunner({ node, binary, wrangler, directory, config, migration, env: deploymentEnv, guard, run });
    const result = await adapter.deploy({ engine: 'opennext', config }, {
      fetcher: readOnlyFetch(fetcher), env: deploymentEnv, runner,
      resolveBin: async (engine, cwd) => {
        if (cwd !== directory || !['opennext', 'wrangler'].includes(engine)) throw new Error('Unexpected adapter package lookup');
        return engine === 'opennext' ? binary : wrangler;
      },
    });
    if (!runner.complete() || result?.deployed !== true || result?.observability_verified !== true) throw new Error('Central deployment did not complete all guarded stages');
    return result;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  deployGuarded().then(() => console.log('Exact-source deployment and central observability readback verified'))
    .catch(() => { console.error('Guarded deployment failed; no fallback was attempted'); process.exitCode = 1; });
}
