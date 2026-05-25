const state = {
  secret: localStorage.getItem("eccentrixSecret") || "",
  status: null,
  chatHistory: [],
};

const output = document.querySelector("#output");
const secretInput = document.querySelector("#secretInput");
const statusGrid = document.querySelector("#statusGrid");
const interactionEndpoint = document.querySelector("#interactionEndpoint");
const chatStream = document.querySelector("#chatStream");

secretInput.value = state.secret;
setDefaultDates();
bindTabs();
bindForms();
bindButtons();
loadStatus();

function setDefaultDates() {
  const today = new Date().toISOString().slice(0, 10);
  document.querySelectorAll('input[type="date"]').forEach((input) => {
    if (!input.value) input.value = today;
  });
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("is-active"));
      document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("is-active"));
      tab.classList.add("is-active");
      document.querySelector(`#${tab.dataset.panel}`).classList.add("is-active");
    });
  });
}

function bindForms() {
  document.querySelectorAll("form[data-endpoint]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitForm(form);
    });
  });
}

function bindButtons() {
  document.querySelector("#saveSecretBtn").addEventListener("click", () => {
    state.secret = secretInput.value.trim();
    localStorage.setItem("eccentrixSecret", state.secret);
    print("Saved secret in this browser.");
    loadStatus();
  });

  document.querySelector("#clearOutputBtn").addEventListener("click", () => {
    output.textContent = "Ready";
  });

  document.querySelector("#clearChatBtn").addEventListener("click", () => {
    state.chatHistory = [];
    chatStream.innerHTML = "";
    addChatMessage("assistant", "Ask me to inspect the timeline, summarize risks, or save updates to Google Sheets.");
  });

  document.querySelector("#checkSheetsBtn").addEventListener("click", async (event) => {
    const data = await getJson("/admin/sheets-debug", event.currentTarget);
    if (!data) {
      addChatMessage("assistant", "Could not read sheets. Check WEB_FORM_SECRET, sheet IDs, and sharing permissions.");
      return;
    }
    addChatMessage("assistant", formatSheetsDebug(data));
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      await postJson(button.dataset.action, {}, button);
    });
  });

  document.querySelector("#registerCommandsBtn").addEventListener("click", async (event) => {
    await postJson("/discord/register-commands", {}, event.currentTarget);
    await loadStatus();
  });

  document.querySelector("#copyEndpointBtn").addEventListener("click", async () => {
    await navigator.clipboard.writeText(interactionEndpoint.value);
    print("Copied interaction endpoint.");
  });

  document.querySelector("#assistantChatForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitChat(event.currentTarget);
  });
}

async function submitForm(form) {
  const button = form.querySelector('button[type="submit"]');
  const data = Object.fromEntries(new FormData(form).entries());

  Object.keys(data).forEach((key) => {
    if (data[key] === "") delete data[key];
  });

  await postJson(form.dataset.endpoint, data, button);
}

async function submitChat(form) {
  const button = form.querySelector('button[type="submit"]');
  const formData = Object.fromEntries(new FormData(form).entries());
  const message = String(formData.message || "").trim();
  const project = String(formData.project || "").trim();
  if (!message) return;

  addChatMessage("user", message);
  form.elements.message.value = "";

  const result = await postJson("/assistant/chat", {
    project,
    message,
    history: state.chatHistory,
  }, button);

  if (!result) {
    addChatMessage("assistant", "Request failed. Check WEB_FORM_SECRET and server logs.");
    return;
  }

  const overviewText = result.visualProgressOverview
    ? `\n\nVisual Progress Overview:\n${formatOverview(result.visualProgressOverview)}`
    : "";
  const contextText = result.contextSummary
    ? `\n\nLoaded Timeline Context:\n${formatContextSummary(result.contextSummary)}`
    : "";
  const actionsText = result.actionsApplied?.length
    ? `\n\nActions applied:\n${result.actionsApplied.map((item) => `- ${item.type}: ${item.project || item.weekStart || "done"}`).join("\n")}`
    : "";
  const reply = `${result.reply || "Done."}${contextText}${overviewText}${actionsText}`;

  addChatMessage("assistant", reply);
  state.chatHistory.push({ role: "user", content: message });
  state.chatHistory.push({ role: "assistant", content: result.reply || "Done." });
  state.chatHistory = state.chatHistory.slice(-8);
}

async function loadStatus() {
  try {
    const data = await request("/admin/status", { method: "GET" });
    state.status = data;
    renderStatus(data);
    interactionEndpoint.value = data.discord?.interactionEndpoint || `${location.origin}/discord/interactions`;
  } catch (error) {
    renderStatus(null, error);
    interactionEndpoint.value = `${location.origin}/discord/interactions`;
  }
}

async function postJson(endpoint, body, button) {
  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Working...";
  }

  try {
    const data = await request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    print(data);
    return data;
  } catch (error) {
    print({ error: error.message });
    return null;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function getJson(endpoint, button) {
  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Checking...";
  }

  try {
    const data = await request(endpoint, { method: "GET" });
    print(data);
    return data;
  } catch (error) {
    print({ error: error.message });
    return null;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function request(endpoint, options = {}) {
  const headers = new Headers(options.headers || {});
  const secret = secretInput.value.trim() || state.secret;
  if (secret) headers.set("authorization", `Bearer ${secret}`);

  const response = await fetch(endpoint, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof payload === "string" ? payload : payload.error || "Request failed";
    throw new Error(message);
  }

  return payload;
}

function renderStatus(data, error) {
  if (!data) {
    statusGrid.innerHTML = [
      statusCard("API", "Locked", "bad"),
      statusCard("Auth", error?.message || "Unauthorized", "bad"),
      statusCard("Discord", "Waiting", "warn"),
      statusCard("Google Sheets", "Waiting", "warn"),
    ].join("");
    return;
  }

  const googleReady = data.google.serviceAccountConfigured
    && data.google.dynozoicSheetConfigured
    && data.google.eaaSheetConfigured;
  const discordReady = data.discord.tokenConfigured
    && data.discord.clientIdConfigured
    && data.discord.publicKeyConfigured
    && data.discord.reportChannelConfigured;

  statusGrid.innerHTML = [
    statusCard("API", "Online", "ok"),
    statusCard("Grok", data.ai.grokConfigured ? data.ai.model : "Missing key", data.ai.grokConfigured ? "ok" : "bad"),
    statusCard("Google Sheets", googleReady ? "Ready" : "Check env", googleReady ? "ok" : "bad"),
    statusCard("Discord", discordReady ? "Ready" : "Check env", discordReady ? "ok" : "warn"),
  ].join("");
}

function statusCard(label, value, tone) {
  return `<article class="status-card ${tone}"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></article>`;
}

function print(value) {
  output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function addChatMessage(role, text) {
  const article = document.createElement("article");
  article.className = `chat-message ${role}`;

  const label = document.createElement("strong");
  label.textContent = role === "user" ? "You" : "AI PM";

  const body = document.createElement("p");
  body.textContent = text;

  article.append(label, body);
  chatStream.append(article);
  chatStream.scrollTop = chatStream.scrollHeight;
}

function formatOverview(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function formatContextSummary(summary) {
  return summary.map((item) => [
    `- ${item.project}`,
    `  timeline total: ${item.timelineTotalCount}`,
    `  timeline with data: ${item.timelineMeaningfulCount}`,
    `  timeline sent to AI: ${item.recentTimelineCount} / ${item.timelineContextLimit}`,
    `  feedback total: ${item.feedbackTotalCount}`,
    `  open feedback: ${item.openFeedbackCount}`,
    `  targets total: ${item.weeklyTargetTotalCount}`,
    `  targets this week: ${item.weeklyTargetCount}`,
    `  plan total: ${item.weeklyPlanTotalCount}`,
    `  plan this week: ${item.currentPlanCount}`,
  ].join("\n")).join("\n");
}

function formatSheetsDebug(data) {
  return [
    `Sheets debug (${data.date})`,
    ...data.projects.map((project) => [
      "",
      project.label,
      `Timeline rows total: ${project.counts.timelineTotal}`,
      `Timeline rows with data: ${project.counts.timelineMeaningful}`,
      `Timeline rows sent to AI: ${project.counts.recentTimeline} / ${project.counts.timelineContextLimit}`,
      `Feedback rows total: ${project.counts.feedbackTotal}`,
      `Open feedback loaded: ${project.counts.openFeedback}`,
      `Weekly targets total: ${project.counts.weeklyTargetsTotal}`,
      `Weekly targets this week: ${project.counts.weeklyTargets}`,
      `Weekly plan rows total: ${project.counts.weeklyPlanTotal}`,
      `Current plan rows this week: ${project.counts.currentPlan}`,
      `Tabs: ${project.sheetTabs.timeline}, ${project.sheetTabs.feedback}, ${project.sheetTabs.targets}, ${project.sheetTabs.plan}`,
      project.lastTimelineRows.length
        ? `Latest timeline: ${project.lastTimelineRows.map((row) => `${row.date} ${row.developer}: ${row.summary || row.rawUpdate}`).join(" | ")}`
        : "Latest timeline: none loaded",
    ].join("\n")),
  ].join("\n");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
