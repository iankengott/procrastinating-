const state = {
  range: "today",
  since: null,
  summary: null,
  settings: null
};

const setupPanel = document.querySelector("#setup-panel");
const dismissSetupButton = document.querySelector("#dismiss-setup");
const rangeButtons = [...document.querySelectorAll(".range")];
const sinceForm = document.querySelector("#since-form");
const exportJsonButton = document.querySelector("#export-json");
const deleteRangeButton = document.querySelector("#delete-range");
const trackingModeForm = document.querySelector("#tracking-mode-form");
const trackingModeSelect = document.querySelector("#tracking-mode");
const ruleForm = document.querySelector("#rule-form");
const ruleDomainInput = document.querySelector("#rule-domain");
const ruleActionSelect = document.querySelector("#rule-action");
const trackingRulesEl = document.querySelector("#tracking-rules");
const privacySummaryEl = document.querySelector("#privacy-summary");
const healthEl = document.querySelector("#health");
const totalTimeEl = document.querySelector("#total-time");
const sessionCountEl = document.querySelector("#session-count");
const topCategoryEl = document.querySelector("#top-category");
const categoriesEl = document.querySelector("#categories");
const domainsEl = document.querySelector("#domains");
const sessionsEl = document.querySelector("#sessions");
const rangeLabelEl = document.querySelector("#range-label");
const barTemplate = document.querySelector("#bar-template");
const sessionTemplate = document.querySelector("#session-template");

if (localStorage.getItem("setupDismissed") === "true") {
  setupPanel.classList.add("is-hidden");
}

dismissSetupButton.addEventListener("click", () => {
  localStorage.setItem("setupDismissed", "true");
  setupPanel.classList.add("is-hidden");
});

rangeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.range = button.dataset.range;
    state.since = null;
    rangeButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    loadSummary();
  });
});

sinceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = document.querySelector("#since").value;
  if (!value) return;
  state.range = "since";
  state.since = new Date(value).toISOString();
  rangeButtons.forEach((item) => item.classList.remove("is-active"));
  loadSummary();
});

exportJsonButton.addEventListener("click", async () => {
  const params = currentRangeParams();
  const payload = await fetchJson(`/api/export?${params}`);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `procrastinating-export-${state.range}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

deleteRangeButton.addEventListener("click", async () => {
  const count = state.summary?.totals?.session_count || 0;
  if (!count) return;

  const confirmed = window.confirm(`Delete ${count} sessions in the current range? This cannot be undone.`);
  if (!confirmed) return;

  await fetchJson(`/api/sessions?${currentRangeParams()}`, { method: "DELETE" });
  await loadSummary();
});

trackingModeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.settings = await fetchJson("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "tracking_mode", value: trackingModeSelect.value })
  });
  renderSettings();
});

ruleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ruleDomainInput.value.trim()) return;

  state.settings = await fetchJson("/api/tracking-rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain: ruleDomainInput.value, action: ruleActionSelect.value })
  });
  ruleDomainInput.value = "";
  renderSettings();
});

async function loadSummary() {
  try {
    const params = new URLSearchParams({ range: state.range });
    if (state.since) params.set("since", state.since);
    const summary = await fetchJson(`/api/summary?${params}`);
    state.settings = await fetchJson("/api/settings");
    state.summary = summary;
    healthEl.textContent = "Connected";
    renderSummary(summary);
    renderSettings();
  } catch (error) {
    healthEl.textContent = "API offline";
    sessionsEl.innerHTML = `<p class="empty">Start the local server with npm run dev.</p>`;
    trackingRulesEl.innerHTML = `<p class="empty">Settings are unavailable while the API is offline.</p>`;
    console.error(error);
  }
}

function renderSummary(summary) {
  totalTimeEl.textContent = formatDuration(summary.totals.total_seconds);
  sessionCountEl.textContent = summary.totals.session_count;
  topCategoryEl.textContent = titleCase(summary.byCategory[0]?.category || "unknown");
  rangeLabelEl.textContent = `${formatDateTime(summary.from)} to ${formatDateTime(summary.to)}`;

  renderBars(categoriesEl, summary.byCategory, "category");
  renderBars(domainsEl, summary.byDomain, "domain");
  renderSessions(summary.sessions);
}

function renderBars(container, rows, labelKey) {
  container.replaceChildren();
  if (!rows.length) {
    container.innerHTML = `<p class="empty">No tracked activity yet.</p>`;
    return;
  }

  const max = Math.max(...rows.map((row) => row.seconds), 1);
  for (const row of rows) {
    const node = barTemplate.content.cloneNode(true);
    const label = node.querySelector(".bar-label");
    const fill = node.querySelector(".bar-fill");
    const time = node.querySelector(".bar-time");
    label.textContent = labelKey === "category" ? titleCase(row[labelKey]) : row[labelKey];
    fill.style.width = `${Math.max(3, (row.seconds / max) * 100)}%`;
    fill.style.background = colorFor(row.category || row.domain);
    time.textContent = formatDuration(row.seconds);
    container.append(node);
  }
}

function renderSessions(sessions) {
  sessionsEl.replaceChildren();
  if (!sessions.length) {
    sessionsEl.innerHTML = `<p class="empty">No sessions in this range yet. Once the extension is loaded, your active tabs will appear here.</p>`;
    return;
  }

  for (const session of sessions) {
    const node = sessionTemplate.content.cloneNode(true);
    const article = node.querySelector(".session");
    const title = node.querySelector("h3");
    const meta = node.querySelector("p");
    const detail = node.querySelector("small");
    const pill = node.querySelector(".pill");
    const select = node.querySelector("select");
    const domainButton = node.querySelector(".domain-button");
    const deleteDomainButton = node.querySelector(".delete-domain-button");
    const deleteButton = node.querySelector(".delete-button");

    title.textContent = session.title || session.url;
    meta.textContent = `${session.domain} / ${session.site_section}`;
    detail.textContent = `${formatDateTime(session.start_at)} - ${session.end_at ? formatTime(session.end_at) : "active"} · ${formatDuration(session.duration_seconds)}${session.backfilled ? " · backfilled" : ""}`;
    pill.textContent = session.category;
    pill.className = `pill ${session.category}`;
    select.value = session.category;

    select.addEventListener("change", async () => {
      const updated = await updateCategory(session.id, select.value, "session");
      Object.assign(session, updated);
      renderSummary(await refreshCurrentSummary());
    });

    domainButton.addEventListener("click", async () => {
      const updated = await updateCategory(session.id, select.value, "domain");
      Object.assign(session, updated);
      renderSummary(await refreshCurrentSummary());
    });

    deleteDomainButton.addEventListener("click", async () => {
      const confirmed = window.confirm(`Delete all ${session.domain} sessions in the current range?`);
      if (!confirmed) return;
      await fetchJson(`/api/domains/${encodeURIComponent(session.domain)}/sessions?${currentRangeParams()}`, { method: "DELETE" });
      renderSummary(await refreshCurrentSummary());
    });

    deleteButton.addEventListener("click", async () => {
      const confirmed = window.confirm(`Delete this session for ${session.domain}?`);
      if (!confirmed) return;
      await fetchJson(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      renderSummary(await refreshCurrentSummary());
    });

    article.dataset.id = session.id;
    sessionsEl.append(node);
  }
}

function renderSettings() {
  if (!state.settings) return;

  trackingModeSelect.value = state.settings.tracking_mode;
  privacySummaryEl.textContent = `${state.settings.privacy.storage}; ${state.settings.privacy.remote_sync} remote sync`;
  trackingRulesEl.replaceChildren();

  if (!state.settings.tracking_rules.length) {
    trackingRulesEl.innerHTML = `<p class="empty">No domain rules yet. Add a block rule to ignore a site, or switch to allowlist mode and add allowed domains.</p>`;
    return;
  }

  for (const rule of state.settings.tracking_rules) {
    const item = document.createElement("span");
    item.className = "rule";
    item.innerHTML = `<strong>${rule.action}</strong> ${rule.domain}`;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Remove";
    button.addEventListener("click", async () => {
      await fetchJson(`/api/tracking-rules/${rule.id}`, { method: "DELETE" });
      state.settings = await fetchJson("/api/settings");
      renderSettings();
    });

    item.append(button);
    trackingRulesEl.append(item);
  }
}

async function refreshCurrentSummary() {
  const params = currentRangeParams();
  state.summary = await fetchJson(`/api/summary?${params}`);
  return state.summary;
}

function currentRangeParams() {
  const params = new URLSearchParams({ range: state.range });
  if (state.since) params.set("since", state.since);
  return params;
}

async function updateCategory(id, category, scope) {
  return fetchJson(`/api/sessions/${encodeURIComponent(id)}/category`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, scope })
  });
}

async function fetchJson(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function colorFor(value = "") {
  if (value === "functional") return "var(--functional)";
  if (value === "fun") return "var(--fun)";
  if (value === "mixed") return "var(--mixed)";
  return "var(--accent)";
}

function formatDuration(totalSeconds = 0) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function titleCase(value) {
  return String(value).slice(0, 1).toUpperCase() + String(value).slice(1);
}

loadSummary();
setInterval(loadSummary, 30_000);
