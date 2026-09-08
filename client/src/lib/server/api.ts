import {
  describeSessionLabel,
  createPasswordHash,
  extractBearerToken,
  hashClientValue,
  isReasonableScore,
  normalizeUsername,
  passwordMeetsPolicy,
  randomId,
  randomPublicId,
  signAccountToken,
  signSessionToken,
  usernameMeetsPolicy,
  verifyAccountToken,
  verifyPasswordHash,
  verifySessionToken,
} from "./security";
import {
  getMemoryState,
  type MemoryAccount,
  type MemoryAccountSession,
  type MemoryAnalyticsAggregate,
  type MemoryChallengeScore,
  type MemoryDuel,
  type MemoryFriendRequest,
  type MemoryGameplaySession,
  type MemoryLeaderboardScore,
  type MemoryQueueEntry,
  type MemoryRaceRoom,
  type MemoryReplayShare,
  type MemoryTournament,
  type MemoryTournamentMatch,
  type MemoryTournamentPlayer,
} from "./memory-state";
import { CHALLENGE_DICTIONARY_VALUES, isMode, type ChallengeDictionaryPack, type Mode } from "./types";

type ThemeMode = "dark" | "light";
type ViewportBucket = "sm" | "md" | "lg" | "xl";

const ACCOUNT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const GAMEPLAY_SESSION_TTL_MS = 1000 * 60 * 15;
const RACE_ROOM_TTL_MS = 1000 * 60 * 60 * 2;
const RACE_PLAYER_TIMEOUT_MS = 1000 * 60 * 5;
const MATCH_MAX_RATING_GAP = 250;
const WEBHOOK_EVENT_ALLOWLIST = new Set(["score.submitted", "challenge.submitted", "webhook.test"]);
const challengeModes: Mode[] = ["time", "relay", "pulse", "cipher", "duel"];
const challengeDurations = [45, 60, 75, 90];
const botSeedModes: Mode[] = ["time", "quote", "pulse", "relay", "code", "meteor"];
const botSeedHandles = [
  "NovaKeys",
  "DashPilot",
  "MiraByte",
  "OrbitLane",
  "EchoVale",
  "PixelRook",
  "JunoShift",
  "VectorKai",
  "RileyRun",
  "TaroType",
  "MossSignal",
  "ZedTempo",
  "IvySyntax",
  "KodaFlux",
  "RuneCaps",
];

interface RuntimeEnv {
  DB?: D1Database;
  RATE_LIMIT_KV?: KVNamespace;
  JWT_SESSION_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  METRICS_TOKEN?: string;
  BOT_SEED_TOKEN?: string;
  USAGE_ANALYTICS?: AnalyticsEngineDataset;
  NEXTJS_ENV?: string;
  NEXT_PUBLIC_ADMIN_HANDLES?: string;
}

interface RequestContext {
  env: RuntimeEnv;
  nowMs: number;
  secret: string;
  isProduction: boolean;
}

interface AccountIdentity {
  id: string;
  handle: string;
  rating: number;
  locale: string;
  verifiedRuns: number;
  createdAtMs: number;
  sessionId: string;
}

interface Fingerprint {
  ipHash: string;
  userAgentHash: string;
  userAgent: string;
}

interface RateLimitRule {
  key: string;
  limit: number;
  windowSec: number;
}

interface ChallengeDefinition {
  id: string;
  date: string;
  mode: Mode;
  durationSec: number;
  dictionaryPack: ChallengeDictionaryPack;
  seed: number;
}

interface SeasonWindow {
  id: string;
  startDate: string;
  endDate: string;
}

class HttpError extends Error {
  status: number;
  details?: Record<string, unknown> | undefined;

  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function badRequest(message: string): never {
  throw new HttpError(400, message);
}

function unauthorized(message = "Unauthorized"): never {
  throw new HttpError(401, message);
}

function forbidden(message: string, details?: Record<string, unknown>): never {
  throw new HttpError(403, message, details);
}

function notFound(message: string): never {
  throw new HttpError(404, message);
}

function conflict(message: string): never {
  throw new HttpError(409, message);
}

function unprocessable(message: string): never {
  throw new HttpError(422, message);
}

function unavailable(message: string): never {
  throw new HttpError(503, message);
}

function badGateway(message: string): never {
  throw new HttpError(502, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!isRecord(body)) {
    badRequest("Request body must be a JSON object");
  }
  return body;
}

function parseBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value === "true";
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return fallback;
}

function parseInteger(
  value: unknown,
  options: { min?: number; max?: number; fallback?: number } = {},
): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value, 10)
        : Number.NaN;
  const resolved = Number.isFinite(numeric) ? Math.trunc(numeric) : options.fallback;
  if (resolved == null || !Number.isFinite(resolved)) {
    badRequest("Invalid integer value");
  }
  if (options.min != null && resolved < options.min) {
    badRequest("Integer value is too small");
  }
  if (options.max != null && resolved > options.max) {
    badRequest("Integer value is too large");
  }
  return resolved;
}

function parseFiniteNumber(
  value: unknown,
  options: { min?: number; max?: number } = {},
): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) {
    badRequest("Invalid numeric value");
  }
  if (options.min != null && numeric < options.min) {
    badRequest("Numeric value is too small");
  }
  if (options.max != null && numeric > options.max) {
    badRequest("Numeric value is too large");
  }
  return numeric;
}

function parseString(
  value: unknown,
  options: { min?: number; max?: number; trim?: boolean } = {},
): string {
  if (typeof value !== "string") {
    badRequest("Expected a string value");
  }
  const resolved = options.trim === false ? value : value.trim();
  if (options.min != null && resolved.length < options.min) {
    badRequest("String value is too short");
  }
  if (options.max != null && resolved.length > options.max) {
    badRequest("String value is too long");
  }
  return resolved;
}

function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function toIsoDateUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getDailyChallenge(now = new Date()): ChallengeDefinition {
  const date = toIsoDateUtc(now);
  const hash = hashString(`typeshift-daily-${date}`);
  const dictionaryPack =
    CHALLENGE_DICTIONARY_VALUES[Math.floor(hash / 13) % CHALLENGE_DICTIONARY_VALUES.length] ?? "top1k";
  const mode = challengeModes[hash % challengeModes.length] ?? "time";
  const durationSec = challengeDurations[Math.floor(hash / 101) % challengeDurations.length] ?? 60;
  return {
    id: date,
    date,
    mode,
    durationSec,
    dictionaryPack,
    seed: hash,
  };
}

function getSeasonWindow(date = new Date()): SeasonWindow {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const quarter = Math.floor(month / 3) + 1;
  const startMonth = (quarter - 1) * 3;
  const endMonth = startMonth + 3;
  return {
    id: `${year}-Q${quarter}`,
    startDate: toIsoDateUtc(new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0))),
    endDate: toIsoDateUtc(new Date(Date.UTC(year, endMonth, 1, 0, 0, 0, 0))),
  };
}

function parseSeasonId(seasonId: string): SeasonWindow {
  const match = /^(\d{4})-Q([1-4])$/.exec(seasonId);
  if (!match) {
    badRequest("Invalid season id");
  }
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const startMonth = (quarter - 1) * 3;
  const endMonth = startMonth + 3;
  return {
    id: `${year}-Q${quarter}`,
    startDate: toIsoDateUtc(new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0))),
    endDate: toIsoDateUtc(new Date(Date.UTC(year, endMonth, 1, 0, 0, 0, 0))),
  };
}

function pointsForChallengeScore(payload: {
  wpm: number;
  accuracy: number;
  errors: number;
  streak: number;
  raw: number;
}): number {
  const pace = payload.wpm * (payload.accuracy / 100);
  const precisionBonus = Math.max(0, payload.raw - payload.wpm) * 0.8;
  const streakBonus = payload.streak * 2.2;
  const penalty = payload.errors * 3.5;
  return Math.max(0, Math.round(pace * 10 + precisionBonus + streakBonus - penalty));
}

function seasonPointsForRun(payload: { wpm: number; accuracy: number; errors: number; streak: number }): number {
  return Math.max(0, Math.floor(payload.wpm * (payload.accuracy / 100) * 10) - payload.errors * 2 + payload.streak);
}

function rowBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function rowNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function rowString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

async function dbFirst<T extends Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: Array<string | number | null>
): Promise<T | null> {
  const result = await db.prepare(sql).bind(...params).first<T>();
  return result ?? null;
}

async function dbAll<T extends Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: Array<string | number | null>
): Promise<T[]> {
  const result = await db.prepare(sql).bind(...params).all<T>();
  return (result.results ?? []) as T[];
}

async function dbRun(
  db: D1Database,
  sql: string,
  ...params: Array<string | number | null>
): Promise<D1Result> {
  return db.prepare(sql).bind(...params).run();
}

function logRouteError(request: Request, path: string, error: unknown): void {
  const payload = {
    level: "error",
    route: path,
    method: request.method,
    url: request.url,
    rayId: request.headers.get("cf-ray"),
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof HttpError ? error.details : undefined,
    stack: error instanceof Error ? error.stack : undefined,
  };
  console.error(JSON.stringify(payload));
}

function requireSecret(env: RuntimeEnv, isProduction: boolean): string {
  const secret = env.JWT_SESSION_SECRET?.trim();
  if (secret) {
    return secret;
  }
  if (isProduction) {
    unavailable("JWT session secret is not configured");
  }
  return "typeshift-local-dev-secret";
}

async function getFingerprint(request: Request, secret: string): Promise<Fingerprint> {
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "0.0.0.0";
  return {
    ipHash: await hashClientValue(ip, secret),
    userAgentHash: await hashClientValue(userAgent, secret),
    userAgent,
  };
}

function getRuntimeContext(env: RuntimeEnv): RequestContext {
  const isProduction = (env.NEXTJS_ENV ?? process.env.NODE_ENV) === "production";
  return {
    env,
    nowMs: Date.now(),
    secret: requireSecret(env, isProduction),
    isProduction,
  };
}

async function enforceRateLimit(request: Request, ctx: RequestContext, rule: RateLimitRule): Promise<void> {
  if (!ctx.env.RATE_LIMIT_KV) {
    if (ctx.isProduction) {
      unavailable("Rate limiting is not configured");
    }
    return;
  }
  const fingerprint = await getFingerprint(request, ctx.secret);
  const bucket = Math.floor(ctx.nowMs / (rule.windowSec * 1000));
  const key = `rate:${rule.key}:${bucket}:${fingerprint.ipHash.slice(0, 32)}`;
  const current = Number((await ctx.env.RATE_LIMIT_KV.get(key)) ?? "0");
  if (current >= rule.limit) {
    throw new HttpError(429, "Too many requests");
  }
  await ctx.env.RATE_LIMIT_KV.put(key, String(current + 1), {
    expirationTtl: rule.windowSec + 10,
  });
}

async function verifyTurnstileIfRequired(
  request: Request,
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<void> {
  const secret = ctx.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret && !ctx.isProduction) {
    return;
  }
  if (!secret) {
    unavailable("Turnstile is not configured");
  }
  const token =
    typeof body.turnstileToken === "string" ? body.turnstileToken.trim() : "";
  if (!token) {
    badRequest("Turnstile verification is required");
  }
  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  const remoteIp =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (remoteIp) {
    form.set("remoteip", remoteIp);
  }
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
  }).catch(() => null);
  if (!response) {
    unavailable("Turnstile verification is unavailable");
  }
  const result = (await response.json().catch(() => null)) as
    | { success?: boolean; "error-codes"?: string[]; hostname?: string; action?: string }
    | null;
  const verificationDetails = {
    turnstileStatus: response.status,
    turnstileHostname: result?.hostname ?? null,
    turnstileAction: result?.action ?? null,
    turnstileErrorCodes: result?.["error-codes"] ?? [],
  };
  if (!response.ok) {
    if (response.status >= 500) {
      throw new HttpError(503, "Turnstile verification failed", verificationDetails);
    }
    forbidden("Turnstile verification failed", verificationDetails);
  }
  if (!result?.success) {
    forbidden("Turnstile verification failed", verificationDetails);
  }
}

async function getAuthedAccount(request: Request, ctx: RequestContext): Promise<AccountIdentity | null> {
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) {
    return null;
  }
  const claims = await verifyAccountToken(token, ctx.secret);
  if (!claims) {
    return null;
  }
  if (!ctx.env.DB) {
    const memory = getMemoryState();
    const account = memory.accountsById.get(claims.aid);
    const session = memory.accountSessions.get(claims.sid);
    if (!account || account.deletedAtMs || !session) {
      return null;
    }
    if (session.accountId !== account.id || session.revokedAtMs || session.expiresAtMs <= ctx.nowMs) {
      return null;
    }
    session.lastSeenAtMs = ctx.nowMs;
    return {
      id: account.id,
      handle: account.handle,
      rating: account.rating,
      locale: account.locale,
      verifiedRuns: account.verifiedRuns,
      createdAtMs: account.createdAtMs,
      sessionId: session.id,
    };
  }

  const row = await dbFirst<{
    id: string;
    handle: string;
    rating: number;
    locale: string;
    verified_runs: number;
    created_at: number;
    session_id: string;
  }>(
    ctx.env.DB,
    `SELECT a.id,
            a.handle,
            a.rating,
            a.locale,
            a.verified_runs,
            a.created_at,
            s.id AS session_id
       FROM accounts a
       JOIN account_sessions s ON s.account_id = a.id
      WHERE a.id = ?
        AND a.deleted_at IS NULL
        AND s.id = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > ?`,
    claims.aid,
    claims.sid,
    ctx.nowMs,
  );
  if (!row) {
    return null;
  }
  await dbRun(
    ctx.env.DB,
    `UPDATE account_sessions
        SET last_seen_at = ?
      WHERE id = ?`,
    ctx.nowMs,
    row.session_id,
  );
  return {
    id: row.id,
    handle: row.handle,
    rating: rowNumber(row.rating),
    locale: row.locale,
    verifiedRuns: rowNumber(row.verified_runs),
    createdAtMs: rowNumber(row.created_at),
    sessionId: row.session_id,
  };
}

function adminHandles(ctx: RequestContext): Set<string> {
  return new Set(
    (ctx.env.NEXT_PUBLIC_ADMIN_HANDLES ?? "")
      .split(",")
      .map((handle) => normalizeUsername(handle).toLowerCase())
      .filter(Boolean),
  );
}

function accountIsAdmin(ctx: RequestContext, account: AccountIdentity): boolean {
  return adminHandles(ctx).has(normalizeUsername(account.handle).toLowerCase());
}

async function requireAdminAccount(request: Request, ctx: RequestContext): Promise<AccountIdentity> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized("Admin access requires sign in");
  }
  if (!accountIsAdmin(ctx, account)) {
    forbidden("Admin access required");
  }
  return account;
}

function normalizeDisplayName(raw: string, maxLength = 24): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^A-Za-z0-9 _.-]/g, "")
    .slice(0, maxLength);
}

function parseDisplayName(value: unknown, maxLength = 24): string {
  const name = normalizeDisplayName(parseString(value, { min: 2, max: maxLength }));
  if (name.length < 2 || !/^[A-Za-z0-9](?:[A-Za-z0-9 _.-]*[A-Za-z0-9])?$/.test(name)) {
    badRequest("Invalid display name");
  }
  return name;
}

function generateRoomCode(): string {
  return randomPublicId(6).replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase().padEnd(6, "X");
}

function cleanupRaceRoomsInMemory(ctx: RequestContext): void {
  const memory = getMemoryState();
  for (const [roomId, room] of memory.raceRooms.entries()) {
    if (ctx.nowMs - room.createdAtMs > RACE_ROOM_TTL_MS) {
      memory.raceRooms.delete(roomId);
      continue;
    }
    for (const [playerId, player] of room.players.entries()) {
      if (ctx.nowMs - player.lastSeenAtMs > RACE_PLAYER_TIMEOUT_MS && room.status !== "finished") {
        room.players.delete(playerId);
      }
    }
    if (room.players.size === 0) {
      memory.raceRooms.delete(roomId);
    }
  }
}

async function cleanupRaceRoomsInDatabase(ctx: RequestContext): Promise<void> {
  if (!ctx.env.DB) {
    cleanupRaceRoomsInMemory(ctx);
    return;
  }
  await dbRun(ctx.env.DB, `DELETE FROM race_rooms WHERE created_at < ?`, ctx.nowMs - RACE_ROOM_TTL_MS);
}

function serializeRaceRoom(room: MemoryRaceRoom): Record<string, unknown> {
  const players = [...room.players.values()]
    .map((player) => ({
      id: player.id,
      name: player.name,
      progress: Number(player.progress.toFixed(2)),
      wpm: Number(player.wpm.toFixed(1)),
      accuracy: Number(player.accuracy.toFixed(1)),
      finished: player.finished,
      finishedAt: player.finishedAtMs,
    }))
    .sort((left, right) => {
      if (left.finished !== right.finished) {
        return left.finished ? -1 : 1;
      }
      return right.progress - left.progress || right.wpm - left.wpm;
    });
  return {
    roomId: room.id,
    mode: room.mode,
    status: room.status,
    startedAt: room.startedAtMs,
    hostPlayerId: room.hostPlayerId,
    players,
  };
}

async function loadRaceRoom(ctx: RequestContext, roomId: string): Promise<MemoryRaceRoom | null> {
  if (!ctx.env.DB) {
    cleanupRaceRoomsInMemory(ctx);
    return getMemoryState().raceRooms.get(roomId) ?? null;
  }
  await cleanupRaceRoomsInDatabase(ctx);
  const room = await dbFirst<{
    id: string;
    mode: Mode;
    status: "lobby" | "running" | "finished";
    host_player_id: string;
    created_at: number;
    started_at: number | null;
  }>(
    ctx.env.DB,
    `SELECT id, mode, status, host_player_id, created_at, started_at
       FROM race_rooms
      WHERE id = ?`,
    roomId,
  );
  if (!room) {
    return null;
  }
  const players = await dbAll<{
    id: string;
    name: string;
    progress: number;
    wpm: number;
    accuracy: number;
    finished: number;
    finished_at: number | null;
    last_seen_at: number;
  }>(
    ctx.env.DB,
    `SELECT id, name, progress, wpm, accuracy, finished, finished_at, last_seen_at
       FROM race_players
      WHERE room_id = ?`,
    roomId,
  );
  return {
    id: room.id,
    mode: room.mode,
    status: room.status,
    createdAtMs: rowNumber(room.created_at),
    startedAtMs: room.started_at == null ? null : rowNumber(room.started_at),
    hostPlayerId: room.host_player_id,
    players: new Map(
      players.map((player) => [
        player.id,
        {
          id: player.id,
          name: player.name,
          progress: rowNumber(player.progress),
          wpm: rowNumber(player.wpm),
          accuracy: rowNumber(player.accuracy),
          finished: rowBoolean(player.finished),
          finishedAtMs: player.finished_at == null ? null : rowNumber(player.finished_at),
          lastSeenAtMs: rowNumber(player.last_seen_at),
        },
      ]),
    ),
  };
}

function createBracket(players: MemoryTournamentPlayer[]): MemoryTournamentMatch[] {
  let bracketSize = 1;
  while (bracketSize < players.length) {
    bracketSize *= 2;
  }
  const seeded: Array<MemoryTournamentPlayer | null> = [...players];
  while (seeded.length < bracketSize) {
    seeded.push(null);
  }
  const rounds = Math.log2(bracketSize);
  const matches: MemoryTournamentMatch[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const matchCount = bracketSize / 2 ** round;
    for (let index = 0; index < matchCount; index += 1) {
      matches.push({
        id: randomId(),
        round,
        index,
        playerAId: round === 1 ? (seeded[index * 2]?.id ?? null) : null,
        playerBId: round === 1 ? (seeded[index * 2 + 1]?.id ?? null) : null,
        winnerId: null,
      });
    }
  }
  return matches;
}

function recomputeTournament(tournament: MemoryTournament): void {
  const maxRound = Math.max(1, ...tournament.matches.map((match) => match.round));
  for (const match of tournament.matches) {
    if (match.round === 1 && !match.winnerId) {
      if (match.playerAId && !match.playerBId) {
        match.winnerId = match.playerAId;
      } else if (!match.playerAId && match.playerBId) {
        match.winnerId = match.playerBId;
      }
    }
  }
  for (let round = 2; round <= maxRound; round += 1) {
    const previous = tournament.matches
      .filter((match) => match.round === round - 1)
      .sort((left, right) => left.index - right.index);
    const current = tournament.matches
      .filter((match) => match.round === round)
      .sort((left, right) => left.index - right.index);
    for (const match of current) {
      const sourceA = previous[match.index * 2];
      const sourceB = previous[match.index * 2 + 1];
      match.playerAId = sourceA?.winnerId ?? null;
      match.playerBId = sourceB?.winnerId ?? null;
      if (match.winnerId && match.winnerId !== match.playerAId && match.winnerId !== match.playerBId) {
        match.winnerId = null;
      }
      if (!match.winnerId) {
        if (match.playerAId && !match.playerBId) {
          match.winnerId = match.playerAId;
        } else if (!match.playerAId && match.playerBId) {
          match.winnerId = match.playerBId;
        }
      }
    }
  }
  const finalMatch = tournament.matches.find((match) => match.round === maxRound && match.index === 0);
  tournament.status = finalMatch?.winnerId ? "finished" : "live";
}

function serializeTournament(tournament: MemoryTournament): Record<string, unknown> {
  return {
    id: tournament.id,
    name: tournament.name,
    mode: tournament.mode,
    status: tournament.status,
    createdAt: tournament.createdAtMs,
    players: tournament.players,
    matches: tournament.matches,
  };
}

async function loadTournament(ctx: RequestContext, tournamentId: string): Promise<MemoryTournament | null> {
  if (!ctx.env.DB) {
    return getMemoryState().tournaments.get(tournamentId) ?? null;
  }
  const row = await dbFirst<{
    id: string;
    name: string;
    mode: Mode;
    status: "live" | "finished";
    created_at: number;
  }>(
    ctx.env.DB,
    `SELECT id, name, mode, status, created_at
       FROM tournaments
      WHERE id = ?`,
    tournamentId,
  );
  if (!row) {
    return null;
  }
  const [players, matches] = await Promise.all([
    dbAll<{ id: string; name: string }>(
      ctx.env.DB,
      `SELECT id, name
         FROM tournament_players
        WHERE tournament_id = ?
        ORDER BY seed_index ASC`,
      tournamentId,
    ),
    dbAll<{
      id: string;
      round: number;
      match_index: number;
      player_a_id: string | null;
      player_b_id: string | null;
      winner_id: string | null;
    }>(
      ctx.env.DB,
      `SELECT id, round, match_index, player_a_id, player_b_id, winner_id
         FROM tournament_matches
        WHERE tournament_id = ?
        ORDER BY round ASC, match_index ASC`,
      tournamentId,
    ),
  ]);
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    status: row.status,
    createdAtMs: rowNumber(row.created_at),
    players,
    matches: matches.map((match) => ({
      id: match.id,
      round: rowNumber(match.round),
      index: rowNumber(match.match_index),
      playerAId: match.player_a_id,
      playerBId: match.player_b_id,
      winnerId: match.winner_id,
    })),
  };
}

async function saveTournament(ctx: RequestContext, tournament: MemoryTournament): Promise<void> {
  if (!ctx.env.DB) {
    getMemoryState().tournaments.set(tournament.id, tournament);
    return;
  }
  await dbRun(ctx.env.DB, `UPDATE tournaments SET status = ? WHERE id = ?`, tournament.status, tournament.id);
  for (const match of tournament.matches) {
    await dbRun(
      ctx.env.DB,
      `UPDATE tournament_matches
          SET player_a_id = ?,
              player_b_id = ?,
              winner_id = ?
        WHERE id = ?
          AND tournament_id = ?`,
      match.playerAId,
      match.playerBId,
      match.winnerId,
      match.id,
      tournament.id,
    );
  }
}

function removeFromQueue(queue: MemoryQueueEntry[], accountId: string): void {
  const index = queue.findIndex((entry) => entry.accountId === accountId);
  if (index >= 0) {
    queue.splice(index, 1);
  }
}

function serializeDuel(duel: MemoryDuel): Record<string, unknown> {
  return {
    id: duel.id,
    kind: duel.kind,
    status: duel.status,
    createdAt: duel.createdAtMs,
    updatedAt: duel.updatedAtMs,
    winnerAccountId: duel.winnerAccountId,
    players: duel.players,
  };
}

function startDuel(kind: "ranked" | "casual", left: MemoryQueueEntry, right: MemoryQueueEntry): MemoryDuel {
  const duel: MemoryDuel = {
    id: randomId(),
    kind,
    status: "running",
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    winnerAccountId: null,
    players: [left, right].map((entry) => ({
      accountId: entry.accountId,
      handle: entry.handle,
      rating: entry.rating,
      progress: 0,
      wpm: 0,
      accuracy: 100,
      finished: false,
    })),
  };
  const memory = getMemoryState();
  memory.activeDuels.set(duel.id, duel);
  memory.accountToDuel.set(left.accountId, duel.id);
  memory.accountToDuel.set(right.accountId, duel.id);
  return duel;
}

function isWebhookTargetAllowed(targetUrl: string): boolean {
  try {
    const url = new URL(targetUrl);
    if (url.protocol !== "https:") {
      return false;
    }
    if (url.username || url.password) {
      return false;
    }
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".lan") ||
      host.includes(":") ||
      host === "0.0.0.0" ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      host.startsWith("169.254.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
      /^198\.(1[89])\./.test(host) ||
      /^(22[4-9]|23\d|24\d|25[0-5])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch (_error) {
    return false;
  }
}

function createWebhookSecret(): string {
  return randomPublicId(24);
}

async function signWebhookPayload(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deliverWebhookTest(webhook: { id: string; accountId: string; targetUrl: string; secret: string }): Promise<number> {
  const eventName = "webhook.test";
  const body = JSON.stringify({
    event: eventName,
    sentAt: new Date().toISOString(),
    payload: {
      webhookId: webhook.id,
      accountId: webhook.accountId,
      message: "TypeShift webhook test event",
    },
  });
  const signature = await signWebhookPayload(webhook.secret, body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(webhook.targetUrl, {
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
    if (!response.ok) {
      badGateway(`Webhook target returned HTTP ${response.status}`);
    }
    return response.status;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    badGateway("Webhook delivery failed");
  } finally {
    clearTimeout(timer);
  }
}

async function createAccountSession(
  ctx: RequestContext,
  accountId: string,
  handle: string,
  fingerprint: Fingerprint,
): Promise<{ sessionId: string; token: string }> {
  const sessionId = randomId();
  const label = describeSessionLabel(fingerprint.userAgent);
  if (!ctx.env.DB) {
    const memory = getMemoryState();
    memory.accountSessions.set(sessionId, {
      id: sessionId,
      accountId,
      label,
      userAgentHash: fingerprint.userAgentHash,
      ipHash: fingerprint.ipHash,
      createdAtMs: ctx.nowMs,
      lastSeenAtMs: ctx.nowMs,
      expiresAtMs: ctx.nowMs + ACCOUNT_SESSION_TTL_MS,
      revokedAtMs: null,
    });
  } else {
    await dbRun(
      ctx.env.DB,
      `INSERT INTO account_sessions (
         id, account_id, label, user_agent_hash, ip_hash, created_at, last_seen_at, expires_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      sessionId,
      accountId,
      label,
      fingerprint.userAgentHash,
      fingerprint.ipHash,
      ctx.nowMs,
      ctx.nowMs,
      ctx.nowMs + ACCOUNT_SESSION_TTL_MS,
    );
  }
  return {
    sessionId,
    token: await signAccountToken(sessionId, accountId, handle, ctx.secret),
  };
}

async function createGameplaySession(
  ctx: RequestContext,
  mode: Mode,
  fingerprint: Fingerprint,
): Promise<{ sessionId: string; token: string; expiresAt: string }> {
  const sessionId = randomId();
  if (!ctx.env.DB) {
    const memory = getMemoryState();
    memory.gameplaySessions.set(sessionId, {
      id: sessionId,
      mode,
      ipHash: fingerprint.ipHash,
      userAgentHash: fingerprint.userAgentHash,
      createdAtMs: ctx.nowMs,
      expiresAtMs: ctx.nowMs + GAMEPLAY_SESSION_TTL_MS,
      consumedAtMs: null,
    });
  } else {
    await dbRun(
      ctx.env.DB,
      `INSERT INTO gameplay_sessions (
         id, mode, ip_hash, user_agent_hash, created_at, expires_at, consumed_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      sessionId,
      mode,
      fingerprint.ipHash,
      fingerprint.userAgentHash,
      ctx.nowMs,
      ctx.nowMs + GAMEPLAY_SESSION_TTL_MS,
    );
  }
  return {
    sessionId,
    token: await signSessionToken(sessionId, mode, ctx.secret),
    expiresAt: toIso(ctx.nowMs + GAMEPLAY_SESSION_TTL_MS),
  };
}

async function consumeGameplaySession(
  ctx: RequestContext,
  sessionId: string,
  mode: Mode,
  fingerprint: Fingerprint,
): Promise<void> {
  if (!ctx.env.DB) {
    const memory = getMemoryState();
    const session = memory.gameplaySessions.get(sessionId);
    if (!session || session.mode !== mode || session.consumedAtMs || session.expiresAtMs <= ctx.nowMs) {
      conflict("Session already used or expired");
    }
    if (session.ipHash !== fingerprint.ipHash || session.userAgentHash !== fingerprint.userAgentHash) {
      forbidden("Session fingerprint mismatch");
    }
    session.consumedAtMs = ctx.nowMs;
    return;
  }

  const session = await dbFirst<{ ip_hash: string; user_agent_hash: string }>(
    ctx.env.DB,
    `SELECT ip_hash, user_agent_hash
       FROM gameplay_sessions
      WHERE id = ?
        AND mode = ?
        AND consumed_at IS NULL
        AND expires_at > ?`,
    sessionId,
    mode,
    ctx.nowMs,
  );
  if (!session) {
    conflict("Session already used or expired");
  }
  if (session.ip_hash !== fingerprint.ipHash || session.user_agent_hash !== fingerprint.userAgentHash) {
    forbidden("Session fingerprint mismatch");
  }
  const result = await dbRun(
    ctx.env.DB,
    `UPDATE gameplay_sessions
        SET consumed_at = ?
      WHERE id = ?
        AND consumed_at IS NULL`,
    ctx.nowMs,
    sessionId,
  );
  if ((result.meta?.changes ?? 0) !== 1) {
    conflict("Session already used or expired");
  }
}

async function incrementVerifiedRunsByAccountId(ctx: RequestContext, accountId: string): Promise<void> {
  if (!ctx.env.DB) {
    const memory = getMemoryState();
    const account = memory.accountsById.get(accountId);
    if (account && !account.deletedAtMs) {
      account.verifiedRuns += 1;
      account.updatedAtMs = ctx.nowMs;
    }
    return;
  }
  await dbRun(
    ctx.env.DB,
    `UPDATE accounts
        SET verified_runs = verified_runs + 1,
            updated_at = ?
      WHERE id = ?
        AND deleted_at IS NULL`,
    ctx.nowMs,
    accountId,
  );
}

async function getScoreAccount(request: Request, ctx: RequestContext): Promise<AccountIdentity | null> {
  const token = request.headers.get("x-account-token") ?? "";
  if (!token.trim()) {
    return null;
  }
  const claims = await verifyAccountToken(token.trim(), ctx.secret);
  if (!claims) {
    unauthorized("Invalid account token");
  }
  const account = await getAuthedAccount(new Request(request.url, { headers: { authorization: `Bearer ${token.trim()}` } }), ctx);
  if (!account) {
    unauthorized("Invalid account token");
  }
  return account;
}

function assertScoreAccountCanUsePayload(account: AccountIdentity | null, payload: { username: string; certified: boolean }): void {
  if (!account) {
    if (payload.certified) {
      unauthorized("Certified runs require sign in");
    }
    return;
  }
  if (normalizeUsername(payload.username).toLowerCase() !== normalizeUsername(account.handle).toLowerCase()) {
    forbidden("Signed-in score username must match the account");
  }
}

function serializeLeaderboardEntry(
  score: MemoryLeaderboardScore,
  index: number,
): Record<string, unknown> {
  return {
    rank: index + 1,
    username: score.username,
    mode: score.mode,
    wpm: score.wpm,
    raw: score.raw,
    accuracy: score.accuracy,
    errors: score.errors,
    streak: score.streak,
    durationMs: score.durationMs,
    certified: score.certified,
    createdAt: toIso(score.createdAtMs),
  };
}

async function listLeaderboard(
  ctx: RequestContext,
  mode: Mode,
  limit: number,
  certifiedOnly: boolean,
): Promise<Array<Record<string, unknown>>> {
  if (!ctx.env.DB) {
    const memory = getMemoryState();
    return memory.leaderboardScores
      .filter((score) => score.mode === mode && (!certifiedOnly || score.certified))
      .sort(
        (left, right) =>
          right.wpm - left.wpm ||
          right.accuracy - left.accuracy ||
          right.raw - left.raw ||
          left.createdAtMs - right.createdAtMs,
      )
      .slice(0, limit)
      .map((score, index) => serializeLeaderboardEntry(score, index));
  }

  const rows = await dbAll<{
    username: string;
    mode: string;
    wpm: number;
    raw: number;
    accuracy: number;
    errors: number;
    streak: number;
    duration_ms: number;
    certified: number;
    created_at: number;
  }>(
    ctx.env.DB,
    `SELECT username, mode, wpm, raw, accuracy, errors, streak, duration_ms, certified, created_at
       FROM leaderboard_scores
      WHERE mode = ?
        AND (? = 0 OR certified = 1)
      ORDER BY wpm DESC, accuracy DESC, raw DESC, created_at ASC
      LIMIT ?`,
    mode,
    certifiedOnly ? 1 : 0,
    limit,
  );
  return rows.map((row, index) => ({
    rank: index + 1,
    username: row.username,
    mode: row.mode,
    wpm: rowNumber(row.wpm),
    raw: rowNumber(row.raw),
    accuracy: rowNumber(row.accuracy),
    errors: rowNumber(row.errors),
    streak: rowNumber(row.streak),
    durationMs: rowNumber(row.duration_ms),
    certified: rowBoolean(row.certified),
    createdAt: toIso(rowNumber(row.created_at)),
  }));
}

function seededBotScore(handle: string, botIndex: number, mode: Mode, modeIndex: number, nowMs: number): MemoryLeaderboardScore {
  const baseline = 43 + botIndex * 1.7 + modeIndex * 2.9;
  const accuracy = Math.min(99.4, 91.5 + ((botIndex * 7 + modeIndex * 3) % 70) / 10);
  const wpm = Number((baseline + ((botIndex + modeIndex) % 4) * 1.4).toFixed(1));
  const raw = Number((wpm + 4.5 + (modeIndex % 3) * 1.1).toFixed(1));
  const errors = Math.max(0, Math.round((100 - accuracy) / 2));
  const durationMs = mode === "quote" ? 75_000 + botIndex * 850 : 60_000;
  return {
    id: `seed-bot-${handle.toLowerCase()}-${mode}`,
    sessionId: `seed-bot-session-${handle.toLowerCase()}-${mode}`,
    accountId: null,
    username: handle,
    mode,
    wpm,
    raw,
    accuracy: Number(accuracy.toFixed(1)),
    errors,
    streak: Math.max(8, Math.round((wpm * accuracy) / 120)),
    durationMs,
    certified: false,
    clientVersion: "seed-bot-v1",
    telemetry: {
      typedChars: Math.round((raw * durationMs) / 12_000),
      correctChars: Math.round((wpm * accuracy * durationMs) / 1_200_000),
      wrongChars: errors,
      avgKeyIntervalMs: Math.max(55, Math.round(240 - wpm * 1.8)),
      burstKps: Number((5.2 + modeIndex * 0.35).toFixed(2)),
      idleRatio: Number((0.06 + (botIndex % 5) * 0.015).toFixed(2)),
      source: "seed-bot",
    },
    createdAtMs: nowMs - (botIndex * botSeedModes.length + modeIndex) * 4_200_000,
  };
}

async function seedBotLeaderboard(request: Request, ctx: RequestContext, body: Record<string, unknown>): Promise<Response> {
  await requireAdminAccount(request, ctx);
  if (!authorizeBotSeed(request, ctx)) {
    unauthorized("Seed access requires bot seed token");
  }
  const botCount = body.botCount == null ? 12 : parseInteger(body.botCount, { min: 1, max: 15 });
  const modesRequested =
    Array.isArray(body.modes) && body.modes.length > 0
      ? body.modes.map((mode) => {
          if (!isMode(mode)) {
            badRequest("Invalid seed mode");
          }
          return mode;
        })
      : botSeedModes;
  const modes = modesRequested.slice(0, 6);
  const scores = botSeedHandles
    .slice(0, botCount)
    .flatMap((handle, botIndex) => modes.map((mode, modeIndex) => seededBotScore(handle, botIndex, mode, modeIndex, ctx.nowMs)));

  if (!ctx.env.DB) {
    const memory = getMemoryState();
    const byId = new Map(memory.leaderboardScores.map((score) => [score.id, score]));
    for (const score of scores) {
      byId.set(score.id, score);
    }
    memory.leaderboardScores = [...byId.values()];
  } else {
    for (const score of scores) {
      await dbRun(
        ctx.env.DB,
        `INSERT INTO leaderboard_scores (
           id, session_id, account_id, username, mode, wpm, raw, accuracy, errors, streak, duration_ms, certified, client_version, telemetry_json, created_at
         ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           username = excluded.username,
           mode = excluded.mode,
           wpm = excluded.wpm,
           raw = excluded.raw,
           accuracy = excluded.accuracy,
           errors = excluded.errors,
           streak = excluded.streak,
           duration_ms = excluded.duration_ms,
           certified = excluded.certified,
           client_version = excluded.client_version,
           telemetry_json = excluded.telemetry_json,
           created_at = excluded.created_at`,
        score.id,
        score.sessionId,
        score.username,
        score.mode,
        score.wpm,
        score.raw,
        score.accuracy,
        score.errors,
        score.streak,
        score.durationMs,
        score.clientVersion,
        JSON.stringify(score.telemetry),
        score.createdAtMs,
      );
    }
  }

  return json({
    ok: true,
    bots: botCount,
    modes,
    rows: scores.length,
    handles: botSeedHandles.slice(0, botCount),
  });
}

function serializeChallengeEntry(score: MemoryChallengeScore, index: number): Record<string, unknown> {
  return {
    rank: index + 1,
    username: score.username,
    mode: score.mode,
    points: score.points,
    wpm: score.wpm,
    raw: score.raw,
    accuracy: score.accuracy,
    errors: score.errors,
    streak: score.streak,
    durationMs: score.durationMs,
    createdAt: toIso(score.createdAtMs),
  };
}

async function listChallengeLeaderboard(
  ctx: RequestContext,
  challengeDate: string,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  if (!ctx.env.DB) {
    const memory = getMemoryState();
    return memory.challengeScores
      .filter((score) => score.challengeDate === challengeDate)
      .sort(
        (left, right) =>
          right.points - left.points ||
          right.wpm - left.wpm ||
          right.accuracy - left.accuracy ||
          right.raw - left.raw ||
          left.createdAtMs - right.createdAtMs,
      )
      .slice(0, limit)
      .map((score, index) => serializeChallengeEntry(score, index));
  }
  const rows = await dbAll<{
    username: string;
    mode: string;
    points: number;
    wpm: number;
    raw: number;
    accuracy: number;
    errors: number;
    streak: number;
    duration_ms: number;
    created_at: number;
  }>(
    ctx.env.DB,
    `SELECT username, mode, points, wpm, raw, accuracy, errors, streak, duration_ms, created_at
       FROM challenge_scores
      WHERE challenge_date = ?
      ORDER BY points DESC, wpm DESC, accuracy DESC, raw DESC, created_at ASC
      LIMIT ?`,
    challengeDate,
    limit,
  );
  return rows.map((row, index) => ({
    rank: index + 1,
    username: row.username,
    mode: row.mode,
    points: rowNumber(row.points),
    wpm: rowNumber(row.wpm),
    raw: rowNumber(row.raw),
    accuracy: rowNumber(row.accuracy),
    errors: rowNumber(row.errors),
    streak: rowNumber(row.streak),
    durationMs: rowNumber(row.duration_ms),
    createdAt: toIso(rowNumber(row.created_at)),
  }));
}

async function listSeasonLeaderboard(
  ctx: RequestContext,
  season: SeasonWindow,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  const startMs = Date.parse(`${season.startDate}T00:00:00.000Z`);
  const endMs = Date.parse(`${season.endDate}T00:00:00.000Z`);

  if (!ctx.env.DB) {
    const memory = getMemoryState();
    const combined = new Map<string, { username: string; points: number; runs: number; bestWpm: number }>();
    for (const score of memory.leaderboardScores) {
      if (score.createdAtMs < startMs || score.createdAtMs >= endMs) {
        continue;
      }
      const key = score.username.toLowerCase();
      const next = combined.get(key) ?? {
        username: score.username,
        points: 0,
        runs: 0,
        bestWpm: 0,
      };
      next.points += seasonPointsForRun(score);
      next.runs += 1;
      next.bestWpm = Math.max(next.bestWpm, score.wpm);
      combined.set(key, next);
    }
    for (const score of memory.challengeScores) {
      if (score.createdAtMs < startMs || score.createdAtMs >= endMs) {
        continue;
      }
      const key = score.username.toLowerCase();
      const next = combined.get(key) ?? {
        username: score.username,
        points: 0,
        runs: 0,
        bestWpm: 0,
      };
      next.points += score.points + 50;
      next.runs += 1;
      next.bestWpm = Math.max(next.bestWpm, score.wpm);
      combined.set(key, next);
    }
    return [...combined.values()]
      .sort(
        (left, right) =>
          right.points - left.points ||
          right.bestWpm - left.bestWpm ||
          right.runs - left.runs ||
          left.username.localeCompare(right.username),
      )
      .slice(0, limit)
      .map((row, index) => ({
        rank: index + 1,
        username: row.username,
        points: row.points,
        runs: row.runs,
        bestWpm: Number(row.bestWpm.toFixed(2)),
      }));
  }

  const rows = await dbAll<{
    username: string;
    points: number;
    runs: number;
    best_wpm: number;
  }>(
    ctx.env.DB,
    `WITH base_scores AS (
       SELECT username,
              wpm,
              CASE
                WHEN ((wpm * (accuracy / 100.0)) * 10) - (errors * 2) + streak < 0 THEN 0
                ELSE CAST(((wpm * (accuracy / 100.0)) * 10) - (errors * 2) + streak AS INTEGER)
              END AS points
         FROM leaderboard_scores
        WHERE created_at >= ?
          AND created_at < ?
     ),
     challenge_scores_scored AS (
       SELECT username,
              wpm,
              CASE
                WHEN points + 50 < 0 THEN 0
                ELSE CAST(points + 50 AS INTEGER)
              END AS points
         FROM challenge_scores
        WHERE created_at >= ?
          AND created_at < ?
     ),
     combined AS (
       SELECT username, points, wpm FROM base_scores
       UNION ALL
       SELECT username, points, wpm FROM challenge_scores_scored
     )
     SELECT username,
            SUM(points) AS points,
            COUNT(*) AS runs,
            MAX(wpm) AS best_wpm
       FROM combined
      GROUP BY username
      ORDER BY points DESC, best_wpm DESC, runs DESC, username ASC
      LIMIT ?`,
    startMs,
    endMs,
    startMs,
    endMs,
    limit,
  );
  return rows.map((row, index) => ({
    rank: index + 1,
    username: row.username,
    points: rowNumber(row.points),
    runs: rowNumber(row.runs),
    bestWpm: rowNumber(row.best_wpm),
  }));
}

async function upsertAnalyticsAggregate(
  ctx: RequestContext,
  aggregate: Omit<MemoryAnalyticsAggregate, "count" | "lastSeenAtMs">,
): Promise<void> {
  ctx.env.USAGE_ANALYTICS?.writeDataPoint({
    blobs: [
      aggregate.eventName,
      aggregate.page ?? "none",
      aggregate.mode ?? "none",
      aggregate.theme ?? "none",
      aggregate.viewportBucket ?? "none",
    ],
    indexes: [aggregate.dateKey],
    doubles: [ctx.nowMs],
  });

  if (!ctx.env.DB) {
    const memory = getMemoryState();
    const existing = memory.analytics.get(aggregate.dimensionKey);
    if (existing) {
      existing.count += 1;
      existing.lastSeenAtMs = ctx.nowMs;
    } else {
      memory.analytics.set(aggregate.dimensionKey, {
        ...aggregate,
        count: 1,
        lastSeenAtMs: ctx.nowMs,
      });
    }
    return;
  }

  await dbRun(
    ctx.env.DB,
    `INSERT INTO analytics_daily_aggregates (
       dimension_key, date_key, event_name, page, mode, theme, viewport_bucket, reduced_motion, consent_version, count, last_seen_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(dimension_key) DO UPDATE SET
       count = analytics_daily_aggregates.count + 1,
       last_seen_at = excluded.last_seen_at`,
    aggregate.dimensionKey,
    aggregate.dateKey,
    aggregate.eventName,
    aggregate.page,
    aggregate.mode,
    aggregate.theme,
    aggregate.viewportBucket,
    aggregate.reducedMotion == null ? null : aggregate.reducedMotion ? 1 : 0,
    aggregate.consentVersion,
    ctx.nowMs,
  );
}

function authorizeAnalyticsSummary(request: Request, ctx: RequestContext): boolean {
  const configuredToken = ctx.env.METRICS_TOKEN?.trim();
  if (!ctx.isProduction && !configuredToken) {
    return true;
  }
  if (!configuredToken) {
    return false;
  }
  const headerToken = request.headers.get("x-metrics-token");
  const bearerToken = extractBearerToken(request.headers.get("authorization"));
  const candidate = headerToken ?? bearerToken ?? "";
  return candidate.length === configuredToken.length && candidate === configuredToken;
}

function authorizeBotSeed(request: Request, ctx: RequestContext): boolean {
  const configuredToken = ctx.env.BOT_SEED_TOKEN?.trim();
  if (!ctx.isProduction && !configuredToken) {
    return true;
  }
  if (!configuredToken) {
    return false;
  }
  const candidate = request.headers.get("x-bot-seed-token") ?? "";
  return candidate.length === configuredToken.length && candidate === configuredToken;
}

async function listAnalyticsSummary(
  ctx: RequestContext,
  days: number,
): Promise<{ totals: Record<string, number>; rows: Array<Record<string, unknown>> }> {
  if (!ctx.env.DB) {
    const cutoff = new Date(ctx.nowMs - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const rows = [...getMemoryState().analytics.values()]
      .filter((row) => row.dateKey >= cutoff)
      .sort((left, right) => right.dateKey.localeCompare(left.dateKey) || right.count - left.count || left.eventName.localeCompare(right.eventName))
      .slice(0, 160)
      .map((row) => ({
        dateKey: row.dateKey,
        eventName: row.eventName,
        page: row.page,
        mode: row.mode,
        theme: row.theme,
        viewportBucket: row.viewportBucket,
        reducedMotion: row.reducedMotion,
        consentVersion: row.consentVersion,
        count: row.count,
      }));
    const totals = rows.reduce<Record<string, number>>((accumulator, row) => {
      const key = row.eventName as string;
      accumulator[key] = (accumulator[key] ?? 0) + rowNumber(row.count);
      return accumulator;
    }, {});
    return { totals, rows };
  }

  const cutoff = new Date(ctx.nowMs - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await dbAll<{
    date_key: string;
    event_name: string;
    page: string | null;
    mode: string | null;
    theme: ThemeMode | null;
    viewport_bucket: ViewportBucket | null;
    reduced_motion: number | null;
    consent_version: number | null;
    count: number;
  }>(
    ctx.env.DB,
    `SELECT date_key, event_name, page, mode, theme, viewport_bucket, reduced_motion, consent_version, count
       FROM analytics_daily_aggregates
      WHERE date_key >= ?
      ORDER BY date_key DESC, count DESC, event_name ASC
      LIMIT 160`,
    cutoff,
  );
  const payloadRows = rows.map((row) => ({
    dateKey: row.date_key,
    eventName: row.event_name,
    page: row.page,
    mode: row.mode,
    theme: row.theme,
    viewportBucket: row.viewport_bucket,
    reducedMotion: row.reduced_motion == null ? null : rowBoolean(row.reduced_motion),
    consentVersion: row.consent_version == null ? null : rowNumber(row.consent_version),
    count: rowNumber(row.count),
  }));
  const totals = payloadRows.reduce<Record<string, number>>((accumulator, row) => {
    accumulator[row.eventName] = (accumulator[row.eventName] ?? 0) + row.count;
    return accumulator;
  }, {});
  return { totals, rows: payloadRows };
}

async function registerAccount(
  request: Request,
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<Response> {
  await verifyTurnstileIfRequired(request, ctx, body);
  const handle = parseString(body.handle, { min: 2, max: 24 });
  const password = parseString(body.password, { min: 1, max: 128, trim: false });
  const locale = parseString(body.locale ?? "en", { min: 2, max: 12 }).toLowerCase();
  if (!usernameMeetsPolicy(handle)) {
    badRequest("Invalid registration payload");
  }
  if (!passwordMeetsPolicy(password)) {
    unprocessable("Password must be 10+ chars and include uppercase, lowercase, and number");
  }

  const normalizedHandle = normalizeUsername(handle);
  const normalizedKey = normalizedHandle.toLowerCase();
  const passwordHash = await createPasswordHash(password);
  const fingerprint = await getFingerprint(request, ctx.secret);

  if (!ctx.env.DB) {
    const memory = getMemoryState();
    if (memory.accountsByHandle.has(normalizedKey)) {
      conflict("Handle is already taken");
    }
    const account: MemoryAccount = {
      id: randomId(),
      handle: normalizedHandle,
      handleNormalized: normalizedKey,
      passwordHash: passwordHash.hash,
      passwordSalt: passwordHash.salt,
      rating: 1000,
      locale,
      verifiedRuns: 0,
      createdAtMs: ctx.nowMs,
      updatedAtMs: ctx.nowMs,
      deletedAtMs: null,
    };
    memory.accountsById.set(account.id, account);
    memory.accountsByHandle.set(account.handleNormalized, account);
    memory.preferences.set(account.id, {});
    const session = await createAccountSession(ctx, account.id, account.handle, fingerprint);
    return json(
      {
        token: session.token,
        account: {
          id: account.id,
          handle: account.handle,
          rating: account.rating,
          locale: account.locale,
          verifiedRuns: account.verifiedRuns,
          createdAt: toIso(account.createdAtMs),
          sessionTtlMs: ACCOUNT_SESSION_TTL_MS,
        },
      },
      { status: 201 },
    );
  }

  const accountId = randomId();
  const insertResult = await dbRun(
    ctx.env.DB,
    `INSERT INTO accounts (
       id, handle, handle_normalized, password_hash, password_salt, rating, locale, verified_runs, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, 1000, ?, 0, ?, ?, NULL)
     ON CONFLICT(handle_normalized) DO NOTHING`,
    accountId,
    normalizedHandle,
    normalizedKey,
    passwordHash.hash,
    passwordHash.salt,
    locale,
    ctx.nowMs,
    ctx.nowMs,
  );
  if ((insertResult.meta?.changes ?? 0) !== 1) {
    conflict("Handle is already taken");
  }
  await dbRun(
    ctx.env.DB,
    `INSERT INTO account_preferences (account_id, preferences_json, updated_at)
     VALUES (?, '{}', ?)`,
    accountId,
    ctx.nowMs,
  );
  const session = await createAccountSession(ctx, accountId, normalizedHandle, fingerprint);
  return json(
    {
      token: session.token,
      account: {
        id: accountId,
        handle: normalizedHandle,
        rating: 1000,
        locale,
        verifiedRuns: 0,
        createdAt: toIso(ctx.nowMs),
        sessionTtlMs: ACCOUNT_SESSION_TTL_MS,
      },
    },
    { status: 201 },
  );
}

async function loginAccount(
  request: Request,
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<Response> {
  await verifyTurnstileIfRequired(request, ctx, body);
  const handle = parseString(body.handle, { min: 2, max: 24 });
  const password = parseString(body.password, { min: 1, max: 128, trim: false });
  const normalized = normalizeUsername(handle).toLowerCase();
  const fingerprint = await getFingerprint(request, ctx.secret);

  if (!ctx.env.DB) {
    const memory = getMemoryState();
    const account = memory.accountsByHandle.get(normalized);
    if (!account || account.deletedAtMs) {
      unauthorized("Invalid credentials");
    }
    const matches = await verifyPasswordHash(password, account.passwordSalt, account.passwordHash);
    if (!matches) {
      unauthorized("Invalid credentials");
    }
    const session = await createAccountSession(ctx, account.id, account.handle, fingerprint);
    return json({
      token: session.token,
      account: {
        id: account.id,
        handle: account.handle,
        rating: account.rating,
        locale: account.locale,
        verifiedRuns: account.verifiedRuns,
        createdAt: toIso(account.createdAtMs),
        sessionTtlMs: ACCOUNT_SESSION_TTL_MS,
      },
    });
  }

  const row = await dbFirst<{
    id: string;
    handle: string;
    password_hash: string;
    password_salt: string;
    rating: number;
    locale: string;
    verified_runs: number;
    created_at: number;
  }>(
    ctx.env.DB,
    `SELECT id, handle, password_hash, password_salt, rating, locale, verified_runs, created_at
       FROM accounts
      WHERE handle_normalized = ?
        AND deleted_at IS NULL`,
    normalized,
  );
  if (!row) {
    unauthorized("Invalid credentials");
  }
  const matches = await verifyPasswordHash(password, row.password_salt, row.password_hash);
  if (!matches) {
    unauthorized("Invalid credentials");
  }
  const session = await createAccountSession(ctx, row.id, row.handle, fingerprint);
  return json({
    token: session.token,
    account: {
      id: row.id,
      handle: row.handle,
      rating: rowNumber(row.rating),
      locale: row.locale,
      verifiedRuns: rowNumber(row.verified_runs),
      createdAt: toIso(rowNumber(row.created_at)),
      sessionTtlMs: ACCOUNT_SESSION_TTL_MS,
    },
  });
}

async function getAccountProfile(request: Request, ctx: RequestContext): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  if (!ctx.env.DB) {
    const memory = getMemoryState();
    const preferences = memory.preferences.get(account.id) ?? {};
    return json({
      account: {
        id: account.id,
        handle: account.handle,
        rating: account.rating,
        locale: account.locale,
        verifiedRuns: account.verifiedRuns,
        createdAt: toIso(account.createdAtMs),
      },
      preferences,
    });
  }
  const row = await dbFirst<{ preferences_json: string | null }>(
    ctx.env.DB,
    `SELECT preferences_json
       FROM account_preferences
      WHERE account_id = ?`,
    account.id,
  );
  return json({
    account: {
      id: account.id,
      handle: account.handle,
      rating: account.rating,
      locale: account.locale,
      verifiedRuns: account.verifiedRuns,
      createdAt: toIso(account.createdAtMs),
    },
    preferences: row?.preferences_json ? (JSON.parse(row.preferences_json) as Record<string, unknown>) : {},
  });
}

async function updatePreferences(
  request: Request,
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  const preferences = body.preferences;
  if (!isRecord(preferences)) {
    badRequest("Invalid preferences payload");
  }
  if (!ctx.env.DB) {
    getMemoryState().preferences.set(account.id, preferences);
    return json({ ok: true, preferences });
  }
  await dbRun(
    ctx.env.DB,
    `INSERT INTO account_preferences (account_id, preferences_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       preferences_json = excluded.preferences_json,
       updated_at = excluded.updated_at`,
    account.id,
    JSON.stringify(preferences),
    ctx.nowMs,
  );
  return json({ ok: true, preferences });
}

async function listAccountSessions(request: Request, ctx: RequestContext): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  if (!ctx.env.DB) {
    const sessions = [...getMemoryState().accountSessions.values()]
      .filter((session) => session.accountId === account.id && !session.revokedAtMs && session.expiresAtMs > ctx.nowMs)
      .sort((left, right) => right.lastSeenAtMs - left.lastSeenAtMs || right.createdAtMs - left.createdAtMs)
      .map((session) => ({
        id: session.id,
        label: session.label,
        createdAt: toIso(session.createdAtMs),
        lastSeenAt: toIso(session.lastSeenAtMs),
        expiresAt: toIso(session.expiresAtMs),
        isCurrent: session.id === account.sessionId,
      }));
    return json({ currentSessionId: account.sessionId, sessions });
  }
  const rows = await dbAll<{
    id: string;
    label: string;
    created_at: number;
    last_seen_at: number;
    expires_at: number;
  }>(
    ctx.env.DB,
    `SELECT id, label, created_at, last_seen_at, expires_at
       FROM account_sessions
      WHERE account_id = ?
        AND revoked_at IS NULL
        AND expires_at > ?
      ORDER BY last_seen_at DESC, created_at DESC`,
    account.id,
    ctx.nowMs,
  );
  return json({
    currentSessionId: account.sessionId,
    sessions: rows.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: toIso(rowNumber(row.created_at)),
      lastSeenAt: toIso(rowNumber(row.last_seen_at)),
      expiresAt: toIso(rowNumber(row.expires_at)),
      isCurrent: row.id === account.sessionId,
    })),
  });
}

async function logoutCurrent(request: Request, ctx: RequestContext): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  if (!ctx.env.DB) {
    const session = getMemoryState().accountSessions.get(account.sessionId);
    if (session) {
      session.revokedAtMs = ctx.nowMs;
    }
  } else {
    await dbRun(
      ctx.env.DB,
      `UPDATE account_sessions
          SET revoked_at = ?
        WHERE id = ?
          AND account_id = ?`,
      ctx.nowMs,
      account.sessionId,
      account.id,
    );
  }
  return json({ ok: true });
}

async function logoutOthers(request: Request, ctx: RequestContext): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  if (!ctx.env.DB) {
    for (const session of getMemoryState().accountSessions.values()) {
      if (session.accountId === account.id && session.id !== account.sessionId) {
        session.revokedAtMs = ctx.nowMs;
      }
    }
  } else {
    await dbRun(
      ctx.env.DB,
      `UPDATE account_sessions
          SET revoked_at = ?
        WHERE account_id = ?
          AND id <> ?
          AND revoked_at IS NULL`,
      ctx.nowMs,
      account.id,
      account.sessionId,
    );
  }
  return json({ ok: true });
}

async function revokeSession(
  request: Request,
  ctx: RequestContext,
  sessionId: string,
): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  if (!sessionId) {
    badRequest("Missing session id");
  }
  if (!ctx.env.DB) {
    const session = getMemoryState().accountSessions.get(sessionId);
    if (!session || session.accountId !== account.id) {
      notFound("Session not found");
    }
    session.revokedAtMs = ctx.nowMs;
    return json({ ok: true, currentSessionRevoked: sessionId === account.sessionId });
  }
  const result = await dbRun(
    ctx.env.DB,
    `UPDATE account_sessions
        SET revoked_at = ?
      WHERE id = ?
        AND account_id = ?
        AND revoked_at IS NULL`,
    ctx.nowMs,
    sessionId,
    account.id,
  );
  if ((result.meta?.changes ?? 0) !== 1) {
    notFound("Session not found");
  }
  return json({ ok: true, currentSessionRevoked: sessionId === account.sessionId });
}

async function changePassword(
  request: Request,
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  const currentPassword = parseString(body.currentPassword, { min: 1, max: 128, trim: false });
  const nextPassword = parseString(body.newPassword, { min: 1, max: 128, trim: false });
  if (!passwordMeetsPolicy(nextPassword)) {
    unprocessable("Password must be 10+ chars and include uppercase, lowercase, and number");
  }
  const nextHash = await createPasswordHash(nextPassword);
  if (!ctx.env.DB) {
    const memory = getMemoryState();
    const current = memory.accountsById.get(account.id);
    if (!current) {
      notFound("Account not found");
    }
    const matches = await verifyPasswordHash(currentPassword, current.passwordSalt, current.passwordHash);
    if (!matches) {
      unauthorized("Current password is incorrect");
    }
    current.passwordHash = nextHash.hash;
    current.passwordSalt = nextHash.salt;
    current.updatedAtMs = ctx.nowMs;
    for (const session of memory.accountSessions.values()) {
      if (session.accountId === account.id && session.id !== account.sessionId) {
        session.revokedAtMs = ctx.nowMs;
      }
    }
    return json({ ok: true });
  }
  const current = await dbFirst<{ password_hash: string; password_salt: string }>(
    ctx.env.DB,
    `SELECT password_hash, password_salt
       FROM accounts
      WHERE id = ?
        AND deleted_at IS NULL`,
    account.id,
  );
  if (!current) {
    notFound("Account not found");
  }
  const matches = await verifyPasswordHash(currentPassword, current.password_salt, current.password_hash);
  if (!matches) {
    unauthorized("Current password is incorrect");
  }
  await dbRun(
    ctx.env.DB,
    `UPDATE accounts
        SET password_hash = ?,
            password_salt = ?,
            updated_at = ?
      WHERE id = ?`,
    nextHash.hash,
    nextHash.salt,
    ctx.nowMs,
    account.id,
  );
  await dbRun(
    ctx.env.DB,
    `UPDATE account_sessions
        SET revoked_at = ?
      WHERE account_id = ?
        AND id <> ?
        AND revoked_at IS NULL`,
    ctx.nowMs,
    account.id,
    account.sessionId,
  );
  return json({ ok: true });
}

async function exportAccount(request: Request, ctx: RequestContext): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  if (!ctx.env.DB) {
    const memory = getMemoryState();
    return json({
      exportedAt: toIso(ctx.nowMs),
      account: memory.accountsById.get(account.id) ?? null,
      preferences: memory.preferences.get(account.id) ?? {},
      sessions: [...memory.accountSessions.values()]
        .filter((session) => session.accountId === account.id)
        .map((session) => ({
          id: session.id,
          label: session.label,
          createdAt: toIso(session.createdAtMs),
          lastSeenAt: toIso(session.lastSeenAtMs),
          expiresAt: toIso(session.expiresAtMs),
          revokedAt: session.revokedAtMs ? toIso(session.revokedAtMs) : null,
        })),
      replayShares: [...memory.replayShares.values()]
        .filter((entry) => entry.accountId === account.id)
        .map((entry) => ({
          id: entry.id,
          accountId: entry.accountId,
          mode: entry.mode,
          title: entry.title,
          replay: entry.replay,
          isPublic: entry.isPublic,
          createdAt: toIso(entry.createdAtMs),
        })),
      webhooks: [...memory.webhooks.values()]
        .filter((entry) => entry.accountId === account.id)
        .map((entry) => ({
          id: entry.id,
          targetUrl: entry.targetUrl,
          events: entry.events,
          active: entry.active,
          createdAt: toIso(entry.createdAtMs),
      })),
      scores: memory.leaderboardScores
        .filter((score) => score.accountId === account.id)
        .map((score) => ({
          ...score,
          createdAt: toIso(score.createdAtMs),
        })),
      challengeScores: memory.challengeScores
        .filter((score) => score.accountId === account.id)
        .map((score) => ({
          ...score,
          createdAt: toIso(score.createdAtMs),
        })),
    });
  }

  const [prefsRow, sessions, replayShares, webhooks, scores, challengeScores] = await Promise.all([
    dbFirst<{ preferences_json: string | null }>(
      ctx.env.DB,
      `SELECT preferences_json
         FROM account_preferences
        WHERE account_id = ?`,
      account.id,
    ),
    dbAll<{
      id: string;
      label: string;
      created_at: number;
      last_seen_at: number;
      expires_at: number;
      revoked_at: number | null;
    }>(
      ctx.env.DB,
      `SELECT id, label, created_at, last_seen_at, expires_at, revoked_at
         FROM account_sessions
        WHERE account_id = ?
        ORDER BY created_at DESC`,
      account.id,
    ),
    dbAll<{
      id: string;
      account_id: string | null;
      mode: string;
      title: string;
      replay_json: string;
      is_public: number;
      created_at: number;
    }>(
      ctx.env.DB,
      `SELECT id, account_id, mode, title, replay_json, is_public, created_at
         FROM replay_shares
        WHERE account_id = ?
        ORDER BY created_at DESC`,
      account.id,
    ),
    dbAll<{
      id: string;
      target_url: string;
      events_json: string;
      active: number;
      created_at: number;
    }>(
      ctx.env.DB,
      `SELECT id, target_url, events_json, active, created_at
         FROM webhook_endpoints
        WHERE account_id = ?
        ORDER BY created_at DESC`,
      account.id,
    ),
    dbAll<Record<string, unknown>>(
      ctx.env.DB,
      `SELECT id, session_id, account_id, username, mode, wpm, raw, accuracy, errors, streak, duration_ms, certified, client_version, telemetry_json, created_at
         FROM leaderboard_scores
        WHERE account_id = ?
        ORDER BY created_at DESC
        LIMIT 5000`,
      account.id,
    ),
    dbAll<Record<string, unknown>>(
      ctx.env.DB,
      `SELECT id, session_id, account_id, challenge_date, season_id, username, mode, points, wpm, raw, accuracy, errors, streak, duration_ms, created_at
         FROM challenge_scores
        WHERE account_id = ?
        ORDER BY created_at DESC
        LIMIT 5000`,
      account.id,
    ),
  ]);

  return json({
    exportedAt: toIso(ctx.nowMs),
    account: {
      id: account.id,
      handle: account.handle,
      rating: account.rating,
      locale: account.locale,
      verifiedRuns: account.verifiedRuns,
      createdAt: toIso(account.createdAtMs),
    },
    preferences: prefsRow?.preferences_json ? (JSON.parse(prefsRow.preferences_json) as Record<string, unknown>) : {},
    sessions: sessions.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: toIso(rowNumber(row.created_at)),
      lastSeenAt: toIso(rowNumber(row.last_seen_at)),
      expiresAt: toIso(rowNumber(row.expires_at)),
      revokedAt: row.revoked_at == null ? null : toIso(rowNumber(row.revoked_at)),
    })),
    replayShares: replayShares.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      mode: row.mode,
      title: row.title,
      replay: JSON.parse(row.replay_json) as Record<string, unknown>,
      isPublic: rowBoolean(row.is_public),
      createdAt: toIso(rowNumber(row.created_at)),
    })),
    webhooks: webhooks.map((row) => ({
      id: row.id,
      targetUrl: row.target_url,
      events: JSON.parse(row.events_json as string) as string[],
      active: rowBoolean(row.active),
      createdAt: toIso(rowNumber(row.created_at)),
    })),
    scores,
    challengeScores,
  });
}

async function deleteAccount(request: Request, ctx: RequestContext, body: Record<string, unknown>): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  const confirmHandle = parseString(body.confirmHandle, { min: 2, max: 24 });
  if (normalizeUsername(confirmHandle).toLowerCase() !== normalizeUsername(account.handle).toLowerCase()) {
    unprocessable("Handle confirmation does not match");
  }
  if (!ctx.env.DB) {
    const memory = getMemoryState();
    memory.accountsById.delete(account.id);
    memory.accountsByHandle.delete(normalizeUsername(account.handle).toLowerCase());
    memory.preferences.delete(account.id);
    for (const [id, session] of memory.accountSessions.entries()) {
      if (session.accountId === account.id) {
        memory.accountSessions.delete(id);
      }
    }
    memory.leaderboardScores = memory.leaderboardScores.filter((score) => score.accountId !== account.id);
    memory.challengeScores = memory.challengeScores.filter((score) => score.accountId !== account.id);
    for (const [id, replay] of memory.replayShares.entries()) {
      if (replay.accountId === account.id) {
        memory.replayShares.delete(id);
      }
    }
    for (const [id, request] of memory.friendRequests.entries()) {
      if (request.fromAccountId === account.id || request.toAccountId === account.id) {
        memory.friendRequests.delete(id);
      }
    }
    for (const [id, webhook] of memory.webhooks.entries()) {
      if (webhook.accountId === account.id) {
        memory.webhooks.delete(id);
      }
    }
    removeFromQueue(memory.rankedQueue, account.id);
    removeFromQueue(memory.casualQueue, account.id);
    const duelId = memory.accountToDuel.get(account.id);
    if (duelId) {
      memory.activeDuels.delete(duelId);
      memory.accountToDuel.delete(account.id);
    }
    return json({ ok: true, deleted: true });
  }
  await dbRun(ctx.env.DB, `DELETE FROM leaderboard_scores WHERE account_id = ?`, account.id);
  await dbRun(ctx.env.DB, `DELETE FROM challenge_scores WHERE account_id = ?`, account.id);
  await dbRun(ctx.env.DB, `DELETE FROM replay_shares WHERE account_id = ?`, account.id);
  await dbRun(ctx.env.DB, `DELETE FROM account_friend_requests WHERE from_account_id = ? OR to_account_id = ?`, account.id, account.id);
  await dbRun(ctx.env.DB, `DELETE FROM webhook_endpoints WHERE account_id = ?`, account.id);
  await dbRun(ctx.env.DB, `DELETE FROM account_sessions WHERE account_id = ?`, account.id);
  await dbRun(ctx.env.DB, `DELETE FROM account_preferences WHERE account_id = ?`, account.id);
  const result = await dbRun(ctx.env.DB, `DELETE FROM accounts WHERE id = ?`, account.id);
  if ((result.meta?.changes ?? 0) !== 1) {
    notFound("Account not found");
  }
  return json({ ok: true, deleted: true });
}

async function listAdminUsers(request: Request, ctx: RequestContext): Promise<Response> {
  await requireAdminAccount(request, ctx);
  const url = new URL(request.url);
  const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
  const likeQuery = query ? `%${query}%` : "";
  const limit = parseInteger(url.searchParams.get("limit") ?? "30", { min: 1, max: 100 });

  if (!ctx.env.DB) {
    const memory = getMemoryState();
    const users = [...memory.accountsById.values()]
      .filter((account) => !query || account.handle.toLowerCase().includes(query))
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, limit)
      .map((account) => ({
        id: account.id,
        handle: account.handle,
        rating: account.rating,
        locale: account.locale,
        verifiedRuns: account.verifiedRuns,
        createdAt: toIso(account.createdAtMs),
        deletedAt: account.deletedAtMs == null ? null : toIso(account.deletedAtMs),
        sessionCount: [...memory.accountSessions.values()].filter((session) => session.accountId === account.id)
          .length,
        scoreCount: memory.leaderboardScores.filter((score) => score.accountId === account.id).length,
        challengeScoreCount: memory.challengeScores.filter((score) => score.accountId === account.id).length,
        replayShareCount: [...memory.replayShares.values()].filter((replay) => replay.accountId === account.id)
          .length,
        webhookCount: [...memory.webhooks.values()].filter((webhook) => webhook.accountId === account.id).length,
      }));
    return json({ users });
  }

  const rows = await dbAll<{
    id: string;
    handle: string;
    rating: number;
    locale: string;
    verified_runs: number;
    created_at: number;
    deleted_at: number | null;
    session_count: number;
    score_count: number;
    challenge_score_count: number;
    replay_share_count: number;
    webhook_count: number;
  }>(
    ctx.env.DB,
    `SELECT a.id,
            a.handle,
            a.rating,
            a.locale,
            a.verified_runs,
            a.created_at,
            a.deleted_at,
            (SELECT COUNT(*) FROM account_sessions s WHERE s.account_id = a.id) AS session_count,
            (SELECT COUNT(*) FROM leaderboard_scores ls WHERE ls.account_id = a.id) AS score_count,
            (SELECT COUNT(*) FROM challenge_scores cs WHERE cs.account_id = a.id) AS challenge_score_count,
            (SELECT COUNT(*) FROM replay_shares rs WHERE rs.account_id = a.id) AS replay_share_count,
            (SELECT COUNT(*) FROM webhook_endpoints wh WHERE wh.account_id = a.id) AS webhook_count
       FROM accounts a
      WHERE (? = '' OR lower(a.handle) LIKE ?)
      ORDER BY a.created_at DESC
      LIMIT ?`,
    query,
    likeQuery,
    limit,
  );

  return json({
    users: rows.map((row) => ({
      id: row.id,
      handle: row.handle,
      rating: rowNumber(row.rating),
      locale: row.locale,
      verifiedRuns: rowNumber(row.verified_runs),
      createdAt: toIso(rowNumber(row.created_at)),
      deletedAt: row.deleted_at == null ? null : toIso(rowNumber(row.deleted_at)),
      sessionCount: rowNumber(row.session_count),
      scoreCount: rowNumber(row.score_count),
      challengeScoreCount: rowNumber(row.challenge_score_count),
      replayShareCount: rowNumber(row.replay_share_count),
      webhookCount: rowNumber(row.webhook_count),
    })),
  });
}

async function deleteAdminUser(
  request: Request,
  ctx: RequestContext,
  accountId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const admin = await requireAdminAccount(request, ctx);
  if (admin.id === accountId) {
    unprocessable("Use the regular account deletion flow for your own account");
  }
  const confirmHandle = parseString(body.confirmHandle, { min: 2, max: 24 });

  if (!ctx.env.DB) {
    const memory = getMemoryState();
    const account = memory.accountsById.get(accountId);
    if (!account) {
      notFound("Account not found");
    }
    if (normalizeUsername(confirmHandle).toLowerCase() !== normalizeUsername(account.handle).toLowerCase()) {
      unprocessable("Handle confirmation does not match");
    }
    memory.accountsById.delete(account.id);
    memory.accountsByHandle.delete(account.handleNormalized);
    memory.preferences.delete(account.id);
    for (const [id, session] of memory.accountSessions.entries()) {
      if (session.accountId === account.id) {
        memory.accountSessions.delete(id);
      }
    }
    memory.leaderboardScores = memory.leaderboardScores.filter(
      (score) => score.accountId !== account.id,
    );
    memory.challengeScores = memory.challengeScores.filter(
      (score) => score.accountId !== account.id,
    );
    for (const [id, replay] of memory.replayShares.entries()) {
      if (replay.accountId === account.id) {
        memory.replayShares.delete(id);
      }
    }
    for (const [id, requestEntry] of memory.friendRequests.entries()) {
      if (requestEntry.fromAccountId === account.id || requestEntry.toAccountId === account.id) {
        memory.friendRequests.delete(id);
      }
    }
    for (const [id, webhook] of memory.webhooks.entries()) {
      if (webhook.accountId === account.id) {
        memory.webhooks.delete(id);
      }
    }
    removeFromQueue(memory.rankedQueue, account.id);
    removeFromQueue(memory.casualQueue, account.id);
    const duelId = memory.accountToDuel.get(account.id);
    if (duelId) {
      memory.activeDuels.delete(duelId);
      memory.accountToDuel.delete(account.id);
    }
    return json({ ok: true, deleted: true });
  }

  const row = await dbFirst<{ id: string; handle: string }>(
    ctx.env.DB,
    `SELECT id, handle FROM accounts WHERE id = ?`,
    accountId,
  );
  if (!row) {
    notFound("Account not found");
  }
  if (normalizeUsername(confirmHandle).toLowerCase() !== normalizeUsername(row.handle).toLowerCase()) {
    unprocessable("Handle confirmation does not match");
  }
  await dbRun(ctx.env.DB, `DELETE FROM leaderboard_scores WHERE account_id = ?`, row.id);
  await dbRun(ctx.env.DB, `DELETE FROM challenge_scores WHERE account_id = ?`, row.id);
  await dbRun(ctx.env.DB, `DELETE FROM replay_shares WHERE account_id = ?`, row.id);
  await dbRun(ctx.env.DB, `DELETE FROM account_friend_requests WHERE from_account_id = ? OR to_account_id = ?`, row.id, row.id);
  await dbRun(ctx.env.DB, `DELETE FROM webhook_endpoints WHERE account_id = ?`, row.id);
  await dbRun(ctx.env.DB, `DELETE FROM account_sessions WHERE account_id = ?`, row.id);
  await dbRun(ctx.env.DB, `DELETE FROM account_preferences WHERE account_id = ?`, row.id);
  const result = await dbRun(ctx.env.DB, `DELETE FROM accounts WHERE id = ?`, row.id);
  if ((result.meta?.changes ?? 0) !== 1) {
    notFound("Account not found");
  }
  return json({ ok: true, deleted: true });
}

async function listAdminLeaderboard(request: Request, ctx: RequestContext): Promise<Response> {
  await requireAdminAccount(request, ctx);
  const url = new URL(request.url);
  const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
  const likeQuery = query ? `%${query}%` : "";
  const modeParam = url.searchParams.get("mode") ?? "all";
  if (modeParam !== "all" && !isMode(modeParam)) {
    badRequest("Invalid leaderboard mode");
  }
  const limit = parseInteger(url.searchParams.get("limit") ?? "50", { min: 1, max: 100 });

  if (!ctx.env.DB) {
    const memory = getMemoryState();
    const entries = memory.leaderboardScores
      .filter((score) => !query || score.username.toLowerCase().includes(query))
      .filter((score) => modeParam === "all" || score.mode === modeParam)
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, limit)
      .map((score) => ({
        id: score.id,
        sessionId: score.sessionId,
        accountId: score.accountId,
        username: score.username,
        mode: score.mode,
        wpm: score.wpm,
        raw: score.raw,
        accuracy: score.accuracy,
        errors: score.errors,
        streak: score.streak,
        durationMs: score.durationMs,
        certified: score.certified,
        createdAt: toIso(score.createdAtMs),
      }));
    return json({ entries });
  }

  const rows = await dbAll<{
    id: string;
    session_id: string;
    account_id: string | null;
    username: string;
    mode: string;
    wpm: number;
    raw: number;
    accuracy: number;
    errors: number;
    streak: number;
    duration_ms: number;
    certified: number;
    created_at: number;
  }>(
    ctx.env.DB,
    `SELECT id,
            session_id,
            account_id,
            username,
            mode,
            wpm,
            raw,
            accuracy,
            errors,
            streak,
            duration_ms,
            certified,
            created_at
       FROM leaderboard_scores
      WHERE (? = '' OR lower(username) LIKE ?)
        AND (? = 'all' OR mode = ?)
      ORDER BY created_at DESC
      LIMIT ?`,
    query,
    likeQuery,
    modeParam,
    modeParam,
    limit,
  );
  return json({
    entries: rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      accountId: row.account_id,
      username: row.username,
      mode: row.mode,
      wpm: rowNumber(row.wpm),
      raw: rowNumber(row.raw),
      accuracy: rowNumber(row.accuracy),
      errors: rowNumber(row.errors),
      streak: rowNumber(row.streak),
      durationMs: rowNumber(row.duration_ms),
      certified: rowBoolean(row.certified),
      createdAt: toIso(rowNumber(row.created_at)),
    })),
  });
}

async function deleteAdminLeaderboardScore(
  request: Request,
  ctx: RequestContext,
  scoreId: string,
): Promise<Response> {
  await requireAdminAccount(request, ctx);
  if (!ctx.env.DB) {
    const memory = getMemoryState();
    const before = memory.leaderboardScores.length;
    memory.leaderboardScores = memory.leaderboardScores.filter((score) => score.id !== scoreId);
    if (memory.leaderboardScores.length === before) {
      notFound("Leaderboard score not found");
    }
    return json({ ok: true, deleted: true });
  }
  const result = await dbRun(ctx.env.DB, `DELETE FROM leaderboard_scores WHERE id = ?`, scoreId);
  if ((result.meta?.changes ?? 0) !== 1) {
    notFound("Leaderboard score not found");
  }
  return json({ ok: true, deleted: true });
}

async function shareReplay(
  request: Request,
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized("Replay sharing requires an account on the Cloudflare launch");
  }
  const mode = body.mode;
  const title = parseString(body.title, { min: 2, max: 80 });
  const replay = body.replay;
  const isPublic = parseBoolean(body.isPublic, true);
  if (!isMode(mode)) {
    badRequest("Invalid replay share payload");
  }
  if (!isRecord(replay)) {
    badRequest("Invalid replay share payload");
  }
  const replayId = randomPublicId(10);
  if (!ctx.env.DB) {
    getMemoryState().replayShares.set(replayId, {
      id: replayId,
      accountId: account.id,
      mode,
      title,
      replay,
      isPublic,
      createdAtMs: ctx.nowMs,
    });
  } else {
    await dbRun(
      ctx.env.DB,
      `INSERT INTO replay_shares (id, account_id, mode, title, replay_json, is_public, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      replayId,
      account.id,
      mode,
      title,
      JSON.stringify(replay),
      isPublic ? 1 : 0,
      ctx.nowMs,
    );
  }
  return json(
    {
      id: replayId,
      url: `/share/replay/${replayId}`,
    },
    { status: 201 },
  );
}

async function getReplayShare(ctx: RequestContext, replayId: string): Promise<Response> {
  if (!replayId) {
    notFound("Replay not found");
  }
  if (!ctx.env.DB) {
    const replay = getMemoryState().replayShares.get(replayId);
    if (!replay || !replay.isPublic) {
      notFound("Replay not found");
    }
    return json({
      id: replay.id,
      accountId: replay.accountId,
      mode: replay.mode,
      title: replay.title,
      replay: replay.replay,
      isPublic: replay.isPublic,
      createdAt: toIso(replay.createdAtMs),
    });
  }
  const row = await dbFirst<{
    id: string;
    account_id: string | null;
    mode: string;
    title: string;
    replay_json: string;
    is_public: number;
    created_at: number;
  }>(
    ctx.env.DB,
    `SELECT id, account_id, mode, title, replay_json, is_public, created_at
       FROM replay_shares
      WHERE id = ?
        AND is_public = 1`,
    replayId,
  );
  if (!row) {
    notFound("Replay not found");
  }
  return json({
    id: row.id,
    accountId: row.account_id,
    mode: row.mode,
    title: row.title,
    replay: JSON.parse(row.replay_json) as Record<string, unknown>,
    isPublic: rowBoolean(row.is_public),
    createdAt: toIso(rowNumber(row.created_at)),
  });
}

async function listReplayShares(request: Request, ctx: RequestContext): Promise<Response> {
  const url = new URL(request.url);
  const mine = url.searchParams.get("mine") === "true";
  const account = mine ? await getAuthedAccount(request, ctx) : null;
  if (mine && !account) {
    unauthorized();
  }
  if (!ctx.env.DB) {
    const entries = [...getMemoryState().replayShares.values()]
      .filter((entry) => (mine ? entry.accountId === account?.id : entry.isPublic))
      .sort((left, right) => right.createdAtMs - left.createdAtMs)
      .slice(0, 40)
      .map((entry) => ({
        id: entry.id,
        accountId: entry.accountId,
        mode: entry.mode,
        title: entry.title,
        isPublic: entry.isPublic,
        createdAt: toIso(entry.createdAtMs),
      }));
    return json({ entries });
  }
  const rows = mine
    ? await dbAll<{
        id: string;
        account_id: string | null;
        mode: string;
        title: string;
        is_public: number;
        created_at: number;
      }>(
        ctx.env.DB,
        `SELECT id, account_id, mode, title, is_public, created_at
           FROM replay_shares
          WHERE account_id = ?
          ORDER BY created_at DESC
          LIMIT 40`,
        account?.id ?? "",
      )
    : await dbAll<{
        id: string;
        account_id: string | null;
        mode: string;
        title: string;
        is_public: number;
        created_at: number;
      }>(
        ctx.env.DB,
        `SELECT id, account_id, mode, title, is_public, created_at
           FROM replay_shares
          WHERE is_public = 1
          ORDER BY created_at DESC
          LIMIT 40`,
      );
  return json({
    entries: rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      mode: row.mode,
      title: row.title,
      isPublic: rowBoolean(row.is_public),
      createdAt: toIso(rowNumber(row.created_at)),
    })),
  });
}

async function listFriends(request: Request, ctx: RequestContext): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  if (!ctx.env.DB) {
    const memory = getMemoryState();
    const accepted = [...memory.friendRequests.values()].filter(
      (row) => row.status === "accepted" && (row.fromAccountId === account.id || row.toAccountId === account.id),
    );
    const incoming = [...memory.friendRequests.values()].filter(
      (row) => row.status === "pending" && row.toAccountId === account.id,
    );
    const outgoing = [...memory.friendRequests.values()].filter(
      (row) => row.status === "pending" && row.fromAccountId === account.id,
    );
    return json({
      friends: accepted.map((row) => {
        const friendId = row.fromAccountId === account.id ? row.toAccountId : row.fromAccountId;
        const friend = memory.accountsById.get(friendId);
        return { id: friendId, handle: friend?.handle ?? "unknown", rating: friend?.rating ?? 1000 };
      }),
      incoming: incoming.map((row) => ({
        requestId: row.id,
        fromAccountId: row.fromAccountId,
        fromHandle: memory.accountsById.get(row.fromAccountId)?.handle ?? "unknown",
        createdAt: toIso(row.createdAtMs),
      })),
      outgoing: outgoing.map((row) => ({
        requestId: row.id,
        toAccountId: row.toAccountId,
        toHandle: memory.accountsById.get(row.toAccountId)?.handle ?? "unknown",
        createdAt: toIso(row.createdAtMs),
      })),
    });
  }
  const [friends, incoming, outgoing] = await Promise.all([
    dbAll<{ id: string; handle: string; rating: number }>(
      ctx.env.DB,
      `SELECT a.id, a.handle, a.rating
         FROM account_friend_requests fr
         JOIN accounts a ON a.id = CASE
           WHEN fr.from_account_id = ? THEN fr.to_account_id
           ELSE fr.from_account_id
         END
        WHERE fr.status = 'accepted'
          AND (fr.from_account_id = ? OR fr.to_account_id = ?)
        ORDER BY a.handle ASC`,
      account.id,
      account.id,
      account.id,
    ),
    dbAll<{ id: string; from_account_id: string; handle: string; created_at: number }>(
      ctx.env.DB,
      `SELECT fr.id, fr.from_account_id, a.handle, fr.created_at
         FROM account_friend_requests fr
         JOIN accounts a ON a.id = fr.from_account_id
        WHERE fr.status = 'pending'
          AND fr.to_account_id = ?
        ORDER BY fr.created_at DESC`,
      account.id,
    ),
    dbAll<{ id: string; to_account_id: string; handle: string; created_at: number }>(
      ctx.env.DB,
      `SELECT fr.id, fr.to_account_id, a.handle, fr.created_at
         FROM account_friend_requests fr
         JOIN accounts a ON a.id = fr.to_account_id
        WHERE fr.status = 'pending'
          AND fr.from_account_id = ?
        ORDER BY fr.created_at DESC`,
      account.id,
    ),
  ]);
  return json({
    friends: friends.map((row) => ({ id: row.id, handle: row.handle, rating: rowNumber(row.rating) })),
    incoming: incoming.map((row) => ({
      requestId: row.id,
      fromAccountId: row.from_account_id,
      fromHandle: row.handle,
      createdAt: toIso(rowNumber(row.created_at)),
    })),
    outgoing: outgoing.map((row) => ({
      requestId: row.id,
      toAccountId: row.to_account_id,
      toHandle: row.handle,
      createdAt: toIso(rowNumber(row.created_at)),
    })),
  });
}

async function requestFriend(request: Request, ctx: RequestContext, body: Record<string, unknown>): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  const targetHandle = normalizeUsername(parseString(body.handle, { min: 2, max: 24 })).toLowerCase();
  if (targetHandle === normalizeUsername(account.handle).toLowerCase()) {
    unprocessable("Cannot add yourself");
  }
  if (!ctx.env.DB) {
    const memory = getMemoryState();
    const target = memory.accountsByHandle.get(targetHandle);
    if (!target || target.deletedAtMs) {
      notFound("Account not found");
    }
    const reverse = [...memory.friendRequests.values()].find(
      (row) => row.fromAccountId === target.id && row.toAccountId === account.id && row.status === "pending",
    );
    if (reverse) {
      reverse.status = "accepted";
      reverse.respondedAtMs = ctx.nowMs;
      return json({ ok: true, matched: true, requestId: reverse.id });
    }
    const existing = [...memory.friendRequests.values()].find(
      (row) => row.fromAccountId === account.id && row.toAccountId === target.id,
    );
    if (existing) {
      existing.status = "pending";
      existing.respondedAtMs = null;
      return json({ ok: true, matched: false, requestId: existing.id });
    }
    const requestId = randomId();
    memory.friendRequests.set(requestId, {
      id: requestId,
      fromAccountId: account.id,
      toAccountId: target.id,
      status: "pending",
      createdAtMs: ctx.nowMs,
      respondedAtMs: null,
    });
    return json({ ok: true, matched: false, requestId }, { status: 201 });
  }
  const target = await dbFirst<{ id: string }>(
    ctx.env.DB,
    `SELECT id
       FROM accounts
      WHERE handle_normalized = ?
        AND deleted_at IS NULL`,
    targetHandle,
  );
  if (!target) {
    notFound("Account not found");
  }
  const reverse = await dbFirst<{ id: string }>(
    ctx.env.DB,
    `SELECT id
       FROM account_friend_requests
      WHERE from_account_id = ?
        AND to_account_id = ?
        AND status = 'pending'`,
    target.id,
    account.id,
  );
  if (reverse) {
    await dbRun(
      ctx.env.DB,
      `UPDATE account_friend_requests
          SET status = 'accepted',
              responded_at = ?
        WHERE id = ?`,
      ctx.nowMs,
      reverse.id,
    );
    return json({ ok: true, matched: true, requestId: reverse.id });
  }
  const requestId = randomId();
  await dbRun(
    ctx.env.DB,
    `INSERT INTO account_friend_requests (id, from_account_id, to_account_id, status, created_at, responded_at)
     VALUES (?, ?, ?, 'pending', ?, NULL)
     ON CONFLICT(from_account_id, to_account_id) DO UPDATE SET
       status = 'pending',
       responded_at = NULL`,
    requestId,
    account.id,
    target.id,
    ctx.nowMs,
  );
  return json({ ok: true, matched: false, requestId }, { status: 201 });
}

async function respondFriend(request: Request, ctx: RequestContext, body: Record<string, unknown>): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  const requestId = parseString(body.requestId, { min: 8, max: 64 });
  const status = parseBoolean(body.accept, false) ? "accepted" : "declined";
  if (!ctx.env.DB) {
    const friendRequest = getMemoryState().friendRequests.get(requestId);
    if (!friendRequest || friendRequest.toAccountId !== account.id || friendRequest.status !== "pending") {
      notFound("Request not found");
    }
    friendRequest.status = status;
    friendRequest.respondedAtMs = ctx.nowMs;
    return json({ ok: true, status });
  }
  const result = await dbRun(
    ctx.env.DB,
    `UPDATE account_friend_requests
        SET status = ?,
            responded_at = ?
      WHERE id = ?
        AND to_account_id = ?
        AND status = 'pending'`,
    status,
    ctx.nowMs,
    requestId,
    account.id,
  );
  if ((result.meta?.changes ?? 0) !== 1) {
    notFound("Request not found");
  }
  return json({ ok: true, status });
}

async function createRace(request: Request, ctx: RequestContext, body: Record<string, unknown>): Promise<Response> {
  const mode = body.mode;
  if (!isMode(mode)) {
    badRequest("Invalid race creation payload");
  }
  const name = parseDisplayName(body.name);
  const playerId = randomId();
  let roomId = generateRoomCode();
  if (!ctx.env.DB) {
    const memory = getMemoryState();
    cleanupRaceRoomsInMemory(ctx);
    while (memory.raceRooms.has(roomId)) {
      roomId = generateRoomCode();
    }
    const room: MemoryRaceRoom = {
      id: roomId,
      mode,
      status: "lobby",
      createdAtMs: ctx.nowMs,
      startedAtMs: null,
      hostPlayerId: playerId,
      players: new Map(),
    };
    room.players.set(playerId, {
      id: playerId,
      name,
      progress: 0,
      wpm: 0,
      accuracy: 100,
      finished: false,
      finishedAtMs: null,
      lastSeenAtMs: ctx.nowMs,
    });
    memory.raceRooms.set(roomId, room);
    return json({ roomId, playerId, room: serializeRaceRoom(room) }, { status: 201 });
  }
  await cleanupRaceRoomsInDatabase(ctx);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const existing = await dbFirst<{ id: string }>(ctx.env.DB, `SELECT id FROM race_rooms WHERE id = ?`, roomId);
    if (!existing) {
      break;
    }
    roomId = generateRoomCode();
  }
  await dbRun(
    ctx.env.DB,
    `INSERT INTO race_rooms (id, mode, status, host_player_id, created_at, started_at)
     VALUES (?, ?, 'lobby', ?, ?, NULL)`,
    roomId,
    mode,
    playerId,
    ctx.nowMs,
  );
  await dbRun(
    ctx.env.DB,
    `INSERT INTO race_players (id, room_id, name, progress, wpm, accuracy, finished, finished_at, last_seen_at)
     VALUES (?, ?, ?, 0, 0, 100, 0, NULL, ?)`,
    playerId,
    roomId,
    name,
    ctx.nowMs,
  );
  const room = await loadRaceRoom(ctx, roomId);
  if (!room) {
    unavailable("Failed to create race room");
  }
  return json({ roomId, playerId, room: serializeRaceRoom(room) }, { status: 201 });
}

async function joinRace(ctx: RequestContext, body: Record<string, unknown>): Promise<Response> {
  const roomId = parseString(body.roomId, { min: 6, max: 24 }).toUpperCase();
  const name = parseDisplayName(body.name);
  const room = await loadRaceRoom(ctx, roomId);
  if (!room) {
    notFound("Race room not found");
  }
  if (room.players.size >= 8) {
    conflict("Race room is full");
  }
  const playerId = randomId();
  if (!ctx.env.DB) {
    room.players.set(playerId, {
      id: playerId,
      name,
      progress: 0,
      wpm: 0,
      accuracy: 100,
      finished: false,
      finishedAtMs: null,
      lastSeenAtMs: ctx.nowMs,
    });
    return json({ roomId, playerId, room: serializeRaceRoom(room) }, { status: 201 });
  }
  await dbRun(
    ctx.env.DB,
    `INSERT INTO race_players (id, room_id, name, progress, wpm, accuracy, finished, finished_at, last_seen_at)
     VALUES (?, ?, ?, 0, 0, 100, 0, NULL, ?)`,
    playerId,
    roomId,
    name,
    ctx.nowMs,
  );
  const reloaded = await loadRaceRoom(ctx, roomId);
  return json({ roomId, playerId, room: serializeRaceRoom(reloaded ?? room) }, { status: 201 });
}

async function startRace(ctx: RequestContext, body: Record<string, unknown>): Promise<Response> {
  const roomId = parseString(body.roomId, { min: 6, max: 24 }).toUpperCase();
  const playerId = parseString(body.playerId, { min: 8, max: 64 });
  const room = await loadRaceRoom(ctx, roomId);
  if (!room) {
    notFound("Race room not found");
  }
  if (room.hostPlayerId !== playerId) {
    forbidden("Only the host can start the race");
  }
  room.status = "running";
  room.startedAtMs = ctx.nowMs;
  for (const player of room.players.values()) {
    player.progress = 0;
    player.wpm = 0;
    player.accuracy = 100;
    player.finished = false;
    player.finishedAtMs = null;
    player.lastSeenAtMs = ctx.nowMs;
  }
  if (ctx.env.DB) {
    await dbRun(ctx.env.DB, `UPDATE race_rooms SET status = 'running', started_at = ? WHERE id = ?`, ctx.nowMs, roomId);
    await dbRun(
      ctx.env.DB,
      `UPDATE race_players
          SET progress = 0,
              wpm = 0,
              accuracy = 100,
              finished = 0,
              finished_at = NULL,
              last_seen_at = ?
        WHERE room_id = ?`,
      ctx.nowMs,
      roomId,
    );
  }
  return json({ ok: true, room: serializeRaceRoom(room) });
}

async function updateRace(ctx: RequestContext, body: Record<string, unknown>): Promise<Response> {
  const roomId = parseString(body.roomId, { min: 6, max: 24 }).toUpperCase();
  const playerId = parseString(body.playerId, { min: 8, max: 64 });
  const progress = parseFiniteNumber(body.progress, { min: 0, max: 100 });
  const wpm = parseFiniteNumber(body.wpm, { min: 0, max: 400 });
  const accuracy = parseFiniteNumber(body.accuracy, { min: 0, max: 100 });
  const finished = parseBoolean(body.finished, false);
  const room = await loadRaceRoom(ctx, roomId);
  if (!room) {
    notFound("Race room not found");
  }
  const player = room.players.get(playerId);
  if (!player) {
    notFound("Player not found in race room");
  }
  player.progress = progress;
  player.wpm = wpm;
  player.accuracy = accuracy;
  player.lastSeenAtMs = ctx.nowMs;
  if (finished && !player.finished) {
    player.finished = true;
    player.finishedAtMs = ctx.nowMs;
  }
  if (room.status === "running" && [...room.players.values()].every((member) => member.finished)) {
    room.status = "finished";
  }
  if (ctx.env.DB) {
    await dbRun(
      ctx.env.DB,
      `UPDATE race_players
          SET progress = ?,
              wpm = ?,
              accuracy = ?,
              finished = CASE WHEN ? THEN 1 ELSE finished END,
              finished_at = CASE WHEN ? AND finished = 0 THEN ? ELSE finished_at END,
              last_seen_at = ?
        WHERE room_id = ?
          AND id = ?`,
      progress,
      wpm,
      accuracy,
      finished ? 1 : 0,
      finished ? 1 : 0,
      ctx.nowMs,
      ctx.nowMs,
      roomId,
      playerId,
    );
    if (room.status === "finished") {
      await dbRun(ctx.env.DB, `UPDATE race_rooms SET status = 'finished' WHERE id = ?`, roomId);
    }
  }
  return json({ ok: true });
}

async function raceState(request: Request, ctx: RequestContext): Promise<Response> {
  const roomId = (new URL(request.url).searchParams.get("roomId") ?? "").trim().toUpperCase();
  if (!roomId) {
    badRequest("Invalid race room query");
  }
  const room = await loadRaceRoom(ctx, roomId);
  if (!room) {
    notFound("Race room not found");
  }
  return json({ room: serializeRaceRoom(room) });
}

async function createTournamentRoute(ctx: RequestContext, body: Record<string, unknown>): Promise<Response> {
  const mode = body.mode;
  if (!isMode(mode)) {
    badRequest("Invalid tournament payload");
  }
  const name = parseDisplayName(body.name, 48);
  const entrants = Array.isArray(body.entrants) ? body.entrants : [];
  const players = [...new Set(entrants.map((entrant) => parseDisplayName(entrant)).filter(Boolean))]
    .slice(0, 32)
    .map((entrant, index) => ({ id: randomId(), name: entrant, seedIndex: index }));
  if (players.length < 2) {
    unprocessable("At least two unique entrants are required");
  }
  const tournament: MemoryTournament = {
    id: randomId(),
    name,
    mode,
    status: "live",
    createdAtMs: ctx.nowMs,
    players: players.map(({ id, name: playerName }) => ({ id, name: playerName })),
    matches: createBracket(players),
  };
  recomputeTournament(tournament);
  if (!ctx.env.DB) {
    getMemoryState().tournaments.set(tournament.id, tournament);
    return json({ tournament: serializeTournament(tournament) }, { status: 201 });
  }
  await dbRun(
    ctx.env.DB,
    `INSERT INTO tournaments (id, name, mode, status, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    tournament.id,
    tournament.name,
    tournament.mode,
    tournament.status,
    tournament.createdAtMs,
  );
  for (const player of players) {
    await dbRun(
      ctx.env.DB,
      `INSERT INTO tournament_players (id, tournament_id, name, seed_index)
       VALUES (?, ?, ?, ?)`,
      player.id,
      tournament.id,
      player.name,
      player.seedIndex,
    );
  }
  for (const match of tournament.matches) {
    await dbRun(
      ctx.env.DB,
      `INSERT INTO tournament_matches (id, tournament_id, round, match_index, player_a_id, player_b_id, winner_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      match.id,
      tournament.id,
      match.round,
      match.index,
      match.playerAId,
      match.playerBId,
      match.winnerId,
    );
  }
  return json({ tournament: serializeTournament(tournament) }, { status: 201 });
}

async function reportTournament(ctx: RequestContext, body: Record<string, unknown>): Promise<Response> {
  const tournamentId = parseString(body.tournamentId, { min: 8, max: 64 });
  const matchId = parseString(body.matchId, { min: 8, max: 64 });
  const winnerId = parseString(body.winnerId, { min: 8, max: 64 });
  const tournament = await loadTournament(ctx, tournamentId);
  if (!tournament) {
    notFound("Tournament not found");
  }
  const match = tournament.matches.find((item) => item.id === matchId);
  if (!match) {
    notFound("Match not found");
  }
  if (winnerId !== match.playerAId && winnerId !== match.playerBId) {
    unprocessable("Winner must belong to the selected match");
  }
  match.winnerId = winnerId;
  recomputeTournament(tournament);
  await saveTournament(ctx, tournament);
  return json({ tournament: serializeTournament(tournament) });
}

async function tournamentState(request: Request, ctx: RequestContext): Promise<Response> {
  const tournamentId = (new URL(request.url).searchParams.get("tournamentId") ?? "").trim();
  if (!tournamentId) {
    badRequest("Invalid tournament query");
  }
  const tournament = await loadTournament(ctx, tournamentId);
  if (!tournament) {
    notFound("Tournament not found");
  }
  return json({ tournament: serializeTournament(tournament) });
}

async function enqueueRankedRoute(request: Request, ctx: RequestContext): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  const memory = getMemoryState();
  const activeId = memory.accountToDuel.get(account.id);
  const active = activeId ? memory.activeDuels.get(activeId) : null;
  if (active) {
    return json({ status: "matched", duel: serializeDuel(active) });
  }
  removeFromQueue(memory.casualQueue, account.id);
  removeFromQueue(memory.rankedQueue, account.id);
  const entry: MemoryQueueEntry = { accountId: account.id, handle: account.handle, rating: account.rating, queuedAtMs: ctx.nowMs };
  const opponent = memory.rankedQueue
    .filter((item) => item.accountId !== account.id && Math.abs(item.rating - entry.rating) <= MATCH_MAX_RATING_GAP)
    .sort((left, right) => Math.abs(left.rating - entry.rating) - Math.abs(right.rating - entry.rating))[0];
  if (!opponent) {
    memory.rankedQueue.push(entry);
    return json({ status: "waiting", queueSize: memory.rankedQueue.length }, { status: 202 });
  }
  removeFromQueue(memory.rankedQueue, opponent.accountId);
  return json({ status: "matched", duel: serializeDuel(startDuel("ranked", entry, opponent)) });
}

async function rankedStatusRoute(request: Request, ctx: RequestContext): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  const memory = getMemoryState();
  const activeId = memory.accountToDuel.get(account.id);
  const active = activeId ? memory.activeDuels.get(activeId) : null;
  if (active) {
    return json({ status: "matched", duel: serializeDuel(active) });
  }
  const index = memory.rankedQueue.findIndex((entry) => entry.accountId === account.id);
  if (index >= 0) {
    return json({ status: "waiting", queuePosition: index + 1, queueSize: memory.rankedQueue.length });
  }
  return json({ status: "idle" });
}

async function enqueueCasualDuelRoute(request: Request, ctx: RequestContext): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  const memory = getMemoryState();
  const activeId = memory.accountToDuel.get(account.id);
  const active = activeId ? memory.activeDuels.get(activeId) : null;
  if (active) {
    return json({ status: "matched", duel: serializeDuel(active) });
  }
  removeFromQueue(memory.rankedQueue, account.id);
  removeFromQueue(memory.casualQueue, account.id);
  const entry: MemoryQueueEntry = { accountId: account.id, handle: account.handle, rating: account.rating, queuedAtMs: ctx.nowMs };
  const opponent = memory.casualQueue.shift();
  if (!opponent) {
    memory.casualQueue.push(entry);
    return json({ status: "waiting", queueSize: memory.casualQueue.length }, { status: 202 });
  }
  return json({ status: "matched", duel: serializeDuel(startDuel("casual", entry, opponent)) });
}

async function duelStateRoute(request: Request, ctx: RequestContext): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  const url = new URL(request.url);
  const duelId = url.searchParams.get("duelId") ?? getMemoryState().accountToDuel.get(account.id);
  if (!duelId) {
    notFound("Duel not found");
  }
  const duel = getMemoryState().activeDuels.get(duelId);
  if (!duel) {
    notFound("Duel not found");
  }
  if (!duel.players.some((player) => player.accountId === account.id)) {
    forbidden("Forbidden duel access");
  }
  return json({ duel: serializeDuel(duel) });
}

async function updateDuelRoute(request: Request, ctx: RequestContext, body: Record<string, unknown>): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  const duelId = parseString(body.duelId, { min: 8, max: 64 });
  const duel = getMemoryState().activeDuels.get(duelId);
  if (!duel) {
    notFound("Duel not found");
  }
  const player = duel.players.find((item) => item.accountId === account.id);
  if (!player) {
    forbidden("Forbidden duel access");
  }
  player.progress = parseFiniteNumber(body.progress, { min: 0, max: 100 });
  player.wpm = parseFiniteNumber(body.wpm, { min: 0, max: 400 });
  player.accuracy = parseFiniteNumber(body.accuracy, { min: 0, max: 100 });
  player.finished = parseBoolean(body.finished, false);
  duel.updatedAtMs = ctx.nowMs;
  if (player.finished && !duel.winnerAccountId) {
    const opponent = duel.players.find((item) => item.accountId !== account.id);
    duel.winnerAccountId = !opponent || !opponent.finished || player.progress >= opponent.progress ? account.id : opponent.accountId;
  }
  if (duel.players.every((item) => item.finished || item.progress >= 100) || duel.winnerAccountId) {
    duel.status = "finished";
  }
  return json({ ok: true, duel: serializeDuel(duel) });
}

async function createWebhookRoute(request: Request, ctx: RequestContext, body: Record<string, unknown>): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  const targetUrl = parseString(body.targetUrl, { min: 12, max: 500 });
  if (!isWebhookTargetAllowed(targetUrl)) {
    unprocessable("Webhook target is not allowed");
  }
  const events = Array.isArray(body.events)
    ? [...new Set(body.events.map((event) => parseString(event, { min: 1, max: 64 }).toLowerCase()))]
    : ["score.submitted"];
  if (events.length < 1 || events.length > 12 || events.some((event) => !WEBHOOK_EVENT_ALLOWLIST.has(event))) {
    unprocessable("Unsupported webhook event");
  }
  const webhook = {
    id: randomId(),
    accountId: account.id,
    targetUrl,
    events,
    secret: createWebhookSecret(),
    active: true,
    createdAtMs: ctx.nowMs,
  };
  if (!ctx.env.DB) {
    getMemoryState().webhooks.set(webhook.id, webhook);
  } else {
    await dbRun(
      ctx.env.DB,
      `INSERT INTO webhook_endpoints (id, account_id, target_url, events_json, secret, active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      webhook.id,
      webhook.accountId,
      webhook.targetUrl,
      JSON.stringify(webhook.events),
      webhook.secret,
      webhook.createdAtMs,
    );
  }
  return json(
    { id: webhook.id, targetUrl: webhook.targetUrl, events: webhook.events, secret: webhook.secret, active: true },
    { status: 201 },
  );
}

async function listWebhooksRoute(request: Request, ctx: RequestContext): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  if (!ctx.env.DB) {
    return json({
      entries: [...getMemoryState().webhooks.values()]
        .filter((webhook) => webhook.accountId === account.id)
        .map((webhook) => ({
          id: webhook.id,
          targetUrl: webhook.targetUrl,
          events: webhook.events,
          active: webhook.active,
        })),
    });
  }
  const rows = await dbAll<{ id: string; target_url: string; events_json: string; active: number }>(
    ctx.env.DB,
    `SELECT id, target_url, events_json, active
       FROM webhook_endpoints
      WHERE account_id = ?
      ORDER BY created_at DESC`,
    account.id,
  );
  return json({
    entries: rows.map((row) => ({
      id: row.id,
      targetUrl: row.target_url,
      events: JSON.parse(row.events_json) as string[],
      active: rowBoolean(row.active),
    })),
  });
}

async function deleteWebhookRoute(request: Request, ctx: RequestContext, webhookId: string): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  if (!ctx.env.DB) {
    const webhook = getMemoryState().webhooks.get(webhookId);
    if (!webhook || webhook.accountId !== account.id) {
      notFound("Webhook not found");
    }
    getMemoryState().webhooks.delete(webhookId);
    return json({ ok: true });
  }
  const result = await dbRun(
    ctx.env.DB,
    `DELETE FROM webhook_endpoints
      WHERE id = ?
        AND account_id = ?`,
    webhookId,
    account.id,
  );
  if ((result.meta?.changes ?? 0) !== 1) {
    notFound("Webhook not found");
  }
  return json({ ok: true });
}

async function testWebhookRoute(request: Request, ctx: RequestContext, webhookId: string): Promise<Response> {
  const account = await getAuthedAccount(request, ctx);
  if (!account) {
    unauthorized();
  }
  if (!ctx.env.DB) {
    const webhook = getMemoryState().webhooks.get(webhookId);
    if (!webhook || webhook.accountId !== account.id || !webhook.active) {
      notFound("Webhook not found");
    }
    const status = await deliverWebhookTest(webhook);
    return json({ ok: true, status });
  }
  const row = await dbFirst<{ id: string; account_id: string; target_url: string; secret: string }>(
    ctx.env.DB,
    `SELECT id, account_id, target_url, secret
       FROM webhook_endpoints
      WHERE id = ?
        AND account_id = ?
        AND active = 1`,
    webhookId,
    account.id,
  );
  if (!row) {
    notFound("Webhook not found");
  }
  const status = await deliverWebhookTest({
    id: row.id,
    accountId: row.account_id,
    targetUrl: row.target_url,
    secret: row.secret,
  });
  return json({ ok: true, status });
}

async function handlePrivacyAnalytics(
  request: Request,
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<Response> {
  const event = body.event;
  const page = body.page == null ? null : parseString(body.page, { min: 1, max: 32 });
  const mode = body.mode == null ? null : body.mode;
  const theme = body.theme == null ? null : body.theme;
  const consentVersion =
    body.consentVersion == null ? null : parseInteger(body.consentVersion, { min: 1, max: 20 });
  const telemetry = isRecord(body.telemetry) ? body.telemetry : null;
  const viewportBucket =
    telemetry?.viewportBucket == null ? null : parseString(telemetry.viewportBucket, { min: 2, max: 2 });
  const reducedMotion =
    telemetry?.reducedMotion == null ? null : parseBoolean(telemetry.reducedMotion);
  const doNotTrack = telemetry?.doNotTrack == null ? false : parseBoolean(telemetry.doNotTrack);

  if (
    event !== "page_view" &&
    event !== "mode_select" &&
    event !== "run_start" &&
    event !== "run_finish" &&
    event !== "auth_register" &&
    event !== "auth_login" &&
    event !== "consent_update"
  ) {
    badRequest("Invalid analytics payload");
  }
  if (mode != null && !isMode(mode)) {
    badRequest("Invalid analytics payload");
  }
  if (theme != null && theme !== "dark" && theme !== "light") {
    badRequest("Invalid analytics payload");
  }
  if (
    viewportBucket != null &&
    viewportBucket !== "sm" &&
    viewportBucket !== "md" &&
    viewportBucket !== "lg" &&
    viewportBucket !== "xl"
  ) {
    badRequest("Invalid analytics payload");
  }
  if (doNotTrack) {
    return json({ ok: true, skipped: true }, { status: 202 });
  }

  const dateKey = new Date(ctx.nowMs).toISOString().slice(0, 10);
  const dimensionKey = [
    dateKey,
    event,
    page ?? "",
    mode ?? "",
    theme ?? "",
    viewportBucket ?? "",
    reducedMotion == null ? "" : String(reducedMotion),
    consentVersion == null ? "" : String(consentVersion),
  ].join("|");

  await upsertAnalyticsAggregate(ctx, {
    dimensionKey,
    dateKey,
    eventName: event,
    page,
    mode,
    theme,
    viewportBucket: viewportBucket as ViewportBucket | null,
    reducedMotion,
    consentVersion,
  });
  return json({ ok: true }, { status: 202 });
}

function parseScorePayload(body: Record<string, unknown>): {
  sessionId: string;
  mode: Mode;
  username: string;
  wpm: number;
  raw: number;
  accuracy: number;
  errors: number;
  streak: number;
  durationMs: number;
  certified: boolean;
  clientVersion: string | null;
  telemetry: Record<string, unknown> | null;
} {
  const sessionId = parseString(body.sessionId, { min: 36, max: 64 });
  const mode = body.mode;
  const username = parseString(body.username, { min: 2, max: 24 });
  const clientVersion =
    body.clientVersion == null ? null : parseString(body.clientVersion, { max: 64 });
  const telemetry = body.telemetry == null ? null : body.telemetry;
  if (!isMode(mode) || !usernameMeetsPolicy(username)) {
    badRequest("Invalid score payload");
  }
  if (telemetry != null && !isRecord(telemetry)) {
    badRequest("Invalid score payload");
  }
  return {
    sessionId,
    mode,
    username: normalizeUsername(username),
    wpm: parseFiniteNumber(body.wpm, { min: 0, max: 400 }),
    raw: parseFiniteNumber(body.raw, { min: 0, max: 500 }),
    accuracy: parseFiniteNumber(body.accuracy, { min: 0, max: 100 }),
    errors: parseInteger(body.errors, { min: 0, max: 5000 }),
    streak: parseInteger(body.streak, { min: 0, max: 5000 }),
    durationMs: parseInteger(body.durationMs, { min: 5000, max: 7_200_000 }),
    certified: parseBoolean(body.certified, false),
    clientVersion,
    telemetry: telemetry as Record<string, unknown> | null,
  };
}

function parseTelemetry(
  value: Record<string, unknown> | null,
): {
  typedChars: number;
  correctChars: number;
  wrongChars: number;
  avgKeyIntervalMs: number;
  burstKps: number;
  idleRatio: number;
  timelineHash?: string;
} | undefined {
  if (!value) {
    return undefined;
  }
  const telemetry = {
    typedChars: parseInteger(value.typedChars, { min: 0, max: 50_000 }),
    correctChars: parseInteger(value.correctChars, { min: 0, max: 50_000 }),
    wrongChars: parseInteger(value.wrongChars, { min: 0, max: 50_000 }),
    avgKeyIntervalMs: parseFiniteNumber(value.avgKeyIntervalMs, { min: 1, max: 2000 }),
    burstKps: parseFiniteNumber(value.burstKps, { min: 0, max: 100 }),
    idleRatio: parseFiniteNumber(value.idleRatio, { min: 0, max: 1 }),
  } as {
    typedChars: number;
    correctChars: number;
    wrongChars: number;
    avgKeyIntervalMs: number;
    burstKps: number;
    idleRatio: number;
    timelineHash?: string;
  };
  if (value.timelineHash != null) {
    telemetry.timelineHash = parseString(value.timelineHash, { min: 64, max: 64 });
  }
  return telemetry;
}

async function submitLeaderboardScore(
  request: Request,
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<Response> {
  const payload = parseScorePayload(body);
  const authToken = extractBearerToken(request.headers.get("authorization"));
  if (!authToken) {
    unauthorized("Missing bearer token");
  }
  const account = await getScoreAccount(request, ctx);
  assertScoreAccountCanUsePayload(account, payload);
  const verified = await verifySessionToken(authToken, ctx.secret);
  if (!verified || verified.sid !== payload.sessionId || verified.mode !== payload.mode) {
    unauthorized("Invalid or expired session token");
  }
  const telemetry = parseTelemetry(payload.telemetry);
  const { telemetry: _rawTelemetry, ...scorePayload } = payload;
  if (!isReasonableScore({ ...scorePayload, ...(telemetry ? { telemetry } : {}) })) {
    unprocessable("Score rejected by anti-cheat checks");
  }
  if (payload.certified) {
    if (!telemetry) {
      unprocessable("Certified runs require telemetry");
    }
    if (
      payload.durationMs < 30_000 ||
      payload.accuracy < 85 ||
      telemetry.avgKeyIntervalMs < 20 ||
      telemetry.burstKps > 20 ||
      telemetry.idleRatio > 0.85
    ) {
      unprocessable("Certified run rejected by strict validation");
    }
  }
  const fingerprint = await getFingerprint(request, ctx.secret);
  await consumeGameplaySession(ctx, payload.sessionId, payload.mode, fingerprint);
  const scoreId = randomId();

	  if (!ctx.env.DB) {
	    const memory = getMemoryState();
	    const entry: MemoryLeaderboardScore = {
	      id: scoreId,
	      sessionId: payload.sessionId,
	      accountId: account?.id ?? null,
	      username: account?.handle ?? payload.username,
	      mode: payload.mode,
      wpm: payload.wpm,
      raw: payload.raw,
      accuracy: payload.accuracy,
      errors: payload.errors,
      streak: payload.streak,
      durationMs: payload.durationMs,
      certified: payload.certified,
      clientVersion: payload.clientVersion,
      telemetry: telemetry ? ({ ...telemetry } as Record<string, unknown>) : null,
      createdAtMs: ctx.nowMs,
    };
    memory.leaderboardScores.push(entry);
  } else {
    await dbRun(
      ctx.env.DB,
      `INSERT INTO leaderboard_scores (
         id, session_id, account_id, username, mode, wpm, raw, accuracy, errors, streak, duration_ms, certified, client_version, telemetry_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      scoreId,
      payload.sessionId,
      account?.id ?? null,
      account?.handle ?? payload.username,
      payload.mode,
      payload.wpm,
      payload.raw,
      payload.accuracy,
      payload.errors,
      payload.streak,
      payload.durationMs,
      payload.certified ? 1 : 0,
      payload.clientVersion,
      telemetry ? JSON.stringify(telemetry) : null,
      ctx.nowMs,
    );
  }
  if (payload.certified) {
    if (!account) {
      unauthorized("Certified runs require sign in");
    }
    await incrementVerifiedRunsByAccountId(ctx, account.id);
  }
  return json({ ok: true }, { status: 201 });
}

async function submitChallengeScore(
  request: Request,
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<Response> {
  const payload = parseScorePayload(body);
  const challengeDate = parseString(body.challengeDate, { min: 10, max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(challengeDate)) {
    badRequest("Invalid challenge score payload");
  }
  const authToken = extractBearerToken(request.headers.get("authorization"));
  if (!authToken) {
    unauthorized("Missing bearer token");
  }
  const account = await getScoreAccount(request, ctx);
  assertScoreAccountCanUsePayload(account, payload);
  const verified = await verifySessionToken(authToken, ctx.secret);
  if (!verified || verified.sid !== payload.sessionId || verified.mode !== payload.mode) {
    unauthorized("Invalid or expired session token");
  }
  const telemetry = parseTelemetry(payload.telemetry);
  const { telemetry: _rawTelemetry, ...scorePayload } = payload;
  if (!isReasonableScore({ ...scorePayload, ...(telemetry ? { telemetry } : {}) })) {
    unprocessable("Score rejected by anti-cheat checks");
  }
  const challenge = getDailyChallenge(new Date(`${challengeDate}T12:00:00.000Z`));
  const todaysChallenge = getDailyChallenge(new Date(ctx.nowMs));
  if (challengeDate !== todaysChallenge.date) {
    unprocessable("Challenge date does not match today's challenge");
  }
  if (payload.mode !== challenge.mode) {
    unprocessable("Score mode does not match today's challenge mode");
  }
  if (Math.abs(payload.durationMs - challenge.durationSec * 1000) > 15_000) {
    unprocessable("Score duration does not match today's challenge duration");
  }
  const fingerprint = await getFingerprint(request, ctx.secret);
  await consumeGameplaySession(ctx, payload.sessionId, payload.mode, fingerprint);
  const scoreId = randomId();
  const season = getSeasonWindow(new Date(`${challengeDate}T12:00:00.000Z`));
  const points = pointsForChallengeScore(payload);

	  if (!ctx.env.DB) {
	    const memory = getMemoryState();
	    const entry: MemoryChallengeScore = {
	      id: scoreId,
	      sessionId: payload.sessionId,
	      accountId: account?.id ?? null,
	      challengeDate,
	      seasonId: season.id,
	      username: account?.handle ?? payload.username,
	      mode: payload.mode,
      points,
      wpm: payload.wpm,
      raw: payload.raw,
      accuracy: payload.accuracy,
      errors: payload.errors,
      streak: payload.streak,
      durationMs: payload.durationMs,
      createdAtMs: ctx.nowMs,
    };
    memory.challengeScores.push(entry);
  } else {
    await dbRun(
      ctx.env.DB,
      `INSERT INTO challenge_scores (
         id, session_id, account_id, challenge_date, season_id, username, mode, points, wpm, raw, accuracy, errors, streak, duration_ms, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      scoreId,
      payload.sessionId,
      account?.id ?? null,
      challengeDate,
      season.id,
      account?.handle ?? payload.username,
      payload.mode,
      points,
      payload.wpm,
      payload.raw,
      payload.accuracy,
      payload.errors,
      payload.streak,
      payload.durationMs,
      ctx.nowMs,
    );
  }
  return json({ ok: true, points }, { status: 201 });
}

export async function handleApiRequest(request: Request, path: string[], env: RuntimeEnv): Promise<Response> {
  const ctx = getRuntimeContext(env);
  const joinedPath = path.join("/");

  try {
    if (path.length === 2 && path[0] === "session" && path[1] === "init" && request.method === "POST") {
      await enforceRateLimit(request, ctx, { key: "session-init", limit: 120, windowSec: 60 });
      const body = await readJson(request);
      const mode = body.mode;
      if (!isMode(mode)) {
        badRequest("Invalid session request");
      }
      const fingerprint = await getFingerprint(request, ctx.secret);
      return json(await createGameplaySession(ctx, mode, fingerprint), { status: 201 });
    }

    if (path.length === 1 && path[0] === "leaderboard" && request.method === "GET") {
      const url = new URL(request.url);
      const mode = url.searchParams.get("mode") ?? "time";
      if (!isMode(mode)) {
        badRequest("Invalid leaderboard query");
      }
      const limit = parseInteger(url.searchParams.get("limit") ?? "20", { min: 1, max: 100 });
      const certifiedOnly = parseBoolean(url.searchParams.get("certifiedOnly"), false);
      const entries = await listLeaderboard(ctx, mode, limit, certifiedOnly);
      return json({ mode, certifiedOnly, entries });
    }

    if (path.length === 2 && path[0] === "leaderboard" && path[1] === "submit" && request.method === "POST") {
      await enforceRateLimit(request, ctx, { key: "score-submit", limit: 80, windowSec: 60 });
      return await submitLeaderboardScore(request, ctx, await readJson(request));
    }

    if (path.length === 2 && path[0] === "challenge" && path[1] === "daily" && request.method === "GET") {
      const challenge = getDailyChallenge(new Date(ctx.nowMs));
      return json({ challenge, season: getSeasonWindow(new Date(ctx.nowMs)) });
    }

    if (path.length === 2 && path[0] === "challenge" && path[1] === "submit" && request.method === "POST") {
      await enforceRateLimit(request, ctx, { key: "challenge-submit", limit: 40, windowSec: 60 });
      return await submitChallengeScore(request, ctx, await readJson(request));
    }

    if (path.length === 2 && path[0] === "challenge" && path[1] === "leaderboard" && request.method === "GET") {
      const url = new URL(request.url);
      const challengeDate = url.searchParams.get("date") ?? getDailyChallenge(new Date(ctx.nowMs)).date;
      const limit = parseInteger(url.searchParams.get("limit") ?? "20", { min: 1, max: 100 });
      return json({
        date: challengeDate,
        entries: await listChallengeLeaderboard(ctx, challengeDate, limit),
      });
    }

    if (path.length === 2 && path[0] === "season" && path[1] === "current" && request.method === "GET") {
      const season = getSeasonWindow(new Date(ctx.nowMs));
      const challenge = getDailyChallenge(new Date(ctx.nowMs));
      return json({ season, challengeDate: challenge.date });
    }

    if (path.length === 2 && path[0] === "season" && path[1] === "leaderboard" && request.method === "GET") {
      const url = new URL(request.url);
      const season = url.searchParams.get("seasonId")
        ? parseSeasonId(url.searchParams.get("seasonId") ?? "")
        : getSeasonWindow(new Date(ctx.nowMs));
      const limit = parseInteger(url.searchParams.get("limit") ?? "25", { min: 1, max: 100 });
      return json({ season, entries: await listSeasonLeaderboard(ctx, season, limit) });
    }

    if (path.length === 2 && path[0] === "account" && path[1] === "register" && request.method === "POST") {
      await enforceRateLimit(request, ctx, { key: "account-register", limit: 8, windowSec: 300 });
      return await registerAccount(request, ctx, await readJson(request));
    }

    if (path.length === 2 && path[0] === "account" && path[1] === "login" && request.method === "POST") {
      await enforceRateLimit(request, ctx, { key: "account-login", limit: 20, windowSec: 300 });
      return await loginAccount(request, ctx, await readJson(request));
    }

    if (path.length === 2 && path[0] === "account" && path[1] === "me" && request.method === "GET") {
      return await getAccountProfile(request, ctx);
    }

    if (path.length === 2 && path[0] === "account" && path[1] === "preferences" && request.method === "PUT") {
      return await updatePreferences(request, ctx, await readJson(request));
    }

    if (path.length === 2 && path[0] === "account" && path[1] === "sessions" && request.method === "GET") {
      return await listAccountSessions(request, ctx);
    }

    if (path.length === 3 && path[0] === "account" && path[1] === "sessions" && request.method === "DELETE") {
      return await revokeSession(request, ctx, decodeURIComponent(path[2] ?? ""));
    }

    if (path.length === 2 && path[0] === "account" && path[1] === "logout" && request.method === "POST") {
      return await logoutCurrent(request, ctx);
    }

    if (path.length === 2 && path[0] === "account" && path[1] === "logout-others" && request.method === "POST") {
      return await logoutOthers(request, ctx);
    }

    if (path.length === 2 && path[0] === "account" && path[1] === "password" && request.method === "POST") {
      return await changePassword(request, ctx, await readJson(request));
    }

    if (path.length === 2 && path[0] === "account" && path[1] === "export" && request.method === "GET") {
      return await exportAccount(request, ctx);
    }

    if (path.length === 1 && path[0] === "account" && request.method === "DELETE") {
      return await deleteAccount(request, ctx, await readJson(request));
    }

    if (path.length === 2 && path[0] === "admin" && path[1] === "users" && request.method === "GET") {
      return await listAdminUsers(request, ctx);
    }

    if (path.length === 3 && path[0] === "admin" && path[1] === "users" && request.method === "DELETE") {
      return await deleteAdminUser(request, ctx, decodeURIComponent(path[2] ?? ""), await readJson(request));
    }

    if (path.length === 2 && path[0] === "admin" && path[1] === "leaderboard" && request.method === "GET") {
      return await listAdminLeaderboard(request, ctx);
    }

    if (path.length === 3 && path[0] === "admin" && path[1] === "leaderboard" && request.method === "DELETE") {
      return await deleteAdminLeaderboardScore(request, ctx, decodeURIComponent(path[2] ?? ""));
    }

    if (path.length === 2 && path[0] === "admin" && path[1] === "seed-bots" && request.method === "POST") {
      return await seedBotLeaderboard(request, ctx, await readJson(request));
    }

    if (path.length === 2 && path[0] === "replay" && path[1] === "share" && request.method === "POST") {
      return await shareReplay(request, ctx, await readJson(request));
    }

    if (path.length === 3 && path[0] === "replay" && path[1] === "share" && request.method === "GET") {
      return await getReplayShare(ctx, decodeURIComponent(path[2] ?? ""));
    }

    if (path.length === 2 && path[0] === "replay" && path[1] === "share" && request.method === "GET") {
      return await listReplayShares(request, ctx);
    }

    if (path.length === 2 && path[0] === "privacy" && path[1] === "analytics" && request.method === "POST") {
      await enforceRateLimit(request, ctx, { key: "analytics", limit: 180, windowSec: 60 });
      return await handlePrivacyAnalytics(request, ctx, await readJson(request));
    }

    if (
      path.length === 3 &&
      path[0] === "privacy" &&
      path[1] === "analytics" &&
      path[2] === "summary" &&
      request.method === "GET"
    ) {
      if (!authorizeAnalyticsSummary(request, ctx)) {
        unauthorized("Unauthorized analytics summary access");
      }
      const url = new URL(request.url);
      const days = parseInteger(url.searchParams.get("days") ?? "14", { min: 1, max: 90 });
      const summary = await listAnalyticsSummary(ctx, days);
      return json({ days, totals: summary.totals, rows: summary.rows });
    }

    if (joinedPath === "friends/list" && request.method === "GET") {
      return await listFriends(request, ctx);
    }

    if (joinedPath === "friends/request" && request.method === "POST") {
      return await requestFriend(request, ctx, await readJson(request));
    }

    if (joinedPath === "friends/respond" && request.method === "POST") {
      return await respondFriend(request, ctx, await readJson(request));
    }

    if (joinedPath === "matchmaking/ranked/status" && request.method === "GET") {
      return await rankedStatusRoute(request, ctx);
    }

    if (joinedPath === "matchmaking/ranked/enqueue" && request.method === "POST") {
      return await enqueueRankedRoute(request, ctx);
    }

    if (joinedPath === "duel/queue" && request.method === "POST") {
      return await enqueueCasualDuelRoute(request, ctx);
    }

    if (joinedPath === "duel/state" && request.method === "GET") {
      return await duelStateRoute(request, ctx);
    }

    if (joinedPath === "duel/update" && request.method === "POST") {
      return await updateDuelRoute(request, ctx, await readJson(request));
    }

    if (joinedPath === "webhooks/list" && request.method === "GET") {
      return await listWebhooksRoute(request, ctx);
    }

    if (joinedPath === "webhooks/register" && request.method === "POST") {
      return await createWebhookRoute(request, ctx, await readJson(request));
    }

    if (path.length === 2 && path[0] === "webhooks" && request.method === "DELETE") {
      return await deleteWebhookRoute(request, ctx, decodeURIComponent(path[1] ?? ""));
    }

    if (path.length === 3 && path[0] === "webhooks" && path[1] === "test" && request.method === "POST") {
      return await testWebhookRoute(request, ctx, decodeURIComponent(path[2] ?? ""));
    }

    if (joinedPath === "race/create" && request.method === "POST") {
      return await createRace(request, ctx, await readJson(request));
    }

    if (joinedPath === "race/join" && request.method === "POST") {
      return await joinRace(ctx, await readJson(request));
    }

    if (joinedPath === "race/start" && request.method === "POST") {
      return await startRace(ctx, await readJson(request));
    }

    if (joinedPath === "race/update" && request.method === "POST") {
      return await updateRace(ctx, await readJson(request));
    }

    if (joinedPath === "race/state" && request.method === "GET") {
      return await raceState(request, ctx);
    }

    if (joinedPath === "tournament/create" && request.method === "POST") {
      return await createTournamentRoute(ctx, await readJson(request));
    }

    if (joinedPath === "tournament/report" && request.method === "POST") {
      return await reportTournament(ctx, await readJson(request));
    }

    if (joinedPath === "tournament/state" && request.method === "GET") {
      return await tournamentState(request, ctx);
    }

    notFound("Endpoint not found");
  } catch (error) {
    logRouteError(request, joinedPath, error);
    if (error instanceof HttpError) {
      return json({ error: error.message }, { status: error.status });
    }
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
