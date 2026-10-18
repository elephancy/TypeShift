# Ops provider logging

The Ops provider inventory workflow runs an hourly, read-only account inventory
using the existing repository Cloudflare credentials. The credentials stay in
GitHub Actions; the workflow never reads application logs, prints API response
bodies, uploads credentials, or modifies provider settings. No dependency install
or application build is needed. Failed API reads fail the run instead of making
an inaccessible provider appear healthy.

Only the reviewed default branch can run the credential-bearing job. Worker
names/settings, Pages names/deployment metadata, and sanitized destination
metadata are reported. Binding values and destination authentication are omitted.
New account resources consequently appear in the next inventory without a new
application release. Inventory is discovery evidence, not delivery evidence.

## Enrollment seam

Cloudflare supports an account-level JSON OTLP logs destination and a per-Worker
`observability.logs.destinations` list. Enrollment must preserve existing
destinations, sampling/persistence choices, traces, tags, and bindings. The native
script-settings PATCH changes observability without replacing application code.
Read back the resulting settings and require a source event in Ops before marking
a service as covered. Add destination settings to each owned Wrangler config too,
so a future application deployment does not revert enrollment.

Cloudflare Pages documentation currently describes live deployment-tail sessions
whose logs do not persist. Pages therefore remains `persistent-source-unverified`
until its actual Functions/static deployment and a durable collection path are
verified. An inventory row or uptime probe does not establish request-log coverage.

## Automatic enrollment

`ops-provider-reconcile.yml` runs hourly or manually on reviewed main. It uses
`OPS_CLOUDFLARE_API_TOKEN` when set, otherwise the existing Cloudflare token. The
token needs Workers script-settings write, Workers Observability write, and Pages
metadata read access to the owned account. A permission failure stops enrollment.

The parent operator provisions `OPS_LOG_INGESTION_SEED` directly as an encrypted
Actions secret. Each Worker receives a separate ingestion bearer derived as
base64url(HMAC-SHA256(seed UTF-8, `cloudflare/WORKER_NAME`)). The seed and bearer
values never appear in artifacts or stdout. The source identity is bound by the
host manifest: known related Workers share their existing project with distinct
service names; a new Worker uses its own name as project/service.

The workflow publishes immutable artifact `ops-cloudflare-ingestion-manifest`
with exactly `ops-ingestion-keys.json` (version 1, SHA-256/project/service rows)
and `cloudflare-inventory.json` (sanitized inventory). The trusted host reconciler
must verify the successful default-branch workflow, exact source SHA, artifact
digest and bounded contents before accepting those hashes. Existing server keys
are preserved. Destination credentials remain only in Actions memory and the
Cloudflare destination configuration.

The enrollment phase configures `ops-logs-WORKER_NAME` destinations at
`https://ops.elfeel.me/logs/ingest/v1/logs`, appends them to each Worker's settings,
and checks provider readback. New Workers are enrolled in the next scheduled run.
An account inventory change between plan and enrollment stops that run so no
source is enrolled without its matching published hash.

The first export can precede host acceptance of the new manifest. Coverage must
therefore remain unverified until a real source event reaches Loki after the
manifest is installed. A PATCH response establishes configuration, not delivery.

The initial CI inventory on October 19, 2026 found seven Workers, including the
previously uncatalogued `foundroll-demo-proxy`. Existing TypeShift credentials
could read Worker settings but received HTTP 403/code 10000 for Pages metadata
and observability destinations; those missing permissions must be resolved
before native enrollment can run successfully.

## Provider references

- [Workers OpenTelemetry export](https://developers.cloudflare.com/workers/observability/opentelemetry-export/)
- [Create an observability destination](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/destinations/methods/create/)
- [Patch Worker script settings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/edit/)
- [Pages debugging and logging limitations](https://developers.cloudflare.com/pages/functions/debugging-and-logging/)
