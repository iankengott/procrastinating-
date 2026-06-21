import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { classifyActivity, normalizeCategory, parseUrl } from "./classifier.js";

const DEFAULT_DB_PATH = resolve(process.cwd(), "data/attention.sqlite");
const MERGE_WINDOW_SECONDS = 90;

export function openDatabase(dbPath = process.env.ATTENTION_DB_PATH || DEFAULT_DB_PATH) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      domain TEXT NOT NULL,
      path TEXT NOT NULL,
      site_section TEXT NOT NULL,
      category TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      classifier_reason TEXT,
      start_at TEXT NOT NULL,
      end_at TEXT,
      last_seen_at TEXT NOT NULL,
      active_started_at TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 0,
      backfilled INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(start_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_domain ON sessions(domain);
    CREATE INDEX IF NOT EXISTS idx_sessions_category ON sessions(category);
    CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(active);

    CREATE TABLE IF NOT EXISTS corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matcher_type TEXT NOT NULL,
      matcher_value TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_corrections_unique
      ON corrections(matcher_type, matcher_value);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tracking_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('allow', 'block')),
      note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_rules_unique
      ON tracking_rules(domain, action);
  `);

  ensureColumn(db, "sessions", "active_started_at", "TEXT");
  ensureSetting(db, "tracking_mode", "all");
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function getCorrections(db) {
  return db.prepare("SELECT matcher_type, matcher_value, category FROM corrections ORDER BY id DESC").all();
}

export function getSettings(db) {
  const settings = Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((row) => [row.key, row.value]));
  const trackingRules = db.prepare("SELECT id, domain, action, note, created_at FROM tracking_rules ORDER BY action, domain").all();
  return {
    tracking_mode: settings.tracking_mode || "all",
    tracking_rules: trackingRules,
    privacy: {
      storage: "local sqlite",
      incognito: "ignored by extension",
      remote_sync: "none",
      oauth: "not enabled"
    }
  };
}

export function updateSetting(db, key, value) {
  const allowed = new Map([["tracking_mode", new Set(["all", "allowlist"])]]);
  if (!allowed.has(key) || !allowed.get(key).has(value)) {
    throw new Error(`invalid setting ${key}`);
  }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, value, now);

  return getSettings(db);
}

export function addTrackingRule(db, { domain, action, note = "" }) {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) throw new Error("domain is required");
  if (!["allow", "block"].includes(action)) throw new Error("action must be allow or block");

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO tracking_rules (domain, action, note, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(domain, action) DO UPDATE SET
      note = excluded.note,
      created_at = excluded.created_at
  `).run(normalizedDomain, action, note, now);

  return getSettings(db);
}

export function deleteTrackingRule(db, id) {
  const result = db.prepare("DELETE FROM tracking_rules WHERE id = ?").run(id);
  return { deleted: result.changes };
}

export function startSession(db, payload) {
  const now = new Date().toISOString();
  const id = payload.id || crypto.randomUUID();
  const startAt = payload.start_at || now;
  const parsed = parseUrl(payload.url);
  if (!isDomainTrackable(db, parsed.domain)) {
    return {
      ignored: true,
      reason: "domain tracking rule",
      domain: parsed.domain
    };
  }

  const corrections = getCorrections(db);
  const classification = classifyActivity({ domain: parsed.domain, title: payload.title }, corrections);
  const mergeTarget = findMergeTarget(db, {
    source: payload.source || "browser_extension",
    url: payload.url,
    startAt
  });

  if (mergeTarget) {
    db.prepare(`
      UPDATE sessions
      SET title = ?,
        end_at = NULL,
        last_seen_at = ?,
        active_started_at = ?,
        active = 1,
        updated_at = ?
      WHERE id = ?
    `).run(payload.title || mergeTarget.title, startAt, startAt, now, mergeTarget.id);

    return getSession(db, mergeTarget.id);
  }

  db.prepare(`
    INSERT INTO sessions (
      id, source, url, title, domain, path, site_section, category, confidence,
      classifier_reason, start_at, last_seen_at, active_started_at, duration_seconds, active,
      backfilled, metadata_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      url = excluded.url,
      title = excluded.title,
      domain = excluded.domain,
      path = excluded.path,
      site_section = excluded.site_section,
      last_seen_at = excluded.last_seen_at,
      active_started_at = excluded.active_started_at,
      active = 1,
      updated_at = excluded.updated_at
  `).run(
    id,
    payload.source || "browser_extension",
    payload.url,
    payload.title || "",
    parsed.domain,
    parsed.path,
    parsed.siteSection,
    classification.category,
    classification.confidence,
    classification.reason,
    startAt,
    startAt,
    startAt,
    payload.backfilled ? 1 : 0,
    JSON.stringify(payload.metadata || {}),
    now,
    now
  );

  return getSession(db, id);
}

export function heartbeatSession(db, payload) {
  const now = payload.last_seen_at || new Date().toISOString();
  const existing = getSession(db, payload.id);
  if (!existing) return null;

  const parsed = payload.url ? parseUrl(payload.url) : existing;
  const title = payload.title ?? existing.title;
  const duration = activeDuration(existing, now);

  db.prepare(`
    UPDATE sessions
    SET url = COALESCE(?, url),
      title = COALESCE(?, title),
      domain = ?,
      path = ?,
      site_section = ?,
      last_seen_at = ?,
      duration_seconds = ?,
      active = 1,
      updated_at = ?
    WHERE id = ?
  `).run(
    payload.url || null,
    title,
    parsed.domain,
    parsed.path,
    parsed.siteSection,
    now,
    duration,
    new Date().toISOString(),
    payload.id
  );

  return getSession(db, payload.id);
}

export function endSession(db, payload) {
  const endAt = payload.end_at || new Date().toISOString();
  const existing = getSession(db, payload.id);
  if (!existing) return null;

  const duration = activeDuration(existing, endAt);
  db.prepare(`
    UPDATE sessions
    SET end_at = ?,
      last_seen_at = ?,
      active_started_at = NULL,
      duration_seconds = ?,
      active = 0,
      updated_at = ?
    WHERE id = ?
  `).run(endAt, endAt, duration, new Date().toISOString(), payload.id);

  return getSession(db, payload.id);
}

export function importBackfilledSession(db, payload) {
  const now = new Date().toISOString();
  const id = payload.id || crypto.randomUUID();
  const parsed = parseUrl(payload.url || "about:blank");
  const corrections = getCorrections(db);
  const classification = classifyActivity({ domain: parsed.domain, title: payload.title }, corrections);
  const category = normalizeCategory(payload.category) === "unknown" ? classification.category : normalizeCategory(payload.category);
  const startAt = payload.start_at || now;
  const endAt = payload.end_at || null;
  const duration = endAt ? durationSeconds(startAt, endAt) : Number(payload.duration_seconds || 0);

  db.prepare(`
    INSERT OR IGNORE INTO sessions (
      id, source, url, title, domain, path, site_section, category, confidence,
      classifier_reason, start_at, end_at, last_seen_at, duration_seconds,
      active, backfilled, metadata_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)
  `).run(
    id,
    payload.source || "backfill",
    payload.url || "about:blank",
    payload.title || "",
    parsed.domain,
    parsed.path,
    parsed.siteSection,
    category,
    payload.confidence ?? classification.confidence,
    payload.classifier_reason || classification.reason,
    startAt,
    endAt,
    endAt || startAt,
    duration,
    JSON.stringify(payload.metadata || {}),
    now,
    now
  );

  return getSession(db, id);
}

export function getSession(db, id) {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
}

export function listSessions(db, { from, to, limit = 100 } = {}) {
  const safeLimit = Math.min(Number(limit) || 100, 500);
  return db.prepare(`
    SELECT * FROM sessions
    WHERE start_at >= ? AND start_at < ?
    ORDER BY start_at DESC
    LIMIT ?
  `).all(from, to, safeLimit);
}

export function exportSessions(db, { from, to }) {
  return db.prepare(`
    SELECT id, source, url, title, domain, path, site_section, category, confidence,
      classifier_reason, start_at, end_at, last_seen_at, duration_seconds,
      active, backfilled, metadata_json, created_at, updated_at
    FROM sessions
    WHERE start_at >= ? AND start_at < ?
    ORDER BY start_at ASC
  `).all(from, to);
}

export function deleteSession(db, id) {
  const result = db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  return { deleted: result.changes };
}

export function deleteSessionsInRange(db, { from, to }) {
  const result = db.prepare(`
    DELETE FROM sessions
    WHERE start_at >= ? AND start_at < ?
  `).run(from, to);
  return { deleted: result.changes };
}

export function deleteSessionsForDomain(db, domain, { from, to } = {}) {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) return { deleted: 0 };

  if (from && to) {
    const result = db.prepare(`
      DELETE FROM sessions
      WHERE domain = ? AND start_at >= ? AND start_at < ?
    `).run(normalizedDomain, from, to);
    return { deleted: result.changes };
  }

  const result = db.prepare("DELETE FROM sessions WHERE domain = ?").run(normalizedDomain);
  return { deleted: result.changes };
}

export function updateSessionCategory(db, id, { category, scope = "session" }) {
  const normalized = normalizeCategory(category);
  const session = getSession(db, id);
  if (!session) return null;

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE sessions
    SET category = ?, confidence = 1, classifier_reason = 'user correction', updated_at = ?
    WHERE id = ?
  `).run(normalized, now, id);

  if (scope === "domain") {
    db.prepare(`
      INSERT INTO corrections (matcher_type, matcher_value, category, created_at)
      VALUES ('domain', ?, ?, ?)
      ON CONFLICT(matcher_type, matcher_value) DO UPDATE SET
        category = excluded.category,
        created_at = excluded.created_at
    `).run(session.domain, normalized, now);

    db.prepare(`
      UPDATE sessions
      SET category = ?, confidence = 1, classifier_reason = 'user domain correction', updated_at = ?
      WHERE domain = ?
    `).run(normalized, now, session.domain);
  }

  return getSession(db, id);
}

export function summarize(db, { from, to }) {
  const sessions = listSessions(db, { from, to, limit: 500 });
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS session_count,
      COALESCE(SUM(duration_seconds), 0) AS total_seconds
    FROM sessions
    WHERE start_at >= ? AND start_at < ?
  `).get(from, to);

  const byCategory = db.prepare(`
    SELECT category, COALESCE(SUM(duration_seconds), 0) AS seconds, COUNT(*) AS count
    FROM sessions
    WHERE start_at >= ? AND start_at < ?
    GROUP BY category
    ORDER BY seconds DESC
  `).all(from, to);

  const byDomain = db.prepare(`
    SELECT domain, COALESCE(SUM(duration_seconds), 0) AS seconds, COUNT(*) AS count
    FROM sessions
    WHERE start_at >= ? AND start_at < ?
    GROUP BY domain
    ORDER BY seconds DESC
    LIMIT 12
  `).all(from, to);

  return { from, to, totals, byCategory, byDomain, sessions };
}

function durationSeconds(start, end) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.round((endMs - startMs) / 1000));
}

function ensureSetting(db, key, value) {
  db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
  `).run(key, value, new Date().toISOString());
}

function isDomainTrackable(db, domain) {
  const settings = getSettings(db);
  const rules = settings.tracking_rules;
  if (rules.some((rule) => rule.action === "block" && domainMatches(domain, rule.domain))) return false;
  if (settings.tracking_mode === "allowlist") {
    return rules.some((rule) => rule.action === "allow" && domainMatches(domain, rule.domain));
  }
  return true;
}

function domainMatches(domain, ruleDomain) {
  return domain === ruleDomain || domain.endsWith(`.${ruleDomain}`);
}

function normalizeDomain(domain) {
  return String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

function activeDuration(session, activeUntil) {
  const base = Number(session.duration_seconds || 0);
  if (!session.active_started_at) return base;
  return base + durationSeconds(session.active_started_at, activeUntil);
}

function findMergeTarget(db, { source, url, startAt }) {
  const start = new Date(startAt);
  if (!Number.isFinite(start.getTime())) return null;

  const threshold = new Date(start.getTime() - MERGE_WINDOW_SECONDS * 1000).toISOString();
  return db.prepare(`
    SELECT *
    FROM sessions
    WHERE source = ?
      AND url = ?
      AND active = 0
      AND backfilled = 0
      AND end_at IS NOT NULL
      AND end_at >= ?
      AND end_at <= ?
    ORDER BY end_at DESC
    LIMIT 1
  `).get(source, url, threshold, startAt);
}
