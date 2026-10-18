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

The future enrollment reconciler should use a narrowly scoped Ops bootstrap key
held only in Actions, issue per-project ingestion credentials, register an OTLP
destination, preserve unrelated provider settings, and publish delivery/coverage
evidence to Ops. It must not grant an arbitrary future account service another
project's identity. This inventory workflow deliberately does not create that key
or alter live destinations.

## Provider references

- [Workers OpenTelemetry export](https://developers.cloudflare.com/workers/observability/opentelemetry-export/)
- [Create an observability destination](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/destinations/methods/create/)
- [Patch Worker script settings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/edit/)
- [Pages debugging and logging limitations](https://developers.cloudflare.com/pages/functions/debugging-and-logging/)
