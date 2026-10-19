// Generic bootstrap only. Deployment and observability policy are owned by Ops.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const source = 'https://ops.elfeel.me/standards/cloudflare/deploy.mjs';
const maximumBytes = 256 * 1024;

export async function run(args, { fetcher = globalThis.fetch, execute = spawnSync, temporaryRoot = tmpdir() } = {}) {
  const response = await fetcher(source, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (response.status !== 200 || response.url !== source) throw new Error('Ops deployment bootstrap response is invalid');
  const contentType = response.headers.get('content-type') || '';
  if (!/^(application|text)\/javascript(?:;|$)/i.test(contentType)) throw new Error('Ops deployment bootstrap content type is invalid');
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)) throw new Error('Ops deployment bootstrap exceeds its size limit');
  if (!response.body) throw new Error('Ops deployment bootstrap body is missing');
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > maximumBytes) throw new Error('Ops deployment bootstrap exceeds its size limit');
    chunks.push(Buffer.from(chunk));
  }
  if (!length) throw new Error('Ops deployment bootstrap body is empty');
  const directory = mkdtempSync(path.join(temporaryRoot, 'ops-deploy-'));
  const filename = path.join(directory, 'deploy.mjs');
  try {
    writeFileSync(filename, Buffer.concat(chunks), { flag: 'wx', mode: 0o600 });
    const result = execute(process.execPath, [filename, ...args], { stdio: 'inherit' });
    if (result.error || result.signal || !Number.isInteger(result.status)) throw new Error('Ops deployment process did not complete');
    return result.status;
  } finally {
    // This exact directory was created above for this invocation only.
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await run(process.argv.slice(2)); }
  catch { console.error('Ops deployment bootstrap failed; no deployment fallback was attempted.'); process.exitCode = 1; }
}
