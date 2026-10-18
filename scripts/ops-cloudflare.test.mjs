import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudflareAPI, destinationSummary, inventory, pagesSummary, workerSummary } from './ops-cloudflare.mjs';

const account = 'c94b093590e90a687fab4ecf90a7c1fb';
const response = (result, extra = {}) => ({ ok: true, status: 200, json: async () => ({ success: true, result, ...extra }) });

test('reports provider metadata without bindings, secret values, or URL authentication', () => {
  const secret = 'must-never-appear';
  const destination = destinationSummary({ name: 'ops-logs', slug: 'ops-logs', enabled: true,
    configuration: { url: `https://user:${secret}@ops.elfeel.me/ingest?key=${secret}`, headers: { Authorization: secret }, jobStatus: { error_message: secret } } });
  const pages = pagesSummary({ name: 'tariffguard', deployment_configs: { production: { env_vars: { KEY: { value: secret } } } } });
  const worker = workerSummary({ id: 'typeshift', bindings: [{ secret }] }, { observability: { enabled: true, logs: { enabled: true, destinations: ['ops-logs'] } } });
  assert.equal(destination.endpoint, 'https://ops.elfeel.me/ingest');
  assert.equal(destination.authenticated, true);
  assert.equal(worker.ops_configured, true);
  assert.equal(JSON.stringify({ destination, pages, worker }).includes(secret), false);
});

test('refuses another account before making any request', () => {
  assert.throws(() => new CloudflareAPI('fixture', 'another-account'), /owned Cloudflare account/);
});

test('uses GET only and follows provider pagination', async () => {
  const calls = [];
  const api = new CloudflareAPI('fixture', account, async (url, options) => {
    calls.push({ url, options });
    return response([{ id: calls.length === 1 ? 'one' : 'two' }], { result_info: { total_pages: 2 } });
  });
  assert.deepEqual((await api.list('workers/scripts')).map(item => item.id), ['one', 'two']);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.method, undefined);
    assert.equal(call.options.redirect, 'error');
    assert.equal(new URL(call.url).origin, 'https://api.cloudflare.com');
  }
});

test('provider errors cannot echo credentials or raw response text', async () => {
  const api = new CloudflareAPI('fixture', account, async () => ({ ok: false, status: 403,
    json: async () => ({ success: false, errors: [{ code: 10000, message: 'Authorization: sensitive' }] }) }));
  await assert.rejects(api.request('workers/scripts'), { message: 'Cloudflare HTTP 403; error codes 10000' });
});

test('Pages inventory uses documented default query then smaller pages without truncating', async () => {
  let calls = 0;
  const api = new CloudflareAPI('fixture', account, async url => {
    calls++;
    assert.equal(new URL(url).searchParams.get('per_page'), calls === 1 ? null : '20');
    return response(calls === 1 ? Array.from({ length: 20 }, (_, i) => ({ name: `page-${i}` })) : [{ name: 'last' }]);
  });
  assert.equal((await api.list('pages/projects')).length, 21);
  assert.equal(calls, 2);
});

test('permission diagnostics expose only fixed categories, never provider prose', async () => {
  const api = new CloudflareAPI('fixture-secret', account, async () => ({ ok: false, status: 400,
    json: async () => ({ success: false, errors: [{ code: 8000024, message: 'Cannot authenticate user using fixture-secret' }] }) }));
  await assert.rejects(api.request('pages/projects'), { message: 'Cloudflare HTTP 400; error codes 8000024; categories authenticate,user' });
});

test('reports partial permissions as a failed inventory instead of an empty healthy account', async () => {
  const api = { list: async path => { if (path === 'pages/projects') throw new Error('Cloudflare HTTP 403; error codes 10000'); return []; } };
  const report = await inventory(api);
  assert.equal(report.errors.length, 1);
  assert.equal(report.resources.pages, undefined);
  assert.deepEqual(report.resources.workers, []);
});
