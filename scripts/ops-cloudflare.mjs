import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const API = 'https://api.cloudflare.com/client/v4';
const OWNED_ACCOUNT = 'c94b093590e90a687fab4ecf90a7c1fb';
const DESTINATION = 'ops-logs';

// Provider responses can contain binding secrets and destination authentication.
// Keep the report an explicit allowlist; never log API bodies or request headers.
export function workerSummary(worker, settings = {}) {
  const observability = settings.observability ?? worker.observability ?? {};
  const logs = observability.logs ?? {};
  const name = worker.id ?? worker.name;
  return {
    name,
    modified_on: worker.modified_on ?? null,
    observability: {
      enabled: observability.enabled === true,
      logs_enabled: logs.enabled === true,
      invocation_logs: logs.invocation_logs === true,
      destinations: Array.isArray(logs.destinations) ? logs.destinations : [],
      sampling: logs.head_sampling_rate ?? observability.head_sampling_rate ?? null,
      persist: logs.persist ?? null,
    },
    ops_configured: observability.enabled === true && logs.enabled === true
      && (logs.destinations ?? []).some(item => item === DESTINATION || item === `${DESTINATION}-${name}`),
  };
}

export function pagesSummary(project) {
  const deployment = project.canonical_deployment ?? project.latest_deployment;
  return {
    name: project.name,
    subdomain: project.subdomain ?? null,
    domains: project.domains ?? [],
    production_branch: project.production_branch ?? null,
    uses_functions: project.uses_functions ?? null,
    production_script_name: project.production_script_name ?? null,
    deployment_id: deployment?.id ?? null,
    deployment_status: deployment?.latest_stage?.status ?? null,
    coverage: 'persistent-source-unverified',
  };
}

export function destinationSummary(destination) {
  let endpoint = null;
  try {
    const url = new URL(destination.configuration?.url);
    endpoint = `${url.origin}${url.pathname}`;
  } catch { /* A malformed provider URL is metadata, never a reason to print it. */ }
  return {
    name: destination.name,
    slug: destination.slug,
    enabled: destination.enabled === true,
    endpoint,
    type: destination.configuration?.logpushDataset ?? null,
    authenticated: Object.keys(destination.configuration?.headers ?? {}).length > 0,
    last_complete: destination.configuration?.jobStatus?.last_complete ?? null,
    last_error: destination.configuration?.jobStatus?.last_error ?? null,
  };
}

export class CloudflareAPI {
  constructor(token, account, fetcher = fetch) {
    if (!token || account !== OWNED_ACCOUNT) {
      throw new Error('Expected the existing owned Cloudflare account credentials');
    }
    this.token = token;
    this.account = account;
    this.fetcher = fetcher;
  }

  async request(path) {
    let response;
    try {
      response = await this.fetcher(`${API}/accounts/${this.account}/${path}`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      });
    } catch {
      throw new Error('Cloudflare request failed before a response was available');
    }
    let body;
    try { body = await response.json(); }
    catch { throw new Error(`Cloudflare returned HTTP ${response.status} with an invalid response`); }
    if (!response.ok || body.success !== true) {
      const codes = (body.errors ?? []).map(error => Number(error.code)).filter(Number.isFinite);
      const categories = ['authentication', 'authenticate', 'permission', 'scope', 'account', 'project', 'page', 'per_page', 'pagination', 'invalid', 'enabled', 'disabled', 'expired', 'token', 'product', 'user', 'maximum', 'minimum', 'limit', 'access']
        .filter(word => (body.errors ?? []).some(error => typeof error.message === 'string' && error.message.toLowerCase().includes(word)));
      // Fixed vocabulary only: provider prose may echo sensitive request context.
      throw new Error(`Cloudflare HTTP ${response.status}; error codes ${codes.join(',') || 'unknown'}${categories.length ? `; categories ${categories.join(',')}` : ''}`);
    }
    return body;
  }

  async list(path) {
    const result = [];
    // Start Pages with its documented default query, then follow returned bounds.
    const perPage = path.startsWith('pages/') ? 20 : 100;
    for (let page = 1; page <= 100; page++) {
      const body = await this.request(path.startsWith('pages/') && page === 1 ? path : `${path}?page=${page}&per_page=${perPage}`);
      if (!Array.isArray(body.result)) throw new Error('Cloudflare list response was not an array');
      result.push(...body.result);
      const pages = body.result_info?.total_pages;
      if (pages ? page >= pages : body.result.length < perPage) return result;
    }
    throw new Error('Cloudflare pagination exceeded the account inventory limit');
  }
}

export async function inventory(api) {
  const report = { version: 1, observed_at: new Date().toISOString(), mode: 'read-only', resources: {}, errors: [] };
  for (const [name, path, summarise] of [
    ['workers', 'workers/scripts', workerSummary],
    ['pages', 'pages/projects', pagesSummary],
    ['destinations', 'workers/observability/destinations', destinationSummary],
  ]) {
    try {
      const resources = await api.list(path);
      report.resources[name] = [];
      for (const resource of resources) {
        if (name === 'workers') {
          try {
            const settings = await api.request(`workers/scripts/${encodeURIComponent(resource.id ?? resource.name)}/script-settings`);
            report.resources[name].push(summarise(resource, settings.result));
          } catch (error) {
            report.resources[name].push({ ...summarise(resource), settings_readable: false });
            report.errors.push({ resource: name, operation: 'settings', message: error.message });
          }
        } else report.resources[name].push(summarise(resource));
      }
    } catch (error) {
      report.errors.push({ resource: name, operation: 'list', message: error.message });
    }
  }
  return report;
}

async function main() {
  const api = new CloudflareAPI(process.env.OPS_CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID);
  const report = await inventory(api);
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const count = name => report.resources[name]?.length ?? 'unavailable';
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `### Ops provider inventory\n\nRead-only inventory: ${count('workers')} Workers, ${count('pages')} Pages projects, ${count('destinations')} destinations.\n\n${report.errors.length ? 'Some required API reads failed; see sanitized error codes in the log.' : 'All inventory API reads succeeded.'}\n`);
  }
  if (report.errors.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
