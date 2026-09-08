import cors from "cors";
import express, { type Request, type Response, type NextFunction } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import helmet from "helmet";
import crypto from "node:crypto";
import pino from "pino";
import pinoHttp from "pino-http";
import { config } from "./config.js";
import { isDatabaseOnline } from "./db/state.js";
import { leaderboardRouter } from "./routes/leaderboard.js";
import { liveRouter } from "./routes/live.js";
import { challengeRouter } from "./routes/challenge.js";
import { platformRouter } from "./routes/platform.js";
import { privacyRouter } from "./routes/privacy.js";
import { extractBearerToken, hashClientValue, safeTokenCompare } from "./lib/security.js";
import { recordHttpRequest, renderPrometheusMetrics } from "./lib/metrics.js";

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const createHttpLogger = pinoHttp as unknown as typeof import("pino-http").default;

function rateLimitKey(req: Request): string {
  // Normalize IPv6 and forwarded IP handling the way express-rate-limit expects.
  const ip = ipKeyGenerator(req.ip ?? "0.0.0.0");
  return hashClientValue(ip);
}

function isSecureRequest(req: Request): boolean {
  const host = (req.hostname || req.get("host") || "").split(":")[0]?.trim().toLowerCase();
  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]";
  if (config.NODE_ENV !== "production" && isLoopback) {
    return true;
  }
  if (req.secure) {
    return true;
  }
  const forwardedProto = req.get("x-forwarded-proto");
  if (!forwardedProto) {
    return false;
  }
  const primaryProto = forwardedProto.split(",")[0]?.trim().toLowerCase();
  return primaryProto === "https";
}

export function createApp(logger: pino.Logger) {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxyHops);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          baseUri: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: "same-site" },
      hsts:
        config.NODE_ENV === "production"
          ? { maxAge: 31536000, includeSubDomains: true, preload: true }
          : false,
      referrerPolicy: { policy: "no-referrer" },
      noSniff: true,
    }),
  );

  app.use((_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
    );
    next();
  });

  app.use((req, res, next) => {
    if (!allowedMethods.has(req.method.toUpperCase())) {
      return res.status(405).json({ error: "Method not allowed" });
    }
    return next();
  });

  app.use((req, res, next) => {
    if (config.enforceHttps && !isSecureRequest(req)) {
      return res.status(426).json({ error: "HTTPS is required" });
    }
    return next();
  });

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          return callback(null, true);
        }
        if (config.corsOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error("Origin not allowed by CORS"));
      },
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Metrics-Token"],
      maxAge: 86_400,
      credentials: false,
    }),
  );

  app.use((req, res, next) => {
    if (!mutationMethods.has(req.method)) {
      return next();
    }
    if (!req.is(["application/json", "application/*+json"])) {
      return res.status(415).json({ error: "Only JSON request bodies are accepted" });
    }
    if (config.strictMutationOrigin) {
      const origin = req.get("origin");
      if (origin && !config.corsOrigins.includes(origin)) {
        return res.status(403).json({ error: "Origin not allowed" });
      }
    }
    return next();
  });

  app.use(express.json({ limit: config.MAX_JSON_BODY, strict: true, type: ["application/json", "application/*+json"] }));
  app.use((req, res, next) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return next();
    }
    const bodyRecord = req.body as Record<string, unknown>;
    if (
      Object.hasOwn(bodyRecord, "__proto__") ||
      Object.hasOwn(bodyRecord, "prototype") ||
      Object.hasOwn(bodyRecord, "constructor")
    ) {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }
    return next();
  });
  app.use(
    createHttpLogger({
      logger,
      genReqId: (req) => {
        const requestId = req.headers["x-request-id"];
        return typeof requestId === "string" ? requestId : crypto.randomUUID();
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    }),
  );

  app.use((req, res, next) => {
    const requestId = (req as { id?: string }).id;
    if (requestId) {
      res.setHeader("x-request-id", requestId);
    }
    if (req.path.startsWith("/api/")) {
      res.setHeader("cache-control", "no-store");
    }
    next();
  });

  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      const elapsedNs = Number(process.hrtime.bigint() - startedAt);
      const durationMs = elapsedNs / 1_000_000;
      const route = req.originalUrl.split("?")[0] ?? req.path;
      recordHttpRequest({
        method: req.method,
        route,
        status: res.statusCode,
        durationMs,
      });
    });
    next();
  });

  const globalLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.NODE_ENV === "production" ? 120 : 240,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: rateLimitKey,
  });

  const sessionInitLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.NODE_ENV === "production" ? 25 : 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: rateLimitKey,
  });

  const submitLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.NODE_ENV === "production" ? 18 : 50,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: rateLimitKey,
  });

  const raceUpdateLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.NODE_ENV === "production" ? 300 : 600,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: rateLimitKey,
  });

  const metricsLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.NODE_ENV === "production" ? 20 : 80,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: rateLimitKey,
  });

  app.use("/api", globalLimiter);
  app.use("/api/v1/session/init", sessionInitLimiter);
  app.use("/api/v1/leaderboard/submit", submitLimiter);
  app.use("/api/v1/challenge/submit", submitLimiter);
  app.use("/api/v1/race/update", raceUpdateLimiter);
  app.use("/api/metrics", metricsLimiter);

  app.get("/api/health/live", (_req, res) => {
    res.json({ ok: true, uptimeSec: process.uptime(), service: "typeshift-api" });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, uptimeSec: process.uptime(), service: "typeshift-api" });
  });

  app.get("/api/health/ready", (_req, res) => {
    if (config.NODE_ENV === "production" && config.requireDatabaseInProd && !isDatabaseOnline()) {
      return res.status(503).json({ ok: false, ready: false, dbOnline: false });
    }
    return res.json({ ok: true, ready: true, dbOnline: isDatabaseOnline() });
  });

  app.get("/api/metrics", (req, res) => {
    if (!config.METRICS_ENABLED) {
      return res.status(404).json({ error: "Metrics disabled" });
    }
    if (config.METRICS_TOKEN) {
      const headerToken = req.get("x-metrics-token");
      const bearerToken = extractBearerToken(req.get("authorization"));
      const token = headerToken ?? bearerToken ?? "";
      if (!safeTokenCompare(config.METRICS_TOKEN, token)) {
        return res.status(401).json({ error: "Unauthorized metrics access" });
      }
    }
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return res.send(renderPrometheusMetrics());
  });

  app.use("/api/v1", leaderboardRouter);
  app.use("/api/v1", liveRouter);
  app.use("/api/v1", challengeRouter);
  app.use("/api/v1", platformRouter);
  app.use("/api/v1", privacyRouter);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const syntaxErrorStatus =
      error instanceof SyntaxError
        ? (error as SyntaxError & { status?: unknown }).status
        : undefined;
    if (
      error instanceof SyntaxError &&
      typeof syntaxErrorStatus === "number" &&
      syntaxErrorStatus === 400
    ) {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
    if (error instanceof Error && error.message === "Origin not allowed by CORS") {
      return res.status(403).json({ error: "Origin not allowed" });
    }
    logger.error({ err: error }, "Unhandled server error");
    return res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
