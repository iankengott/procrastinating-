const stateEl = document.querySelector("#state");
const toggleEl = document.querySelector("#toggle");
const quickPauseButtons = [...document.querySelectorAll("[data-minutes]")];

async function refresh() {
  const status = await chrome.runtime.sendMessage({ type: "status" });
  toggleEl.textContent = status.paused ? "Resume tracking" : "Pause tracking";

  if (status.paused) {
    stateEl.textContent = status.pausedUntil
      ? `Tracking is paused until ${new Date(status.pausedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
      : "Tracking is paused.";
  } else if (status.apiOnline === false) {
    stateEl.textContent = "Local API is offline. Start npm run dev, then reload this extension.";
  } else if (status.currentSession) {
    stateEl.textContent = `Tracking: ${status.currentSession.title || status.currentSession.url}`;
  } else {
    stateEl.textContent = "Tracking is active. Open a normal web page to start a session.";
  }
}

toggleEl.addEventListener("click", async () => {
  const status = await chrome.runtime.sendMessage({ type: "status" });
  await chrome.runtime.sendMessage({ type: "setPaused", paused: !status.paused });
  await refresh();
});

quickPauseButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "setPaused", paused: true, minutes: Number(button.dataset.minutes) });
    await refresh();
  });
});

refresh();
