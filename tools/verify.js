import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deleteSession,
  endSession,
  exportSessions,
  getSession,
  listSessions,
  openDatabase,
  startSession,
  summarize,
  updateSessionCategory
} from "../apps/api/db.js";

const tempDir = mkdtempSync(join(tmpdir(), "procrastinating-"));
const db = openDatabase(join(tempDir, "verify.sqlite"));

try {
  verifySessionLifecycle();
  verifyMergeKeepsActiveDuration();
  verifyCorrectionsAndDelete();
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
