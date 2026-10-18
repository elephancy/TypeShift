import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CloudflareAPI, inventory } from './ops-cloudflare.mjs';

export const INGESTION_URL = 'https://ops.elfeel.me/logs/ingest/v1/logs';
const KNOWN = {
  'ballot-api': ['ballot', 'api'],
  'ballot-web': ['ballot', 'web'],
  'ballot-twitch-extension': ['ballot', 'twitch-extension'],
  'foundroll-demo-proxy': ['foundroll', 'edge-proxy'],
  portfolio: ['portfolio', 'web'],
  commit: ['commit', 'web'],
  typeshift: ['typeshift', 'web'],
};

export function sourceIdentity(worker) {
  if (typeof worker !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(worker)) {
    throw new Error('Worker name is not a supported project slug');
  }
  const [project, service] = KNOWN[worker] ?? [worker, worker];
  return { project, service };
}

export function sourceKey(seed, worker) {
  sourceIdentity(worker);
  if (typeof seed !== 'string' || seed.length < 32) throw new Error('Ops ingestion seed is missing or too short');
  return createHmac('sha256', seed).update(`cloudflare/${worker}`).digest('base64url');
}

export function keyManifest(seed, workers) {
  return {
    version: 1,
    keys: workers.map(worker => ({
      sha256: createHash('sha256').update(sourceKey(seed, worker.name)).digest('hex'),
      ...sourceIdentity(worker.name),
    })).sort((a, b) => a.sha256.localeCompare(b.sha256)),
  };
}

export function desiredObservability(current, destination) {
  const previous = current ?? {};
  const logs = previous.logs ?? {};
  return {
    ...previous,
    enabled: true,
    logs: {
      ...logs,
      enabled: true,
      invocation_logs: true,
      destinations: [...new Set([...(logs.destinations ?? []), destination])],
    },
  };
}

export class EnrollmentAPI extends CloudflareAPI {
  async mutate(path, method, body) {
    if (!['POST', 'PATCH'].includes(method)
        || !/^workers\/(observability\/destinations(?:\/[a-zA-Z0-9_-]+)?|scripts\/[a-z0-9-]+\/script-settings)$/.test(path)) {
      throw new Error('Mutation outside the Ops destination/observability boundary');
    }
    let response;
    try {
      response = await this.fetcher(`https://api.cloudflare.com/client/v4/accounts/${this.account}/${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000), redirect: 'error',
      });
    } catch { throw new Error('Cloudflare enrollment request failed before a response was available'); }
    let result;
    try { result = await response.json(); }
    catch { throw new Error(`Cloudflare enrollment returned HTTP ${response.status} with an invalid response`); }
    if (!response.ok || result.success !== true) {
      const codes = (result.errors ?? []).map(error => Number(error.code)).filter(Number.isFinite);
      throw new Error(`Cloudflare enrollment HTTP ${response.status}; error codes ${codes.join(',') || 'unknown'}`);
    }
    return result.result;
  }
}

export async function enrollWorker(api, seed, worker, destinations) {
  const destinationName = `ops-logs-${worker.name}`;
  const existing = destinations.find(item => item.name === destinationName);
  if (existing && (existing.configuration?.url !== INGESTION_URL
      || existing.configuration?.logpushDataset !== 'opentelemetry-logs')) {
    throw new Error('Existing destination name conflicts with the owned Ops destination');
  }
  const configuration = {
    type: 'logpush', logpushDataset: 'opentelemetry-logs', url: INGESTION_URL,
    headers: { Authorization: `Bearer ${sourceKey(seed, worker.name)}` },
  };
  // Only this script's exact, account-owned destination can receive its new key.
  const destination = existing
    ? await api.mutate(`workers/observability/destinations/${encodeURIComponent(existing.slug)}`, 'PATCH', { configuration, enabled: true })
    : await api.mutate('workers/observability/destinations', 'POST', { configuration, enabled: true, name: destinationName });
  if (destination.name !== destinationName || destination.enabled !== true) {
    throw new Error('Cloudflare did not acknowledge the intended Ops destination');
  }
  const path = `workers/scripts/${encodeURIComponent(worker.name)}/script-settings`;
  const before = (await api.request(path)).result;
  await api.mutate(path, 'PATCH', { observability: desiredObservability(before.observability, destinationName) });
  const after = (await api.request(path)).result;
  if (after.observability?.enabled !== true || after.observability?.logs?.enabled !== true
      || after.observability?.logs?.invocation_logs !== true
      || !after.observability.logs.destinations?.includes(destinationName)) {
    throw new Error('Worker did not retain the required Ops log export settings');
  }
  return { worker: worker.name, ...sourceIdentity(worker.name), configured: true, delivery_verified: false };
}

async function main() {
  const phase = process.argv[2];
  if (!['plan', 'enroll'].includes(phase)) throw new Error('Choose plan or enroll');
  const api = new EnrollmentAPI(process.env.OPS_CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID);
  const seed = process.env.OPS_LOG_INGESTION_SEED;
  const report = await inventory(api);
  if (report.errors.length) {
    console.log(JSON.stringify(report));
    throw new Error('Provider API permissions/inventory are incomplete; enrollment stopped');
  }
  const workers = report.resources.workers;
  const manifest = keyManifest(seed, workers);
  const directory = process.env.OPS_ARTIFACT_DIR;
  if (!directory) throw new Error('A runner-private artifact directory is required');
  if (phase === 'plan') {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, 'ops-ingestion-keys.json'), JSON.stringify(manifest), { mode: 0o600 });
    await writeFile(join(directory, 'cloudflare-inventory.json'), JSON.stringify(report), { mode: 0o600 });
    console.log(`Prepared hash-only credential manifest for ${manifest.keys.length} owned Workers`);
    return;
  }
  const publishedManifest = JSON.parse(await readFile(join(directory, 'ops-ingestion-keys.json'), 'utf8'));
  if (JSON.stringify(publishedManifest) !== JSON.stringify(manifest)) {
    throw new Error('Worker inventory changed since publishing key hashes; wait for the next reconciliation');
  }
  // Destination authentication appears only in outbound HTTPS bodies, never in
  // stdout, artifacts, process arguments, or configuration checked into Git.
  const destinations = await api.list('workers/observability/destinations');
  const results = [];
  for (const worker of workers) results.push(await enrollWorker(api, seed, worker, destinations));
  console.log(JSON.stringify({ version: 1, results }));
  // The immutable artifact describes pre-enrollment settings. Actual log delivery
  // remains a separate host-side observation; never mark it verified from PATCH.
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
