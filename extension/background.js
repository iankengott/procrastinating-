const API_BASE = "http://localhost:3847/api";
const HEARTBEAT_MS = 30_000;
const TRACKABLE_PROTOCOLS = ["http:", "https:"];

let currentSession = null;
let heartbeatTimer = null;
let paused = false;
let idleState = "active";
let apiOnline = null;
let lastApiError = null;

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ paused: false });
  chrome.idle.setDetectionInterval(60);
  await refreshPausedState();
  await activateCurrentTab("installed");
});

chrome.runtime.onStartup.addListener(async () => {
  await refreshPausedState();
  await activateCurrentTab("startup");
});

chrome.tabs.onActivated.addListener(async () => {
  await activateCurrentTab("tab activated");
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!currentSession || currentSession.tabId !== tabId) return;
  if (!changeInfo.url && !changeInfo.title) return;

  if (!isTrackable(tab)) {
    await endCurrentSession("tab became untrackable");
    return;
  }

  currentSession.url = tab.url;
  currentSession.title = tab.title || currentSession.title;
  await heartbeat();
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await endCurrentSession("browser unfocused");
    return;
  }

  await activateCurrentTab("window focused");
});

chrome.idle.onStateChanged.addListener(async (state) => {
  idleState = state;
  if (state === "active") {
    await activateCurrentTab("user active");
  } else {
    await endCurrentSession(`idle ${state}`);
  }
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "local" || !changes.paused) return;
  paused = Boolean(changes.paused.newValue);
  if (paused) {
    await endCurrentSession("paused");
  } else {
    await activateCurrentTab("resumed");
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "status") {
    sendResponse({ paused, currentSession, apiOnline, lastApiError });
    return true;
  }

  if (message?.type === "setPaused") {
    chrome.storage.local.set({ paused: Boolean(message.paused) }).then(() => {
      sendResponse({ paused: Boolean(message.paused) });
    });
    return true;
  }

  return false;
});

async function refreshPausedState() {
  const stored = await chrome.storage.local.get({ paused: false });
  paused = Boolean(stored.paused);
}

async function activateCurrentTab(reason) {
  await refreshPausedState();
  if (paused || idleState !== "active") return;

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!isTrackable(tab)) {
    await endCurrentSession("no trackable active tab");
    return;
  }

  if (currentSession?.tabId === tab.id && currentSession.url === tab.url) {
    currentSession.title = tab.title || currentSession.title;
    await heartbeat();
    return;
  }

  await endCurrentSession(reason);
  await startSession(tab);
}

async function startSession(tab) {
  const now = new Date().toISOString();
  currentSession = {
    id: crypto.randomUUID(),
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title || "",
    start_at: now
  };

  const saved = await post("/sessions/start", {
    id: currentSession.id,
    source: "chrome_extension",
    url: currentSession.url,
    title: currentSession.title,
    start_at: now,
    metadata: { tabId: tab.id, windowId: tab.windowId }
  });

  if (saved?.id) {
    currentSession.id = saved.id;
  }

  scheduleHeartbeat();
}

async function heartbeat() {
  if (!currentSession || paused) return;

  await post("/sessions/heartbeat", {
    id: currentSession.id,
    url: currentSession.url,
    title: currentSession.title,
    last_seen_at: new Date().toISOString()
  });
}

async function endCurrentSession(reason) {
  if (!currentSession) return;

  const session = currentSession;
  currentSession = null;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;

  await post("/sessions/end", {
    id: session.id,
    end_at: new Date().toISOString(),
    metadata: { reason }
  });
}

function scheduleHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
}

function isTrackable(tab) {
  if (!tab?.url || tab.incognito) return false;
  try {
    return TRACKABLE_PROTOCOLS.includes(new URL(tab.url).protocol);
  } catch {
    return false;
  }
}

async function post(path, body) {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      apiOnline = false;
      lastApiError = `API ${response.status}: ${text}`;
      console.warn("Attention tracker API error", response.status, text);
      return null;
    }

    apiOnline = true;
    lastApiError = null;
    return response.json();
  } catch (error) {
    apiOnline = false;
    lastApiError = error.message;
    console.warn("Attention tracker could not reach local API", error);
    return null;
  }
}
