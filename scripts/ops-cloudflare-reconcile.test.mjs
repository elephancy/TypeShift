import test from 'node:test';
import assert from 'node:assert/strict';
import { awaitHostAcceptance, desiredObservability, EnrollmentAPI, enrollWorker, INGESTION_URL, keyManifest, sourceIdentity, sourceKey } from './ops-cloudflare-reconcile.mjs';

const seed = 'fixture-seed-never-used-in-production';

test('derivation is stable, source-bound, and manifests contain hashes only', () => {
  assert.equal(sourceKey(seed, 'portfolio'), sourceKey(seed, 'portfolio'));
  assert.notEqual(sourceKey(seed, 'portfolio'), sourceKey(seed, 'typeshift'));
  const manifest = keyManifest(seed, [{ name: 'ballot-api' }, { name: 'new-project' }]);
  assert.equal(manifest.keys.length, 2);
  assert.equal(JSON.stringify(manifest).includes(sourceKey(seed, 'ballot-api')), false);
  assert.equal(JSON.stringify(manifest).includes(seed), false);
  assert.ok(manifest.keys.every(key => /^[0-9a-f]{64}$/.test(key.sha256)));
  assert.deepEqual(sourceIdentity('ballot-api'), { project: 'ballot', service: 'api' });
  assert.deepEqual(sourceIdentity('new-project'), { project: 'new-project', service: 'new-project' });
  assert.deepEqual(sourceIdentity('foundroll-demo-proxy'), { project: 'foundroll', service: 'edge-proxy' });
  assert.throws(() => sourceIdentity('../unsafe'), /supported project slug/);
  assert.throws(() => sourceKey('short', 'portfolio'), /seed/);
});

test('preserves unrelated observability settings, existing destinations and sampling', () => {
  const current = { enabled: false, head_sampling_rate: 0.5, traces: { enabled: true, destinations: ['traces'] },
    redact_query_string: true, logs: { enabled: false, persist: false, head_sampling_rate: 0.2, destinations: ['other'] } };
  const desired = desiredObservability(current, 'ops-logs-portfolio');
  assert.deepEqual(desired.traces, current.traces);
  assert.equal(desired.logs.persist, false);
  assert.equal(desired.logs.head_sampling_rate, 0.2);
  assert.equal(desired.head_sampling_rate, 0.5);
  assert.deepEqual(desired.logs.destinations, ['other', 'ops-logs-portfolio']);
  assert.deepEqual(desiredObservability(desired, 'ops-logs-portfolio'), desired);
  assert.equal(current.enabled, false);
});

test('refuses a same-name destination pointing elsewhere before writing its key', async () => {
  const api = { mutate: async () => assert.fail('must not mutate') };
  await assert.rejects(enrollWorker(api, seed, { name: 'portfolio' }, [
    { name: 'ops-logs-portfolio', configuration: { url: 'https://other.example/', logpushDataset: 'opentelemetry-logs' } },
  ]), /conflicts/);
});

test('enrolls without replacing application settings and requires readback', async () => {
  const before = { observability: { traces: { enabled: true }, logs: { destinations: ['existing'], persist: false } }, tags: ['keep'] };
  const calls = [];
  let current = before;
  const api = {
    mutate: async (path, method, body) => {
      calls.push({ path, method, body });
      if (path.endsWith('destinations')) return { name: body.name, enabled: true };
      current = { ...current, ...body };
      return current;
    },
    request: async () => ({ result: current }),
  };
  const result = await enrollWorker(api, seed, { name: 'portfolio' }, []);
  assert.equal(result.configured, true);
  assert.equal(result.delivery_verified, false);
  assert.equal(calls[0].body.configuration.url, INGESTION_URL);
  assert.deepEqual(Object.keys(calls[1].body), ['observability']);
  assert.deepEqual(current.tags, ['keep']);
  assert.deepEqual(current.observability.logs.destinations, ['existing', 'ops-logs-portfolio']);
});

test('mutation transport rejects code/deploy/secret operations and sanitizes API errors', async () => {
  const api = new EnrollmentAPI('fixture', 'c94b093590e90a687fab4ecf90a7c1fb', async () => ({ ok: false, status: 403,
    json: async () => ({ success: false, errors: [{ code: 10000, message: seed }] }) }));
  await assert.rejects(api.mutate('workers/scripts/portfolio', 'PUT', {}), /boundary/);
  await assert.rejects(api.mutate('workers/scripts/portfolio/secrets', 'POST', {}), /boundary/);
  await assert.rejects(api.mutate('workers/observability/destinations', 'POST', {}), { message: 'Cloudflare enrollment HTTP 403; error codes 10000' });
});

test('waits for host key acceptance with empty OTLP and never sends fake source events', async () => {
  let calls = 0;
  const fetcher = async (url, request) => {
    assert.equal(url, INGESTION_URL);
    assert.deepEqual(JSON.parse(request.body), { resourceLogs: [] });
    assert.equal(request.redirect, 'error');
    return { status: ++calls === 1 ? 401 : 200 };
  };
  await awaitHostAcceptance(seed, [{ name: 'portfolio' }], fetcher, async () => {}, 2);
  assert.equal(calls, 2);
  await assert.rejects(awaitHostAcceptance(seed, [{ name: 'portfolio' }], async () => ({ status: 401 }), async () => {}, 2), /not accepted/);
  await assert.rejects(awaitHostAcceptance(seed, [{ name: 'portfolio' }], async () => ({ status: 400 }), async () => {}, 2), /HTTP 400/);
});
