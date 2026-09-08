import crypto, { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { config } from "../config.js";
import {
  deleteMemoryChallengeScoresByUsername,
  deleteMemoryScoresByUsername,
  getMemoryChallengeScoresByUsername,
  getMemoryScoresByUsername,
} from "../db/inMemory.js";
import { pool } from "../db/pool.js";
import { isDatabaseOnline } from "../db/state.js";
import {
  createPasswordHash,
  extractBearerToken,
  hashClientValue,
  normalizeUsername,
  passwordMeetsPolicy,
  signAccountToken,
  usernameMeetsPolicy,
  verifyAccountToken,
  verifyPasswordHash,
} from "../lib/security.js";
import { modeSchema, type Mode } from "../types.js";

interface MemoryAccount {
  id: string;
  handle: string;
  handleNormalized: string;
  passwordHash: string;
  passwordSalt: string;
  rating: number;
  locale: string;
  verifiedRuns: number;
  createdAt: string;
}

interface QueueEntry {
  accountId: string;
  handle: string;
  rating: number;
  queuedAt: number;
}

interface DuelPlayerState {
  accountId: string;
  handle: string;
  rating: number;
  progress: number;
  wpm: number;
  accuracy: number;
  finished: boolean;
}

interface DuelState {
  id: string;
  kind: "ranked" | "casual";
  status: "running" | "finished";
  createdAt: number;
  updatedAt: number;
  winnerAccountId: string | null;
  players: DuelPlayerState[];
}

interface WebhookEndpointState {
  id: string;
  accountId: string | null;
  targetUrl: string;
  secret: string;
  events: string[];
  active: boolean;
}

const memoryAccountsById = new Map<string, MemoryAccount>();
const memoryAccountsByHandle = new Map<string, MemoryAccount>();
const memoryPreferences = new Map<string, Record<string, unknown>>();
const memoryFriendRequests = new Map<
  string,
  {
    id: string;
    fromAccountId: string;
    toAccountId: string;
    status: "pending" | "accepted" | "declined";
    createdAt: string;
    respondedAt: string | null;
  }
>();
const memoryReplayShares = new Map<
  string,
  {
    id: string;
    accountId: string | null;
    mode: Mode;
    title: string;
    replay: Record<string, unknown>;
    isPublic: boolean;
    createdAt: string;
  }
>();
const memoryWebhooks = new Map<string, WebhookEndpointState>();
const rankedQueue: QueueEntry[] = [];
const casualQueue: QueueEntry[] = [];
const activeDuels = new Map<string, DuelState>();
const accountToDuel = new Map<string, string>();

const ACCOUNT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const MATCH_MAX_RATING_GAP = 250;
const WEBHOOK_EVENT_ALLOWLIST = new Set([
  "score.submitted",
  "challenge.submitted",
  "race.created",
  "race.finished",
  "tournament.finished",
  "webhook.test",
  "*",
]);

const registerSchema = z.object({
  handle: z.string().trim().min(2).max(24).refine(usernameMeetsPolicy, "Invalid handle"),
  password: z.string().min(10).max(128),
  locale: z.string().trim().min(2).max(12).default("en"),
});

const loginSchema = z.object({
  handle: z.string().trim().min(2).max(24),
  password: z.string().min(1).max(128),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(10).max(128),
});

const deleteAccountSchema = z.object({
  confirmHandle: z.string().trim().min(2).max(24),
});

const preferencesSchema = z.object({
  preferences: z.record(z.string(), z.unknown()),
});

const friendRequestSchema = z.object({
  handle: z.string().trim().min(2).max(24),
});

const friendRespondSchema = z.object({
  requestId: z.string().uuid(),
  accept: z.boolean(),
});

const replayShareSchema = z.object({
  mode: modeSchema,
  title: z.string().trim().min(2).max(80),
  replay: z.record(z.string(), z.unknown()),
  isPublic: z.boolean().default(true),
});

const webhookCreateSchema = z.object({
  targetUrl: z.string().url().max(300),
  events: z.array(z.string().trim().min(1).max(64)).min(1).max(12).default(["score.submitted"]),
});

const duelUpdateSchema = z.object({
  duelId: z.string().uuid(),
  progress: z.number().finite().min(0).max(100),
  wpm: z.number().finite().min(0).max(400),
  accuracy: z.number().finite().min(0).max(100),
  finished: z.boolean().default(false),
});

export function resetPlatformMemoryState(): void {
  memoryAccountsById.clear();
  memoryAccountsByHandle.clear();
  memoryPreferences.clear();
  memoryFriendRequests.clear();
  memoryReplayShares.clear();
  memoryWebhooks.clear();
  memoryAccountSessions.clear();
  rankedQueue.length = 0;
  casualQueue.length = 0;
  activeDuels.clear();
  accountToDuel.clear();
}

function normalizeHandle(raw: string): { handle: string; normalized: string } {
  const handle = normalizeUsername(raw);
  return { handle, normalized: handle.toLowerCase() };
}

function describeSessionLabel(userAgent?: string | null): string {
  const source = (userAgent ?? "").toLowerCase();
  const browser = source.includes("edg/")
    ? "Edge"
    : source.includes("firefox/")
      ? "Firefox"
      : source.includes("chrome/")
        ? "Chrome"
        : source.includes("safari/")
          ? "Safari"
          : "Browser";
  const os = source.includes("windows")
    ? "Windows"
    : source.includes("android")
      ? "Android"
      : source.includes("iphone") || source.includes("ipad") || source.includes("ios")
        ? "iOS"
        : source.includes("mac os") || source.includes("macintosh")
          ? "macOS"
          : source.includes("linux")
            ? "Linux"
            : "Unknown OS";
  return `${browser} on ${os}`;
}

interface MemoryAccountSession {
  id: string;
  accountId: string;
  label: string;
  userAgentHash: string;
  ipHash: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

const memoryAccountSessions = new Map<string, MemoryAccountSession>();

async function createAccountSession(input: {
  accountId: string;
  handle: string;
  req: Request;
}): Promise<{ sessionId: string; token: string }> {
  const sessionId = randomUUID();
  const label = describeSessionLabel(input.req.get("user-agent"));
  const userAgentHash = hashClientValue(input.req.get("user-agent") ?? "");
  const ipHash = hashClientValue(input.req.ip ?? "0.0.0.0");
  const expiresAt = new Date(Date.now() + ACCOUNT_SESSION_TTL_MS).toISOString();
  if (!isDatabaseOnline()) {
    memoryAccountSessions.set(sessionId, {
      id: sessionId,
      accountId: input.accountId,
      label,
      userAgentHash,
      ipHash,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      expiresAt,
      revokedAt: null,
    });
    return {
      sessionId,
      token: signAccountToken(sessionId, input.accountId, input.handle),
    };
  }
  await pool.query(
    `INSERT INTO account_sessions (id, account_id, label, user_agent_hash, ip_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, input.accountId, label, userAgentHash, ipHash, expiresAt],
  );
  return {
    sessionId,
    token: signAccountToken(sessionId, input.accountId, input.handle),
  };
}

async function getAuthedAccount(
  req: Request,
): Promise<{ id: string; handle: string; rating: number; sessionId: string } | null> {
  const token = extractBearerToken(req.get("authorization"));
  if (!token) return null;
  const verified = verifyAccountToken(token);
  if (!verified) return null;
  if (!isDatabaseOnline()) {
    const account = memoryAccountsById.get(verified.aid);
    const session = memoryAccountSessions.get(verified.sid);
    if (!account || !session || session.accountId !== account.id || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) {
      return null;
    }
    session.lastSeenAt = new Date().toISOString();
    return { id: account.id, handle: account.handle, rating: account.rating, sessionId: session.id };
  }
  const result = await pool.query(
    `SELECT a.id, a.handle, a.rating, s.id AS session_id
       FROM accounts a
       JOIN account_sessions s ON s.account_id = a.id
      WHERE a.id = $1
        AND s.id = $2
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()`,
    [verified.aid, verified.sid],
  );
  if (result.rowCount !== 1) return null;
  await pool.query(
    `UPDATE account_sessions
        SET last_seen_at = NOW()
      WHERE id = $1
        AND last_seen_at < NOW() - INTERVAL '1 minute'`,
    [verified.sid],
  );
  const row = result.rows[0] as { id: string; handle: string; rating: number; session_id: string };
  return { id: row.id, handle: row.handle, rating: Number(row.rating), sessionId: row.session_id };
}

function removeFromQueue(queue: QueueEntry[], accountId: string): void {
  const index = queue.findIndex((entry) => entry.accountId === accountId);
  if (index >= 0) {
    queue.splice(index, 1);
  }
}

function startDuel(kind: "ranked" | "casual", a: QueueEntry, b: QueueEntry): DuelState {
  const duel: DuelState = {
    id: randomUUID(),
    kind,
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    winnerAccountId: null,
    players: [
      {
        accountId: a.accountId,
        handle: a.handle,
        rating: a.rating,
        progress: 0,
        wpm: 0,
        accuracy: 100,
        finished: false,
      },
      {
        accountId: b.accountId,
        handle: b.handle,
        rating: b.rating,
        progress: 0,
        wpm: 0,
        accuracy: 100,
        finished: false,
      },
    ],
  };
  activeDuels.set(duel.id, duel);
  accountToDuel.set(a.accountId, duel.id);
  accountToDuel.set(b.accountId, duel.id);
  return duel;
}

function findRankedMatch(entry: QueueEntry): QueueEntry | null {
  let best: { score: number; entry: QueueEntry } | null = null;
  for (const candidate of rankedQueue) {
    if (candidate.accountId === entry.accountId) continue;
    const ratingGap = Math.abs(candidate.rating - entry.rating);
    if (ratingGap > MATCH_MAX_RATING_GAP) continue;
    const waitPenalty = Math.abs(candidate.queuedAt - entry.queuedAt) / 1000;
    const score = ratingGap + waitPenalty;
    if (!best || score < best.score) {
      best = { score, entry: candidate };
    }
  }
  return best?.entry ?? null;
}

function serializeDuel(duel: DuelState) {
  return {
    id: duel.id,
    kind: duel.kind,
    status: duel.status,
    createdAt: duel.createdAt,
    updatedAt: duel.updatedAt,
    winnerAccountId: duel.winnerAccountId,
    players: duel.players,
  };
}

function signWebhookPayload(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function isLocalOrPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost") return true;
  if (lower === "::1") return true;
  if (lower.startsWith("127.")) return true;
  if (lower.startsWith("10.")) return true;
  if (lower.startsWith("192.168.")) return true;
  if (lower.startsWith("169.254.")) return true;
  if (lower.startsWith("172.")) {
    const second = Number.parseInt(lower.split(".")[1] ?? "", 10);
    if (Number.isFinite(second) && second >= 16 && second <= 31) {
      return true;
    }
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80:")) return true;
  return false;
}

function isWebhookTargetAllowed(targetUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch (_error) {
    return false;
  }
  const protocol = parsed.protocol.toLowerCase();
  const hostname = parsed.hostname.trim();
  if (!hostname || parsed.username || parsed.password) {
    return false;
  }
  const localOrPrivate = isLocalOrPrivateHostname(hostname);
  if (config.NODE_ENV === "production") {
    if (protocol !== "https:") return false;
    if (localOrPrivate) return false;
    return true;
  }
  if (protocol === "https:") return true;
  if (protocol === "http:" && localOrPrivate) return true;
  return false;
}

async function persistWebhookDelivery(input: {
  webhookId: string;
  eventName: string;
  status: "ok" | "failed";
  responseCode: number | null;
  payload: Record<string, unknown>;
}): Promise<void> {
  if (!isDatabaseOnline()) {
    return;
  }
  await pool.query(
    `INSERT INTO webhook_deliveries (id, webhook_id, event_name, status, response_code, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), input.webhookId, input.eventName, input.status, input.responseCode, input.payload],
  );
}

async function listWebhookTargets(eventName: string): Promise<WebhookEndpointState[]> {
  if (!isDatabaseOnline()) {
    return [...memoryWebhooks.values()].filter(
      (endpoint) => endpoint.active && (endpoint.events.includes("*") || endpoint.events.includes(eventName)),
    );
  }
  const result = await pool.query(
    `SELECT id, account_id, target_url, secret, events, active
       FROM webhook_endpoints
      WHERE active = TRUE
        AND (events @> ARRAY[$1]::text[] OR events @> ARRAY['*']::text[])`,
    [eventName],
  );
  return result.rows.map((row) => ({
    id: row.id as string,
    accountId: (row.account_id as string | null) ?? null,
    targetUrl: row.target_url as string,
    secret: row.secret as string,
    events: (row.events as string[]) ?? ["score.submitted"],
    active: Boolean(row.active),
  }));
}

export async function emitWebhookEvent(
  eventName: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const endpoints = await listWebhookTargets(eventName);
  if (endpoints.length === 0) {
    return;
  }

  const envelope = {
    event: eventName,
    sentAt: new Date().toISOString(),
    payload,
  };
  const body = JSON.stringify(envelope);

  await Promise.all(
    endpoints.map(async (endpoint) => {
      const signature = signWebhookPayload(endpoint.secret, body);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(endpoint.targetUrl, {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            "X-TypeShift-Event": eventName,
            "X-TypeShift-Signature": signature,
            "User-Agent": "TypeShift-Webhook/1.0",
          },
          body,
          signal: controller.signal,
        });
        await persistWebhookDelivery({
          webhookId: endpoint.id,
          eventName,
          status: response.ok ? "ok" : "failed",
          responseCode: response.status,
          payload,
        });
      } catch (_error) {
        await persistWebhookDelivery({
          webhookId: endpoint.id,
          eventName,
          status: "failed",
          responseCode: null,
          payload,
        });
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}

const router = Router();

router.post("/account/register", async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid registration payload" });
    }
    if (!passwordMeetsPolicy(parsed.data.password)) {
      return res.status(422).json({
        error: "Password must be 10+ chars and include uppercase, lowercase, and number",
      });
    }

    const normalized = normalizeHandle(parsed.data.handle);
    const password = createPasswordHash(parsed.data.password);

    if (!isDatabaseOnline()) {
      if (memoryAccountsByHandle.has(normalized.normalized)) {
        return res.status(409).json({ error: "Handle is already taken" });
      }
      const account: MemoryAccount = {
        id: randomUUID(),
        handle: normalized.handle,
        handleNormalized: normalized.normalized,
        passwordHash: password.hash,
        passwordSalt: password.salt,
        rating: 1000,
        locale: parsed.data.locale.toLowerCase(),
        verifiedRuns: 0,
        createdAt: new Date().toISOString(),
      };
      memoryAccountsById.set(account.id, account);
      memoryAccountsByHandle.set(account.handleNormalized, account);
      memoryPreferences.set(account.id, {});
      const session = await createAccountSession({ accountId: account.id, handle: account.handle, req });
      return res.status(201).json({
        token: session.token,
        account: {
          id: account.id,
          handle: account.handle,
          rating: account.rating,
          locale: account.locale,
          verifiedRuns: account.verifiedRuns,
          createdAt: account.createdAt,
          sessionTtlMs: ACCOUNT_SESSION_TTL_MS,
        },
      });
    }

    const accountId = randomUUID();
    const result = await pool.query(
      `INSERT INTO accounts (
         id, handle, handle_normalized, password_hash, password_salt, rating, locale
       ) VALUES ($1, $2, $3, $4, $5, 1000, $6)
       ON CONFLICT (handle_normalized) DO NOTHING`,
      [accountId, normalized.handle, normalized.normalized, password.hash, password.salt, parsed.data.locale.toLowerCase()],
    );
    if (result.rowCount !== 1) {
      return res.status(409).json({ error: "Handle is already taken" });
    }
    await pool.query(
      `INSERT INTO account_preferences (account_id, preferences)
       VALUES ($1, '{}'::jsonb)
       ON CONFLICT (account_id) DO NOTHING`,
      [accountId],
    );
    const session = await createAccountSession({ accountId, handle: normalized.handle, req });
    return res.status(201).json({
      token: session.token,
      account: {
        id: accountId,
        handle: normalized.handle,
        rating: 1000,
        locale: parsed.data.locale.toLowerCase(),
        verifiedRuns: 0,
        createdAt: new Date().toISOString(),
        sessionTtlMs: ACCOUNT_SESSION_TTL_MS,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/account/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid login payload" });
    }
    const normalized = normalizeHandle(parsed.data.handle).normalized;

    if (!isDatabaseOnline()) {
      const account = memoryAccountsByHandle.get(normalized);
      if (!account || !verifyPasswordHash(parsed.data.password, account.passwordSalt, account.passwordHash)) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const session = await createAccountSession({ accountId: account.id, handle: account.handle, req });
      return res.json({
        token: session.token,
        account: {
          id: account.id,
          handle: account.handle,
          rating: account.rating,
          locale: account.locale,
          verifiedRuns: account.verifiedRuns,
          createdAt: account.createdAt,
          sessionTtlMs: ACCOUNT_SESSION_TTL_MS,
        },
      });
    }

    const result = await pool.query(
      `SELECT id, handle, password_hash, password_salt, rating, locale, verified_runs, created_at
         FROM accounts
        WHERE handle_normalized = $1`,
      [normalized],
    );
    if (result.rowCount !== 1) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const row = result.rows[0] as {
      id: string;
      handle: string;
      password_hash: string;
      password_salt: string;
      rating: number;
      locale: string;
      verified_runs: number;
      created_at: string;
    };
    const ok = verifyPasswordHash(parsed.data.password, row.password_salt, row.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const session = await createAccountSession({ accountId: row.id, handle: row.handle, req });
    return res.json({
      token: session.token,
      account: {
        id: row.id,
        handle: row.handle,
        rating: Number(row.rating),
        locale: row.locale,
        verifiedRuns: Number(row.verified_runs),
        createdAt: row.created_at,
        sessionTtlMs: ACCOUNT_SESSION_TTL_MS,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/account/me", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!isDatabaseOnline()) {
      const memory = memoryAccountsById.get(account.id);
      const preferences = memoryPreferences.get(account.id) ?? {};
      return res.json({
        account: {
          id: memory?.id ?? account.id,
          handle: memory?.handle ?? account.handle,
          rating: memory?.rating ?? account.rating,
          locale: memory?.locale ?? "en",
          verifiedRuns: memory?.verifiedRuns ?? 0,
          createdAt: memory?.createdAt ?? new Date().toISOString(),
        },
        preferences,
      });
    }
    const result = await pool.query(
      `SELECT a.id, a.handle, a.rating, a.locale, a.verified_runs, a.created_at, p.preferences
         FROM accounts a
    LEFT JOIN account_preferences p ON p.account_id = a.id
        WHERE a.id = $1`,
      [account.id],
    );
    if (result.rowCount !== 1) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const row = result.rows[0] as {
      id: string;
      handle: string;
      rating: number;
      locale: string;
      verified_runs: number;
      created_at: string;
      preferences: Record<string, unknown> | null;
    };
    return res.json({
      account: {
        id: row.id,
        handle: row.handle,
        rating: Number(row.rating),
        locale: row.locale,
        verifiedRuns: Number(row.verified_runs),
        createdAt: row.created_at,
      },
      preferences: row.preferences ?? {},
    });
  } catch (error) {
    return next(error);
  }
});

router.put("/account/preferences", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const parsed = preferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid preferences payload" });
    }
    if (!isDatabaseOnline()) {
      memoryPreferences.set(account.id, parsed.data.preferences);
      return res.json({ ok: true, preferences: parsed.data.preferences });
    }
    await pool.query(
      `INSERT INTO account_preferences (account_id, preferences, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (account_id)
       DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = NOW()`,
      [account.id, parsed.data.preferences],
    );
    return res.json({ ok: true, preferences: parsed.data.preferences });
  } catch (error) {
    return next(error);
  }
});

router.get("/account/sessions", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!isDatabaseOnline()) {
      const sessions = [...memoryAccountSessions.values()]
        .filter((session) => session.accountId === account.id && !session.revokedAt)
        .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
        .map((session) => ({
          id: session.id,
          label: session.label,
          createdAt: session.createdAt,
          lastSeenAt: session.lastSeenAt,
          expiresAt: session.expiresAt,
          isCurrent: session.id === account.sessionId,
        }));
      return res.json({ currentSessionId: account.sessionId, sessions });
    }
    const result = await pool.query(
      `SELECT id, label, created_at, last_seen_at, expires_at
         FROM account_sessions
        WHERE account_id = $1
          AND revoked_at IS NULL
          AND expires_at > NOW()
        ORDER BY last_seen_at DESC, created_at DESC`,
      [account.id],
    );
    return res.json({
      currentSessionId: account.sessionId,
      sessions: result.rows.map((row) => ({
        id: row.id as string,
        label: row.label as string,
        createdAt: row.created_at as string,
        lastSeenAt: row.last_seen_at as string,
        expiresAt: row.expires_at as string,
        isCurrent: row.id === account.sessionId,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/account/logout", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!isDatabaseOnline()) {
      const session = memoryAccountSessions.get(account.sessionId);
      if (session) {
        session.revokedAt = new Date().toISOString();
      }
      return res.json({ ok: true });
    }
    await pool.query(
      `UPDATE account_sessions
          SET revoked_at = NOW()
        WHERE id = $1
          AND account_id = $2`,
      [account.sessionId, account.id],
    );
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/account/logout-others", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!isDatabaseOnline()) {
      for (const session of memoryAccountSessions.values()) {
        if (session.accountId === account.id && session.id !== account.sessionId) {
          session.revokedAt = new Date().toISOString();
        }
      }
      return res.json({ ok: true });
    }
    await pool.query(
      `UPDATE account_sessions
          SET revoked_at = NOW()
        WHERE account_id = $1
          AND id <> $2
          AND revoked_at IS NULL`,
      [account.id, account.sessionId],
    );
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.delete("/account/sessions/:id", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const targetSessionId = req.params.id;
    if (!targetSessionId) {
      return res.status(400).json({ error: "Missing session id" });
    }
    if (!isDatabaseOnline()) {
      const session = memoryAccountSessions.get(targetSessionId);
      if (!session || session.accountId !== account.id) {
        return res.status(404).json({ error: "Session not found" });
      }
      session.revokedAt = new Date().toISOString();
      return res.json({ ok: true, currentSessionRevoked: targetSessionId === account.sessionId });
    }
    const result = await pool.query(
      `UPDATE account_sessions
          SET revoked_at = NOW()
        WHERE id = $1
          AND account_id = $2
          AND revoked_at IS NULL`,
      [targetSessionId, account.id],
    );
    if (result.rowCount !== 1) {
      return res.status(404).json({ error: "Session not found" });
    }
    return res.json({ ok: true, currentSessionRevoked: targetSessionId === account.sessionId });
  } catch (error) {
    return next(error);
  }
});

router.post("/account/password", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const parsed = passwordChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid password change payload" });
    }
    if (!passwordMeetsPolicy(parsed.data.newPassword)) {
      return res.status(422).json({
        error: "Password must be 10+ chars and include uppercase, lowercase, and number",
      });
    }

    if (!isDatabaseOnline()) {
      const memory = memoryAccountsById.get(account.id);
      if (!memory || !verifyPasswordHash(parsed.data.currentPassword, memory.passwordSalt, memory.passwordHash)) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }
      const nextPassword = createPasswordHash(parsed.data.newPassword);
      memory.passwordHash = nextPassword.hash;
      memory.passwordSalt = nextPassword.salt;
      for (const session of memoryAccountSessions.values()) {
        if (session.accountId === account.id && session.id !== account.sessionId) {
          session.revokedAt = new Date().toISOString();
        }
      }
      return res.json({ ok: true });
    }

    const result = await pool.query(
      `SELECT password_hash, password_salt
         FROM accounts
        WHERE id = $1`,
      [account.id],
    );
    if (result.rowCount !== 1) {
      return res.status(404).json({ error: "Account not found" });
    }
    const row = result.rows[0] as { password_hash: string; password_salt: string };
    if (!verifyPasswordHash(parsed.data.currentPassword, row.password_salt, row.password_hash)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    const nextPassword = createPasswordHash(parsed.data.newPassword);
    await pool.query(
      `UPDATE accounts
          SET password_hash = $2,
              password_salt = $3
        WHERE id = $1`,
      [account.id, nextPassword.hash, nextPassword.salt],
    );
    await pool.query(
      `UPDATE account_sessions
          SET revoked_at = NOW()
        WHERE account_id = $1
          AND id <> $2
          AND revoked_at IS NULL`,
      [account.id, account.sessionId],
    );
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/account/export", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!isDatabaseOnline()) {
      const preferences = memoryPreferences.get(account.id) ?? {};
      const sessions = [...memoryAccountSessions.values()]
        .filter((session) => session.accountId === account.id)
        .map((session) => ({
          id: session.id,
          label: session.label,
          createdAt: session.createdAt,
          lastSeenAt: session.lastSeenAt,
          expiresAt: session.expiresAt,
          revokedAt: session.revokedAt,
        }));
      const replayShares = [...memoryReplayShares.values()].filter((entry) => entry.accountId === account.id);
      const webhooks = [...memoryWebhooks.values()].filter((entry) => entry.accountId === account.id);
      return res.json({
        exportedAt: new Date().toISOString(),
        account: memoryAccountsById.get(account.id),
        preferences,
        sessions,
        replayShares,
        webhooks,
        scores: getMemoryScoresByUsername(account.handle),
        challengeScores: getMemoryChallengeScoresByUsername(account.handle),
      });
    }

    const [accountResult, sessionsResult, replayResult, webhookResult, scoresResult, challengeScoresResult] =
      await Promise.all([
        pool.query(
          `SELECT a.id, a.handle, a.rating, a.locale, a.verified_runs, a.created_at, p.preferences
             FROM accounts a
             LEFT JOIN account_preferences p ON p.account_id = a.id
            WHERE a.id = $1`,
          [account.id],
        ),
        pool.query(
          `SELECT id, label, created_at, last_seen_at, expires_at, revoked_at
             FROM account_sessions
            WHERE account_id = $1
            ORDER BY created_at DESC`,
          [account.id],
        ),
        pool.query(
          `SELECT id, mode, title, replay, is_public, created_at
             FROM shared_replays
            WHERE account_id = $1
            ORDER BY created_at DESC`,
          [account.id],
        ),
        pool.query(
          `SELECT id, target_url, events, active, created_at
             FROM webhook_endpoints
            WHERE account_id = $1
            ORDER BY created_at DESC`,
          [account.id],
        ),
        pool.query(
          `SELECT id, username, mode, wpm, raw, accuracy, errors, streak, duration_ms, certified, created_at
             FROM scores
            WHERE username = $1
            ORDER BY created_at DESC
            LIMIT 5000`,
          [account.handle],
        ),
        pool.query(
          `SELECT id, challenge_date, username, mode, wpm, raw, accuracy, errors, streak, duration_ms, points, created_at
             FROM challenge_scores
            WHERE username = $1
            ORDER BY created_at DESC
            LIMIT 5000`,
          [account.handle],
        ),
      ]);

    return res.json({
      exportedAt: new Date().toISOString(),
      account: accountResult.rows[0] ?? null,
      preferences: (accountResult.rows[0]?.preferences as Record<string, unknown> | null) ?? {},
      sessions: sessionsResult.rows,
      replayShares: replayResult.rows,
      webhooks: webhookResult.rows,
      scores: scoresResult.rows,
      challengeScores: challengeScoresResult.rows,
    });
  } catch (error) {
    return next(error);
  }
});

router.delete("/account", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const parsed = deleteAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid account deletion payload" });
    }
    if (normalizeHandle(parsed.data.confirmHandle).normalized !== normalizeHandle(account.handle).normalized) {
      return res.status(422).json({ error: "Handle confirmation does not match" });
    }

    removeFromQueue(rankedQueue, account.id);
    removeFromQueue(casualQueue, account.id);
    const duelId = accountToDuel.get(account.id);
    if (duelId) {
      activeDuels.delete(duelId);
      for (const [key, value] of accountToDuel.entries()) {
        if (value === duelId) {
          accountToDuel.delete(key);
        }
      }
    }

    if (!isDatabaseOnline()) {
      memoryAccountsById.delete(account.id);
      memoryAccountsByHandle.delete(normalizeHandle(account.handle).normalized);
      memoryPreferences.delete(account.id);
      for (const [id, session] of memoryAccountSessions.entries()) {
        if (session.accountId === account.id) {
          memoryAccountSessions.delete(id);
        }
      }
      for (const [id, row] of memoryFriendRequests.entries()) {
        if (row.fromAccountId === account.id || row.toAccountId === account.id) {
          memoryFriendRequests.delete(id);
        }
      }
      for (const [id, row] of memoryReplayShares.entries()) {
        if (row.accountId === account.id) {
          memoryReplayShares.delete(id);
        }
      }
      for (const [id, row] of memoryWebhooks.entries()) {
        if (row.accountId === account.id) {
          memoryWebhooks.delete(id);
        }
      }
      deleteMemoryScoresByUsername(account.handle);
      deleteMemoryChallengeScoresByUsername(account.handle);
      return res.json({ ok: true, deleted: true });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM scores WHERE username = $1`, [account.handle]);
      await client.query(`DELETE FROM challenge_scores WHERE username = $1`, [account.handle]);
      await client.query(`DELETE FROM shared_replays WHERE account_id = $1`, [account.id]);
      await client.query(
        `DELETE FROM account_friend_requests WHERE from_account_id = $1 OR to_account_id = $1`,
        [account.id],
      );
      await client.query(`DELETE FROM webhook_endpoints WHERE account_id = $1`, [account.id]);
      await client.query(`DELETE FROM account_sessions WHERE account_id = $1`, [account.id]);
      await client.query(`DELETE FROM account_preferences WHERE account_id = $1`, [account.id]);
      const deleteAccountResult = await client.query(`DELETE FROM accounts WHERE id = $1`, [account.id]);
      if (deleteAccountResult.rowCount !== 1) {
        throw new Error("Account deletion failed");
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return res.json({ ok: true, deleted: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/friends/request", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) return res.status(401).json({ error: "Unauthorized" });
    const parsed = friendRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid friend request payload" });
    const targetNormalized = normalizeHandle(parsed.data.handle).normalized;
    const ownNormalized = account.handle.toLowerCase();
    if (targetNormalized === ownNormalized) {
      return res.status(422).json({ error: "Cannot add yourself" });
    }

    if (!isDatabaseOnline()) {
      const target = memoryAccountsByHandle.get(targetNormalized);
      if (!target) return res.status(404).json({ error: "Account not found" });

      const reverse = [...memoryFriendRequests.values()].find(
        (row) =>
          row.fromAccountId === target.id &&
          row.toAccountId === account.id &&
          row.status === "pending",
      );
      if (reverse) {
        reverse.status = "accepted";
        reverse.respondedAt = new Date().toISOString();
        return res.json({ ok: true, matched: true, requestId: reverse.id });
      }

      const requestId = randomUUID();
      memoryFriendRequests.set(requestId, {
        id: requestId,
        fromAccountId: account.id,
        toAccountId: target.id,
        status: "pending",
        createdAt: new Date().toISOString(),
        respondedAt: null,
      });
      return res.status(201).json({ ok: true, matched: false, requestId });
    }

    const targetResult = await pool.query(
      `SELECT id FROM accounts WHERE handle_normalized = $1`,
      [targetNormalized],
    );
    if (targetResult.rowCount !== 1) {
      return res.status(404).json({ error: "Account not found" });
    }
    const targetId = targetResult.rows[0]?.id as string;

    const reversePending = await pool.query(
      `SELECT id
         FROM account_friend_requests
        WHERE from_account_id = $1
          AND to_account_id = $2
          AND status = 'pending'`,
      [targetId, account.id],
    );
    if (reversePending.rowCount === 1) {
      await pool.query(
        `UPDATE account_friend_requests
            SET status = 'accepted', responded_at = NOW()
          WHERE id = $1`,
        [reversePending.rows[0]?.id],
      );
      return res.json({ ok: true, matched: true, requestId: reversePending.rows[0]?.id });
    }

    const requestId = randomUUID();
    await pool.query(
      `INSERT INTO account_friend_requests (id, from_account_id, to_account_id, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (from_account_id, to_account_id)
       DO UPDATE SET status = 'pending', responded_at = NULL`,
      [requestId, account.id, targetId],
    );
    return res.status(201).json({ ok: true, matched: false, requestId });
  } catch (error) {
    return next(error);
  }
});

router.post("/friends/respond", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) return res.status(401).json({ error: "Unauthorized" });
    const parsed = friendRespondSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid friend response payload" });
    const status = parsed.data.accept ? "accepted" : "declined";

    if (!isDatabaseOnline()) {
      const request = memoryFriendRequests.get(parsed.data.requestId);
      if (!request || request.toAccountId !== account.id || request.status !== "pending") {
        return res.status(404).json({ error: "Request not found" });
      }
      request.status = status;
      request.respondedAt = new Date().toISOString();
      return res.json({ ok: true, status });
    }

    const result = await pool.query(
      `UPDATE account_friend_requests
          SET status = $2, responded_at = NOW()
        WHERE id = $1
          AND to_account_id = $3
          AND status = 'pending'
      RETURNING id`,
      [parsed.data.requestId, status, account.id],
    );
    if (result.rowCount !== 1) {
      return res.status(404).json({ error: "Request not found" });
    }
    return res.json({ ok: true, status });
  } catch (error) {
    return next(error);
  }
});

router.get("/friends/list", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) return res.status(401).json({ error: "Unauthorized" });

    if (!isDatabaseOnline()) {
      const accepted = [...memoryFriendRequests.values()].filter(
        (row) => row.status === "accepted" && (row.fromAccountId === account.id || row.toAccountId === account.id),
      );
      const pendingIncoming = [...memoryFriendRequests.values()].filter(
        (row) => row.status === "pending" && row.toAccountId === account.id,
      );
      const pendingOutgoing = [...memoryFriendRequests.values()].filter(
        (row) => row.status === "pending" && row.fromAccountId === account.id,
      );
      return res.json({
        friends: accepted.map((row) => {
          const friendId = row.fromAccountId === account.id ? row.toAccountId : row.fromAccountId;
          const friend = memoryAccountsById.get(friendId);
          return {
            id: friendId,
            handle: friend?.handle ?? "unknown",
            rating: friend?.rating ?? 1000,
          };
        }),
        incoming: pendingIncoming.map((row) => ({
          requestId: row.id,
          fromAccountId: row.fromAccountId,
          fromHandle: memoryAccountsById.get(row.fromAccountId)?.handle ?? "unknown",
          createdAt: row.createdAt,
        })),
        outgoing: pendingOutgoing.map((row) => ({
          requestId: row.id,
          toAccountId: row.toAccountId,
          toHandle: memoryAccountsById.get(row.toAccountId)?.handle ?? "unknown",
          createdAt: row.createdAt,
        })),
      });
    }

    const result = await pool.query(
      `WITH accepted AS (
         SELECT CASE WHEN from_account_id = $1 THEN to_account_id ELSE from_account_id END AS friend_id
           FROM account_friend_requests
          WHERE status = 'accepted'
            AND (from_account_id = $1 OR to_account_id = $1)
       ),
       incoming AS (
         SELECT fr.id, fr.from_account_id, a.handle, fr.created_at
           FROM account_friend_requests fr
           JOIN accounts a ON a.id = fr.from_account_id
          WHERE fr.status = 'pending' AND fr.to_account_id = $1
       ),
       outgoing AS (
         SELECT fr.id, fr.to_account_id, a.handle, fr.created_at
           FROM account_friend_requests fr
           JOIN accounts a ON a.id = fr.to_account_id
          WHERE fr.status = 'pending' AND fr.from_account_id = $1
       )
       SELECT
         COALESCE(
           (SELECT json_agg(json_build_object('id', a.id, 'handle', a.handle, 'rating', a.rating))
              FROM accepted acc
              JOIN accounts a ON a.id = acc.friend_id),
           '[]'::json
         ) AS friends,
         COALESCE(
           (SELECT json_agg(json_build_object('requestId', i.id, 'fromAccountId', i.from_account_id, 'fromHandle', i.handle, 'createdAt', i.created_at))
              FROM incoming i),
           '[]'::json
         ) AS incoming,
         COALESCE(
           (SELECT json_agg(json_build_object('requestId', o.id, 'toAccountId', o.to_account_id, 'toHandle', o.handle, 'createdAt', o.created_at))
              FROM outgoing o),
           '[]'::json
         ) AS outgoing`,
      [account.id],
    );
    const row = result.rows[0] as {
      friends: unknown[];
      incoming: unknown[];
      outgoing: unknown[];
    };
    return res.json({
      friends: Array.isArray(row.friends) ? row.friends : [],
      incoming: Array.isArray(row.incoming) ? row.incoming : [],
      outgoing: Array.isArray(row.outgoing) ? row.outgoing : [],
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/matchmaking/ranked/enqueue", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) return res.status(401).json({ error: "Unauthorized" });

    const activeId = accountToDuel.get(account.id);
    if (activeId) {
      const duel = activeDuels.get(activeId);
      if (duel) {
        return res.json({ status: "matched", duel: serializeDuel(duel) });
      }
    }

    removeFromQueue(casualQueue, account.id);
    removeFromQueue(rankedQueue, account.id);

    const entry: QueueEntry = {
      accountId: account.id,
      handle: account.handle,
      rating: account.rating,
      queuedAt: Date.now(),
    };
    const opponent = findRankedMatch(entry);
    if (!opponent) {
      rankedQueue.push(entry);
      return res.status(202).json({ status: "waiting", queueSize: rankedQueue.length });
    }
    removeFromQueue(rankedQueue, opponent.accountId);
    const duel = startDuel("ranked", entry, opponent);
    return res.json({ status: "matched", duel: serializeDuel(duel) });
  } catch (error) {
    return next(error);
  }
});

router.get("/matchmaking/ranked/status", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) return res.status(401).json({ error: "Unauthorized" });
    const activeId = accountToDuel.get(account.id);
    if (activeId) {
      const duel = activeDuels.get(activeId);
      if (duel) {
        return res.json({ status: "matched", duel: serializeDuel(duel) });
      }
    }
    const index = rankedQueue.findIndex((entry) => entry.accountId === account.id);
    if (index >= 0) {
      return res.json({ status: "waiting", queuePosition: index + 1, queueSize: rankedQueue.length });
    }
    return res.json({ status: "idle" });
  } catch (error) {
    return next(error);
  }
});

router.post("/duel/queue", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) return res.status(401).json({ error: "Unauthorized" });
    const activeId = accountToDuel.get(account.id);
    if (activeId) {
      const duel = activeDuels.get(activeId);
      if (duel) {
        return res.json({ status: "matched", duel: serializeDuel(duel) });
      }
    }
    removeFromQueue(rankedQueue, account.id);
    removeFromQueue(casualQueue, account.id);
    const entry: QueueEntry = {
      accountId: account.id,
      handle: account.handle,
      rating: account.rating,
      queuedAt: Date.now(),
    };
    const opponent = casualQueue.shift();
    if (!opponent) {
      casualQueue.push(entry);
      return res.status(202).json({ status: "waiting", queueSize: casualQueue.length });
    }
    const duel = startDuel("casual", entry, opponent);
    return res.json({ status: "matched", duel: serializeDuel(duel) });
  } catch (error) {
    return next(error);
  }
});

router.get("/duel/state", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) return res.status(401).json({ error: "Unauthorized" });
    const duelId = typeof req.query.duelId === "string" ? req.query.duelId : accountToDuel.get(account.id);
    if (!duelId) {
      return res.status(404).json({ error: "Duel not found" });
    }
    const duel = activeDuels.get(duelId);
    if (!duel) {
      return res.status(404).json({ error: "Duel not found" });
    }
    if (!duel.players.some((player) => player.accountId === account.id)) {
      return res.status(403).json({ error: "Forbidden duel access" });
    }
    return res.json({ duel: serializeDuel(duel) });
  } catch (error) {
    return next(error);
  }
});

router.post("/duel/update", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) return res.status(401).json({ error: "Unauthorized" });
    const parsed = duelUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid duel update payload" });
    const duel = activeDuels.get(parsed.data.duelId);
    if (!duel) return res.status(404).json({ error: "Duel not found" });
    const player = duel.players.find((item) => item.accountId === account.id);
    if (!player) return res.status(403).json({ error: "Forbidden duel access" });

    player.progress = parsed.data.progress;
    player.wpm = parsed.data.wpm;
    player.accuracy = parsed.data.accuracy;
    player.finished = parsed.data.finished;
    duel.updatedAt = Date.now();

    if (parsed.data.finished) {
      const other = duel.players.find((item) => item.accountId !== account.id);
      if (!duel.winnerAccountId) {
        if (!other || !other.finished || player.progress >= other.progress) {
          duel.winnerAccountId = account.id;
        } else {
          duel.winnerAccountId = other.accountId;
        }
      }
    }

    const allFinished = duel.players.every((item) => item.finished || item.progress >= 100);
    if (allFinished || duel.winnerAccountId) {
      duel.status = "finished";
      if (duel.kind === "ranked") {
        const winner = duel.winnerAccountId;
        const loser = duel.players.find((item) => item.accountId !== winner);
        if (winner && loser && isDatabaseOnline()) {
          await pool.query(
            `UPDATE accounts
                SET rating = CASE
                  WHEN id = $1 THEN LEAST(5000, rating + 18)
                  WHEN id = $2 THEN GREATEST(100, rating - 14)
                  ELSE rating
                END
              WHERE id IN ($1, $2)`,
            [winner, loser.accountId],
          );
        } else if (winner && loser) {
          const winnerAccount = memoryAccountsById.get(winner);
          const loserAccount = memoryAccountsById.get(loser.accountId);
          if (winnerAccount) winnerAccount.rating = Math.min(5000, winnerAccount.rating + 18);
          if (loserAccount) loserAccount.rating = Math.max(100, loserAccount.rating - 14);
        }
      }
    }

    return res.json({ ok: true, duel: serializeDuel(duel) });
  } catch (error) {
    return next(error);
  }
});

router.post("/replay/share", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    const parsed = replayShareSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid replay share payload" });
    const replayId = crypto.randomBytes(6).toString("base64url");

    if (!isDatabaseOnline()) {
      memoryReplayShares.set(replayId, {
        id: replayId,
        accountId: account?.id ?? null,
        mode: parsed.data.mode,
        title: parsed.data.title,
        replay: parsed.data.replay,
        isPublic: parsed.data.isPublic,
        createdAt: new Date().toISOString(),
      });
      return res.status(201).json({
        id: replayId,
        url: `/share/replay/${replayId}`,
      });
    }

    await pool.query(
      `INSERT INTO shared_replays (id, account_id, mode, title, replay, is_public)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [replayId, account?.id ?? null, parsed.data.mode, parsed.data.title, parsed.data.replay, parsed.data.isPublic],
    );
    return res.status(201).json({
      id: replayId,
      url: `/share/replay/${replayId}`,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/replay/share/:id", async (req, res, next) => {
  try {
    const replayId = req.params.id;
    if (!replayId) return res.status(404).json({ error: "Replay not found" });

    if (!isDatabaseOnline()) {
      const replay = memoryReplayShares.get(replayId);
      if (!replay || !replay.isPublic) return res.status(404).json({ error: "Replay not found" });
      return res.json(replay);
    }

    const result = await pool.query(
      `SELECT id, account_id, mode, title, replay, is_public, created_at
         FROM shared_replays
        WHERE id = $1
          AND is_public = TRUE`,
      [replayId],
    );
    if (result.rowCount !== 1) return res.status(404).json({ error: "Replay not found" });
    const row = result.rows[0];
    return res.json({
      id: row.id,
      accountId: row.account_id,
      mode: row.mode,
      title: row.title,
      replay: row.replay,
      isPublic: row.is_public,
      createdAt: row.created_at,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/replay/share", async (req, res, next) => {
  try {
    const mine = req.query.mine === "true";
    const account = mine ? await getAuthedAccount(req) : null;
    if (mine && !account) return res.status(401).json({ error: "Unauthorized" });

    if (!isDatabaseOnline()) {
      const values = [...memoryReplayShares.values()]
        .filter((row) => (mine ? row.accountId === account?.id : row.isPublic))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 40)
        .map((row) => ({
          id: row.id,
          accountId: row.accountId,
          mode: row.mode,
          title: row.title,
          isPublic: row.isPublic,
          createdAt: row.createdAt,
        }));
      return res.json({ entries: values });
    }

    const result = mine
      ? await pool.query(
          `SELECT id, account_id, mode, title, is_public, created_at
             FROM shared_replays
            WHERE account_id = $1
            ORDER BY created_at DESC
            LIMIT 40`,
          [account?.id],
        )
      : await pool.query(
          `SELECT id, account_id, mode, title, is_public, created_at
             FROM shared_replays
            WHERE is_public = TRUE
            ORDER BY created_at DESC
            LIMIT 40`,
        );
    return res.json({
      entries: result.rows.map((row) => ({
        id: row.id,
        accountId: row.account_id,
        mode: row.mode,
        title: row.title,
        isPublic: row.is_public,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/webhooks/register", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) return res.status(401).json({ error: "Unauthorized" });
    const parsed = webhookCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid webhook payload" });
    if (!isWebhookTargetAllowed(parsed.data.targetUrl)) {
      return res.status(422).json({ error: "Webhook target is not allowed" });
    }
    const id = randomUUID();
    const secret = crypto.randomBytes(24).toString("hex");
    const events = [...new Set(parsed.data.events.map((event) => event.toLowerCase()))];
    if (events.some((event) => !WEBHOOK_EVENT_ALLOWLIST.has(event))) {
      return res.status(422).json({ error: "Unsupported webhook event" });
    }

    if (!isDatabaseOnline()) {
      memoryWebhooks.set(id, {
        id,
        accountId: account.id,
        targetUrl: parsed.data.targetUrl,
        secret,
        events,
        active: true,
      });
      return res.status(201).json({ id, targetUrl: parsed.data.targetUrl, events, secret, active: true });
    }

    await pool.query(
      `INSERT INTO webhook_endpoints (id, account_id, target_url, secret, events, active)
       VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [id, account.id, parsed.data.targetUrl, secret, events],
    );
    return res.status(201).json({ id, targetUrl: parsed.data.targetUrl, events, secret, active: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/webhooks/list", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) return res.status(401).json({ error: "Unauthorized" });
    if (!isDatabaseOnline()) {
      return res.json({
        entries: [...memoryWebhooks.values()]
          .filter((endpoint) => endpoint.accountId === account.id)
          .map((endpoint) => ({
            id: endpoint.id,
            targetUrl: endpoint.targetUrl,
            events: endpoint.events,
            active: endpoint.active,
          })),
      });
    }
    const result = await pool.query(
      `SELECT id, target_url, events, active, created_at
         FROM webhook_endpoints
        WHERE account_id = $1
        ORDER BY created_at DESC`,
      [account.id],
    );
    return res.json({
      entries: result.rows.map((row) => ({
        id: row.id,
        targetUrl: row.target_url,
        events: row.events,
        active: row.active,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.delete("/webhooks/:id", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) return res.status(401).json({ error: "Unauthorized" });
    const webhookId = req.params.id;
    if (!webhookId) return res.status(400).json({ error: "Missing webhook id" });
    if (!isDatabaseOnline()) {
      const hook = memoryWebhooks.get(webhookId);
      if (!hook || hook.accountId !== account.id) return res.status(404).json({ error: "Webhook not found" });
      memoryWebhooks.delete(webhookId);
      return res.json({ ok: true });
    }
    const result = await pool.query(
      `DELETE FROM webhook_endpoints
        WHERE id = $1
          AND account_id = $2`,
      [webhookId, account.id],
    );
    if (result.rowCount !== 1) return res.status(404).json({ error: "Webhook not found" });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/webhooks/test/:id", async (req, res, next) => {
  try {
    const account = await getAuthedAccount(req);
    if (!account) return res.status(401).json({ error: "Unauthorized" });
    const webhookId = req.params.id;
    if (!webhookId) return res.status(400).json({ error: "Missing webhook id" });
    let endpoint: WebhookEndpointState | null = null;
    if (!isDatabaseOnline()) {
      const hook = memoryWebhooks.get(webhookId);
      if (hook && hook.accountId === account.id) {
        endpoint = hook;
      }
    } else {
      const result = await pool.query(
        `SELECT id, account_id, target_url, secret, events, active
           FROM webhook_endpoints
          WHERE id = $1
            AND account_id = $2`,
        [webhookId, account.id],
      );
      if (result.rowCount === 1) {
        const row = result.rows[0];
        endpoint = {
          id: row.id,
          accountId: row.account_id,
          targetUrl: row.target_url,
          secret: row.secret,
          events: row.events,
          active: row.active,
        };
      }
    }
    if (!endpoint) {
      return res.status(404).json({ error: "Webhook not found" });
    }
    await emitWebhookEvent("webhook.test", {
      webhookId: endpoint.id,
      accountId: account.id,
      message: "TypeShift webhook test event",
    });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

export { router as platformRouter };
