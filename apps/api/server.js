import { createReadStream, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createServer } from "node:http";
import {
  openDatabase,
  deleteSession,
  deleteSessionsInRange,
  endSession,
  exportSessions,
  heartbeatSession,
  listSessions,
  startSession,
  summarize,
  updateSessionCategory
} from "./db.js";

const PORT = Number(process.env.PORT || 3847);
const DASHBOARD_DIR = resolve(process.cwd(), "apps/dashboard");
const db = openDatabase();

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

createServer(async (req, res) => {
  try {
    setCors(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/health") {
      sendJson(res, { ok: true, service: "attention-ledger", now: new Date().toISOString() });
      return;
    }

    if (url.pathname === "/api/sessions/start" && req.method === "POST") {
      sendJson(res, startSession(db, await readJson(req)), 201);
      return;
    }

    if (url.pathname === "/api/sessions/heartbeat" && req.method === "POST") {
      const session = heartbeatSession(db, await readJson(req));
      if (!session) return sendJson(res, { error: "session not found" }, 404);
      sendJson(res, session);
      return;
    }

    if (url.pathname === "/api/sessions/end" && req.method === "POST") {
      const session = endSession(db, await readJson(req));
      if (!session) return sendJson(res, { error: "session not found" }, 404);
      sendJson(res, session);
      return;
    }

    const categoryMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/category$/);
    if (categoryMatch && req.method === "PATCH") {
      const session = updateSessionCategory(db, decodeURIComponent(categoryMatch[1]), await readJson(req));
      if (!session) return sendJson(res, { error: "session not found" }, 404);
      sendJson(res, session);
      return;
    }

    if (url.pathname === "/api/sessions" && req.method === "GET") {
      const range = resolveRange(url.searchParams);
      sendJson(res, listSessions(db, { ...range, limit: url.searchParams.get("limit") || 100 }));
      return;
    }

    if (url.pathname === "/api/sessions" && req.method === "DELETE") {
      const range = resolveRange(url.searchParams);
      sendJson(res, deleteSessionsInRange(db, range));
      return;
    }

    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionMatch && req.method === "DELETE") {
      sendJson(res, deleteSession(db, decodeURIComponent(sessionMatch[1])));
      return;
    }

    if (url.pathname === "/api/summary" && req.method === "GET") {
      sendJson(res, summarize(db, resolveRange(url.searchParams)));
      return;
    }

    if (url.pathname === "/api/export" && req.method === "GET") {
      const range = resolveRange(url.searchParams);
      sendJson(res, {
        exported_at: new Date().toISOString(),
        ...range,
        sessions: exportSessions(db, range)
      });
      return;
    }

    serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, { error: error.message || "internal error" }, 500);
  }
}).listen(PORT, () => {
  console.log(`Attention dashboard: http://localhost:${PORT}`);
  console.log(`Chrome extension API: http://localhost:${PORT}/api`);
});

function resolveRange(searchParams) {
  const now = new Date();
  const range = searchParams.get("range") || "today";
  let from;

  if (searchParams.get("from")) {
    from = new Date(searchParams.get("from"));
  } else if (range === "last-hour") {
    from = new Date(now.getTime() - 60 * 60 * 1000);
  } else if (range === "week") {
    from = startOfLocalDay(now);
    from.setDate(from.getDate() - 6);
  } else if (range === "year") {
    from = new Date(now.getFullYear(), 0, 1);
  } else if (range === "since") {
    from = new Date(searchParams.get("since") || now);
  } else {
    from = startOfLocalDay(now);
  }

  const to = searchParams.get("to") ? new Date(searchParams.get("to")) : now;
  return { from: from.toISOString(), to: to.toISOString() };
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(join(DASHBOARD_DIR, safePath));
  if (!filePath.startsWith(DASHBOARD_DIR) || !existsSync(filePath)) {
    sendJson(res, { error: "not found" }, 404);
    return;
  }

  res.writeHead(200, { "Content-Type": CONTENT_TYPES[extname(filePath)] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, body, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}
