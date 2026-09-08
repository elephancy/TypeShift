interface CounterKeyParts {
  method: string;
  route: string;
  status: number;
}

const requestCounts = new Map<string, number>();
const requestDurations = new Map<string, { count: number; totalMs: number; maxMs: number }>();
const durationBuckets = [50, 100, 250, 500, 1000, 2500, 5000];
const durationBucketCounts = new Map<string, number>();

let startedAtMs = Date.now();

function counterKey(parts: CounterKeyParts): string {
  return `${parts.method}|${parts.route}|${parts.status}`;
}

function bucketKey(method: string, route: string, le: number): string {
  return `${method}|${route}|${le}`;
}

function quoteLabel(value: string | number): string {
  return `${value}`.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeRoute(pathname: string): string {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ":uuid")
    .replace(/[A-Z0-9]{6,}/g, ":id")
    .replace(/\/\d+/g, "/:n");
}

export function resetMetrics(now = Date.now()): void {
  requestCounts.clear();
  requestDurations.clear();
  durationBucketCounts.clear();
  startedAtMs = now;
}

export function recordHttpRequest(input: {
  method: string;
  route: string;
  status: number;
  durationMs: number;
}): void {
  const method = input.method.toUpperCase();
  const route = normalizeRoute(input.route || "/");
  const status = Math.max(100, Math.min(999, Math.trunc(input.status)));
  const durationMs = Math.max(0, input.durationMs);

  const key = counterKey({ method, route, status });
  requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);

  const durationKey = `${method}|${route}`;
  const current = requestDurations.get(durationKey) ?? { count: 0, totalMs: 0, maxMs: 0 };
  current.count += 1;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  requestDurations.set(durationKey, current);

  for (const bucket of durationBuckets) {
    if (durationMs <= bucket) {
      const keyForBucket = bucketKey(method, route, bucket);
      durationBucketCounts.set(keyForBucket, (durationBucketCounts.get(keyForBucket) ?? 0) + 1);
    }
  }
}

export function renderPrometheusMetrics(): string {
  const lines: string[] = [];
  lines.push("# HELP typeshift_http_requests_total Total HTTP requests.");
  lines.push("# TYPE typeshift_http_requests_total counter");
  for (const [key, count] of requestCounts.entries()) {
    const [method = "unknown", route = "unknown", status = "0"] = key.split("|");
    lines.push(
      `typeshift_http_requests_total{method="${quoteLabel(method)}",route="${quoteLabel(
        route,
      )}",status="${quoteLabel(status)}"} ${count}`,
    );
  }

  lines.push("# HELP typeshift_http_request_duration_ms Request duration summary in milliseconds.");
  lines.push("# TYPE typeshift_http_request_duration_ms summary");
  for (const [key, stats] of requestDurations.entries()) {
    const [method = "unknown", route = "unknown"] = key.split("|");
    const avg = stats.count > 0 ? stats.totalMs / stats.count : 0;
    lines.push(
      `typeshift_http_request_duration_ms_count{method="${quoteLabel(
        method,
      )}",route="${quoteLabel(route)}"} ${stats.count}`,
    );
    lines.push(
      `typeshift_http_request_duration_ms_sum{method="${quoteLabel(
        method,
      )}",route="${quoteLabel(route)}"} ${stats.totalMs.toFixed(3)}`,
    );
    lines.push(
      `typeshift_http_request_duration_ms_avg{method="${quoteLabel(
        method,
      )}",route="${quoteLabel(route)}"} ${avg.toFixed(3)}`,
    );
    lines.push(
      `typeshift_http_request_duration_ms_max{method="${quoteLabel(
        method,
      )}",route="${quoteLabel(route)}"} ${stats.maxMs.toFixed(3)}`,
    );
  }

  lines.push("# HELP typeshift_http_request_duration_bucket Cumulative duration bucket count.");
  lines.push("# TYPE typeshift_http_request_duration_bucket counter");
  for (const [key, count] of durationBucketCounts.entries()) {
    const [method = "unknown", route = "unknown", le = "+Inf"] = key.split("|");
    lines.push(
      `typeshift_http_request_duration_bucket{method="${quoteLabel(
        method,
      )}",route="${quoteLabel(route)}",le="${quoteLabel(le)}"} ${count}`,
    );
  }

  lines.push("# HELP process_uptime_seconds Process uptime in seconds.");
  lines.push("# TYPE process_uptime_seconds gauge");
  lines.push(`process_uptime_seconds ${Math.max(0, (Date.now() - startedAtMs) / 1000).toFixed(3)}`);

  lines.push("# HELP process_resident_memory_bytes Resident memory size in bytes.");
  lines.push("# TYPE process_resident_memory_bytes gauge");
  lines.push(`process_resident_memory_bytes ${process.memoryUsage().rss}`);

  lines.push("# HELP process_heap_used_bytes V8 heap used in bytes.");
  lines.push("# TYPE process_heap_used_bytes gauge");
  lines.push(`process_heap_used_bytes ${process.memoryUsage().heapUsed}`);

  return `${lines.join("\n")}\n`;
}
