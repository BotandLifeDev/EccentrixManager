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
const dailyTaskBoard = document.querySelector("#dailyTaskBoard");
const dailyTaskSummary = document.querySelector("#dailyTaskSummary");
const dailyTaskMeta = document.querySelector("#dailyTaskMeta");
const dailySubmitDeveloper = document.querySelector("#dailySubmitDeveloper");

const teamMembers = [
  { name: "\u0e17\u0e35\u0e19", role: "Leader and overall manager" },
  { name: "\u0e41\u0e21\u0e19", role: "Art developer" },
  { name: "\u0e19\u0e19", role: "Main developer for Earth Atlantis Abyss" },
  { name: "\u0e20\u0e39\u0e1c\u0e32", role: "Main developer for Dynozoic" },
];

secretInput.value = state.secret;
setDefaultDates();
populateDailySubmitPeople();
bindTabs();
bindForms();
bindButtons();
loadStatus();
loadDailyTasks();

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

  document.querySelector("#dailyTaskLoadForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadDailyTasks(event.currentTarget);
  });

  document.querySelector("#dailyTaskSubmitForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitDailyTasks(event.currentTarget);
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
    ? `\n\nActions applied:\n${result.actionsApplied.map(formatAppliedAction).join("\n")}`
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

async function loadDailyTasks(form = document.querySelector("#dailyTaskLoadForm")) {
  const button = form?.querySelector('button[type="submit"]');
  const date = form?.elements.date?.value || new Date().toISOString().slice(0, 10);
  dailyTaskBoard.innerHTML = '<div class="empty-state">Generating daily tasks...</div>';

  const result = await postJson("/daily-tasks", { date }, button);
  if (!result) {
    dailyTaskBoard.innerHTML = '<div class="empty-state">Daily tasks could not be loaded. Check WEB_FORM_SECRET and API status.</div>';
    return;
  }

  state.dailyTasks = result;
  renderDailyTasks(result);
}

async function submitDailyTasks(form) {
  const button = form.querySelector('button[type="submit"]');
  const developer = form.elements.developer.value;
  const date = form.elements.date.value;
  const note = form.elements.note.value.trim();
  const progressItems = collectDailyProgressItems(developer);

  if (progressItems.length === 0 && !note) {
    print("Choose at least one task or add a submission note.");
    return;
  }

  const result = await postJson("/daily-task-submit", {
    date,
    developer,
    note,
    progressItems,
  }, button);

  if (result) {
    form.elements.note.value = "";
    print(result);
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
    if (data?.requiresConfirmation) {
      print(formatDiscordPreview(data));
      const confirmed = window.confirm(`Send this ${data.title || "message"} to Discord?`);
      if (!confirmed) return data;

      const confirmedData = await request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, confirm: true }),
      });
      print(confirmedData);
      return confirmedData;
    }
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

function renderDailyTasks(data) {
  const people = Array.isArray(data.people) ? data.people : [];
  dailyTaskMeta.textContent = `AI review for ${data.date} at ${data.morningReviewTime || "06:00"} Bangkok time.`;
  dailyTaskSummary.innerHTML = [
    `<strong>${escapeHtml(data.headline || "Daily task board")}</strong>`,
    `<span>${escapeHtml(data.summary || "Review today's tasks, carry-over work, and advance suggestions.")}</span>`,
  ].join("");

  dailyTaskBoard.innerHTML = people.length
    ? people.map(renderPersonTasks).join("")
    : '<div class="empty-state">No daily tasks returned by AI.</div>';

  dailyTaskBoard.querySelectorAll('input[type="range"]').forEach((range) => {
    range.addEventListener("input", () => {
      const value = range.closest(".task-row").querySelector(".percent-value");
      if (value) value.textContent = `${range.value}%`;
    });
  });
}

function renderPersonTasks(person) {
  const today = renderTaskGroup(person.member, "Today", person.todayTasks);
  const carryOver = renderTaskGroup(person.member, "Carry-over", person.carryOverTasks);
  const advance = renderTaskGroup(person.member, "When Free", person.advanceTasks);
  const risks = (person.risks || []).length
    ? `<div class="risk-list">${person.risks.map((risk) => `<span>${escapeHtml(risk)}</span>`).join("")}</div>`
    : "";

  return [
    `<article class="person-card" data-member="${escapeHtml(person.member)}">`,
    '<div class="person-head">',
    `<div><h3>${escapeHtml(person.member)}</h3><p>${escapeHtml(person.role || "")}</p></div>`,
    `<strong>${escapeHtml(person.focus || "Focus today")}</strong>`,
    '</div>',
    today,
    carryOver,
    advance,
    risks,
    '</article>',
  ].join("");
}

function renderTaskGroup(member, label, tasks) {
  const rows = Array.isArray(tasks) && tasks.length
    ? tasks.map((task) => renderTaskRow(member, label, task)).join("")
    : '<p class="task-empty">No items.</p>';
  return `<section class="task-group"><h4>${escapeHtml(label)}</h4>${rows}</section>`;
}

function renderTaskRow(member, group, task) {
  const current = Number(task.currentPercent || 0);
  const target = Number(task.targetPercent || 0);
  const project = task.project || "";

  return [
    '<div class="task-row"',
    ` data-member="${escapeHtml(member)}"`,
    ` data-group="${escapeHtml(group)}"`,
    ` data-title="${escapeHtml(task.title)}"`,
    ` data-project="${escapeHtml(project)}"`,
    ` data-row-number="${escapeHtml(task.timelineRowNumber || "")}">`,
    '<label class="task-check">',
    '<input type="checkbox" checked>',
    '<span></span>',
    '</label>',
    '<div class="task-main">',
    '<div class="task-title-line">',
    `<strong>${escapeHtml(task.title)}</strong>`,
    `<span>${escapeHtml(projectLabel(project))}</span>`,
    '</div>',
    `<p>${escapeHtml(task.why || "Target today")}</p>`,
    '<div class="percent-control">',
    `<input type="range" min="0" max="100" step="5" value="${current}" aria-label="Task percent">`,
    `<span class="percent-value">${current}%</span>`,
    `<small>Target ${target}%</small>`,
    '</div>',
    '</div>',
    '</div>',
  ].join("");
}

function collectDailyProgressItems(developer) {
  return [...dailyTaskBoard.querySelectorAll(`.task-row[data-member="${cssEscape(developer)}"]`)]
    .filter((row) => row.querySelector('input[type="checkbox"]').checked)
    .map((row) => ({
      title: row.dataset.title || "",
      project: row.dataset.project || "",
      timelineRowNumber: row.dataset.rowNumber || "",
      percent: row.querySelector('input[type="range"]').value,
      status: row.dataset.group || "",
    }));
}

function populateDailySubmitPeople() {
  dailySubmitDeveloper.innerHTML = teamMembers
    .map((member) => `<option value="${escapeHtml(member.name)}">${escapeHtml(member.name)} - ${escapeHtml(member.role)}</option>`)
    .join("");
}

function projectLabel(project) {
  if (project === "dynozoic") return "Dynozoic";
  if (project === "eaa") return "EAA";
  return "Both";
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}

function statusCard(label, value, tone) {
  return `<article class="status-card ${tone}"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></article>`;
}

function print(value) {
  output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function formatDiscordPreview(data) {
  return [
    `${data.title || "Discord Message"} Preview`,
    "",
    data.preview || data.report || data.message || "",
    "",
    "Confirm to send this message to Discord.",
  ].join("\n");
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

function formatAppliedAction(item) {
  if (item.type === "update_timeline_field") {
    const projects = item.projects
      .map((project) => `${project.label}: ${project.editedCells} cells`)
      .join(", ");
    return `- ${item.type}: ${item.field} = ${item.value}, edited ${item.editedCells} cells (${projects})`;
  }

  if (item.type === "patch_sheet_cells") {
    return `- ${item.type}: ${item.project} / ${item.sheet}, edited ${item.editedCells} cells (${item.updatedFields.join(", ")})`;
  }

  if (item.type === "save_update") {
    const mode = item.mode === "updated_existing" ? `updated existing (${item.editedCells} cells)` : "created new row";
    return `- ${item.type}: ${item.project}, ${mode}`;
  }

  return `- ${item.type}: ${item.project || item.weekStart || "done"}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
