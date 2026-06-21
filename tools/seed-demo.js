import { deleteSession, endSession, openDatabase, startSession } from "../apps/api/db.js";

const db = openDatabase();
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

const sessions = [
  {
    id: "demo-docs",
    url: "https://developer.mozilla.org/en-US/docs/Web/API",
    title: "MDN Web API documentation",
    startMinute: 9 * 60,
    endMinute: 9 * 60 + 42
  },
  {
    id: "demo-github",
    url: "https://github.com/iankengott/procrastinating-",
    title: "GitHub repository",
    startMinute: 10 * 60 + 5,
    endMinute: 10 * 60 + 48
  },
  {
    id: "demo-youtube",
    url: "https://www.youtube.com/watch?v=fnaf",
    title: "MatPat Five Nights Lore Explained",
    startMinute: 13 * 60 + 30,
    endMinute: 14 * 60 + 18
  },
  {
    id: "demo-reddit",
    url: "https://www.reddit.com/r/programming/",
    title: "r/programming",
    startMinute: 15 * 60,
    endMinute: 15 * 60 + 12
  }
];

for (const session of sessions) {
  deleteSession(db, session.id);
  startSession(db, {
    id: session.id,
    source: "demo_seed",
    url: session.url,
    title: session.title,
    start_at: atMinute(session.startMinute)
  });
  endSession(db, {
    id: session.id,
    end_at: atMinute(session.endMinute)
  });
}

console.log(`Seeded ${sessions.length} demo sessions for today.`);

function atMinute(minute) {
  return new Date(today.getTime() + minute * 60_000).toISOString();
}
