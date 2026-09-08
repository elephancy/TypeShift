import assert from "node:assert/strict";
import test from "node:test";
import pino from "pino";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { config } from "../config.js";
import { resetInMemoryDatabase } from "../db/inMemory.js";
import { setDatabaseOnline } from "../db/state.js";
import { resetPlatformMemoryState } from "./platform.js";

async function withTestServer<T>(run: (input: { baseUrl: string }) => Promise<T>): Promise<T> {
  setDatabaseOnline(false);
  resetInMemoryDatabase();
  resetPlatformMemoryState();

  const app = createApp(pino({ level: "silent" }));
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await run({ baseUrl });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

test("leaderboard session flow submits and lists a score", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const init = await requestJson<{ sessionId: string; token: string }>(baseUrl, "/api/v1/session/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "time" }),
    });
    assert.equal(init.status, 201);

    const username = `pilot${Date.now().toString().slice(-6)}`;
    const submit = await requestJson<{ ok: true }>(baseUrl, "/api/v1/leaderboard/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${init.body.token}`,
      },
      body: JSON.stringify({
        sessionId: init.body.sessionId,
        mode: "time",
        username,
        wpm: 92,
        raw: 101,
        accuracy: 96,
        errors: 8,
        streak: 31,
        durationMs: 60_000,
        certified: false,
      }),
    });
    assert.equal(submit.status, 201);

    const board = await requestJson<{ entries: Array<{ username: string; wpm: number }> }>(
      baseUrl,
      "/api/v1/leaderboard?mode=time&limit=10",
    );
    assert.equal(board.status, 200);
    assert.ok(board.body.entries.some((entry) => entry.username === username && entry.wpm === 92));
  });
});

test("challenge flow accepts a valid daily score and exposes it on the board", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const daily = await requestJson<{ challenge: { date: string; mode: string; durationSec: number } }>(
      baseUrl,
      "/api/v1/challenge/daily",
    );
    assert.equal(daily.status, 200);

    const init = await requestJson<{ sessionId: string; token: string }>(baseUrl, "/api/v1/session/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: daily.body.challenge.mode }),
    });
    assert.equal(init.status, 201);

    const username = `daily${Date.now().toString().slice(-6)}`;
    const submit = await requestJson<{ ok: true; points: number }>(baseUrl, "/api/v1/challenge/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${init.body.token}`,
      },
      body: JSON.stringify({
        sessionId: init.body.sessionId,
        challengeDate: daily.body.challenge.date,
        mode: daily.body.challenge.mode,
        username,
        wpm: 81,
        raw: 90,
        accuracy: 95,
        errors: 6,
        streak: 24,
        durationMs: daily.body.challenge.durationSec * 1000,
      }),
    });
    assert.equal(submit.status, 201);
    assert.ok(submit.body.points > 0);

    const board = await requestJson<{ entries: Array<{ username: string }> }>(
      baseUrl,
      `/api/v1/challenge/leaderboard?date=${daily.body.challenge.date}&limit=10`,
    );
    assert.equal(board.status, 200);
    assert.ok(board.body.entries.some((entry) => entry.username === username));
  });
});

test("account lifecycle supports sessions, password rotation, export, and deletion", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const handle = `pilot${Date.now().toString().slice(-6)}`;
    const register = await requestJson<{ token: string; account: { handle: string } }>(
      baseUrl,
      "/api/v1/account/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle,
          password: "TestPassword123",
          locale: "en",
        }),
      },
    );
    assert.equal(register.status, 201);

    const secondLogin = await requestJson<{ token: string }>(baseUrl, "/api/v1/account/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        handle,
        password: "TestPassword123",
      }),
    });
    assert.equal(secondLogin.status, 200);

    const sessions = await requestJson<{ sessions: Array<{ id: string; isCurrent: boolean }> }>(
      baseUrl,
      "/api/v1/account/sessions",
      {
        headers: { Authorization: `Bearer ${register.body.token}` },
      },
    );
    assert.equal(sessions.status, 200);
    assert.equal(sessions.body.sessions.length, 2);

    const revokeOthers = await requestJson<{ ok: true }>(baseUrl, "/api/v1/account/logout-others", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${register.body.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    assert.equal(revokeOthers.status, 200);

    const revokedSessionCheck = await requestJson<{ error: string }>(baseUrl, "/api/v1/account/me", {
      headers: { Authorization: `Bearer ${secondLogin.body.token}` },
    });
    assert.equal(revokedSessionCheck.status, 401);

    const passwordChange = await requestJson<{ ok: true }>(baseUrl, "/api/v1/account/password", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${register.body.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        currentPassword: "TestPassword123",
        newPassword: "NewPassword123",
      }),
    });
    assert.equal(passwordChange.status, 200);

    const loginOldPassword = await requestJson<{ error: string }>(baseUrl, "/api/v1/account/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        handle,
        password: "TestPassword123",
      }),
    });
    assert.equal(loginOldPassword.status, 401);

    const loginNewPassword = await requestJson<{ token: string }>(baseUrl, "/api/v1/account/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        handle,
        password: "NewPassword123",
      }),
    });
    assert.equal(loginNewPassword.status, 200);

    const exportPayload = await requestJson<Record<string, unknown>>(baseUrl, "/api/v1/account/export", {
      headers: { Authorization: `Bearer ${loginNewPassword.body.token}` },
    });
    assert.equal(exportPayload.status, 200);
    assert.equal((exportPayload.body.account as { handle?: string } | undefined)?.handle, handle);

    const deletion = await requestJson<{ ok: true; deleted: boolean }>(baseUrl, "/api/v1/account", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${loginNewPassword.body.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ confirmHandle: handle }),
    });
    assert.equal(deletion.status, 200);
    assert.equal(deletion.body.deleted, true);

    const deletedLogin = await requestJson<{ error: string }>(baseUrl, "/api/v1/account/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        handle,
        password: "NewPassword123",
      }),
    });
    assert.equal(deletedLogin.status, 401);
  });
});

test("privacy analytics aggregates and summarizes events", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const first = await requestJson<{ ok: true }>(baseUrl, "/api/v1/privacy/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "page_view",
        page: "play",
        theme: "dark",
        consentVersion: 1,
        telemetry: {
          viewportBucket: "lg",
          reducedMotion: false,
        },
      }),
    });
    assert.equal(first.status, 202);

    const second = await requestJson<{ ok: true }>(baseUrl, "/api/v1/privacy/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "run_start",
        page: "play",
        mode: "meteor",
        theme: "dark",
        consentVersion: 1,
        telemetry: {
          viewportBucket: "lg",
          reducedMotion: false,
        },
      }),
    });
    assert.equal(second.status, 202);

    const summary = await requestJson<{
      totals: Record<string, number>;
      rows: Array<{ eventName: string; page: string | null }>;
    }>(
      baseUrl,
      "/api/v1/privacy/analytics/summary?days=1",
      config.METRICS_TOKEN
        ? { headers: { "X-Metrics-Token": config.METRICS_TOKEN } }
        : undefined,
    );
    assert.equal(summary.status, 200);
    assert.equal(summary.body.totals.page_view, 1);
    assert.equal(summary.body.totals.run_start, 1);
    assert.ok(summary.body.rows.some((row) => row.eventName === "page_view" && row.page === "play"));
  });
});
