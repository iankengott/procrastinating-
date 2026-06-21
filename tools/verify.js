import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deleteSession,
  deleteSessionsForDomain,
  addTrackingRule,
  endSession,
  exportSessions,
  getSession,
  getSettings,
  importBackfilledSession,
  listSessions,
  openDatabase,
  startSession,
  summarize,
  updateSetting,
  updateSessionCategory
} from "../apps/api/db.js";
import { importTakeoutPath } from "./import-takeout.js";

const tempDir = mkdtempSync(join(tmpdir(), "procrastinating-"));
const db = openDatabase(join(tempDir, "verify.sqlite"));

try {
  verifySessionLifecycle();
  verifyMergeKeepsActiveDuration();
  verifyCorrectionsAndDelete();
  verifySettingsAndRules();
  verifyImporterFixture();
  console.log("All verification checks passed.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function verifySessionLifecycle() {
  startSession(db, {
    id: "github-docs",
    source: "verify",
    url: "https://github.com/iankengott/procrastinating-",
    title: "GitHub repo",
    start_at: "2026-06-21T12:00:00.000Z"
  });

  endSession(db, {
    id: "github-docs",
    end_at: "2026-06-21T12:10:00.000Z"
  });

  const session = getSession(db, "github-docs");
  assert(session.duration_seconds === 600, "session should track a 10 minute duration");
  assert(session.category === "functional", "github should classify as functional");
}

function verifyMergeKeepsActiveDuration() {
  startSession(db, {
    id: "youtube-1",
    source: "verify",
    url: "https://www.youtube.com/watch?v=fnaf",
    title: "MatPat Five Nights Lore Explained",
    start_at: "2026-06-21T13:00:00.000Z"
  });

  endSession(db, {
    id: "youtube-1",
    end_at: "2026-06-21T13:01:00.000Z"
  });

  const merged = startSession(db, {
    id: "youtube-2",
    source: "verify",
    url: "https://www.youtube.com/watch?v=fnaf",
    title: "MatPat Five Nights Lore Explained",
    start_at: "2026-06-21T13:01:30.000Z"
  });

  assert(merged.id === "youtube-1", "brief same-URL interruption should merge into original session");

  endSession(db, {
    id: "youtube-1",
    end_at: "2026-06-21T13:02:30.000Z"
  });

  const session = getSession(db, "youtube-1");
  assert(session.duration_seconds === 120, "merged duration should count active segments, not the interruption gap");
  assert(listSessions(db, {
    from: "2026-06-21T13:00:00.000Z",
    to: "2026-06-21T14:00:00.000Z"
  }).length === 1, "merged range should contain one session");
}

function verifyCorrectionsAndDelete() {
  updateSessionCategory(db, "youtube-1", { category: "functional", scope: "domain" });
  const corrected = getSession(db, "youtube-1");
  assert(corrected.category === "functional", "domain correction should update the session");

  const summary = summarize(db, {
    from: "2026-06-21T00:00:00.000Z",
    to: "2026-06-22T00:00:00.000Z"
  });
  assert(summary.totals.session_count === 2, "summary should include both remaining sessions");

  const exported = exportSessions(db, {
    from: "2026-06-21T00:00:00.000Z",
    to: "2026-06-22T00:00:00.000Z"
  });
  assert(exported.length === 2, "export should include sessions in range");

  const result = deleteSession(db, "youtube-1");
  assert(result.deleted === 1, "delete should remove one session");
}

function verifySettingsAndRules() {
  updateSetting(db, "tracking_mode", "all");
  addTrackingRule(db, { domain: "blocked.example", action: "block" });
  const ignored = startSession(db, {
    id: "blocked-domain",
    source: "verify",
    url: "https://blocked.example/watch",
    title: "Should not track",
    start_at: "2026-06-21T16:00:00.000Z"
  });

  assert(ignored.ignored === true, "blocked domain should be ignored");

  const deleted = deleteSessionsForDomain(db, "github.com");
  assert(deleted.deleted === 1, "delete by domain should remove github session");

  const settings = getSettings(db);
  assert(settings.tracking_rules.some((rule) => rule.domain === "blocked.example"), "settings should expose tracking rules");
}

function verifyImporterFixture() {
  const result = importTakeoutPath("tests/fixtures/takeout", db);
  assert(result.imported === 4, "fixture importer should import four valid rows");
  assert(result.skipped === 1, "fixture importer should skip one invalid row");

  importBackfilledSession(db, {
    id: "manual-backfill",
    source: "verify_backfill",
    url: "https://example.com/manual",
    title: "Manual backfill",
    start_at: "2026-06-21T17:00:00.000Z"
  });

  const summary = summarize(db, {
    from: "2026-06-21T00:00:00.000Z",
    to: "2026-06-22T00:00:00.000Z"
  });
  assert(summary.sessions.some((session) => session.backfilled === 1), "summary should include backfilled sessions");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
