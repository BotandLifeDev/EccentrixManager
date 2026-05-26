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
const weeklyTaskMeta = document.querySelector("#weeklyTaskMeta");
const weeklyTaskSummary = document.querySelector("#weeklyTaskSummary");
const weeklyTaskBoard = document.querySelector("#weeklyTaskBoard");
const milestoneReviewMeta = document.querySelector("#milestoneReviewMeta");
const milestoneReviewSummary = document.querySelector("#milestoneReviewSummary");
const milestoneReviewGrid = document.querySelector("#milestoneReviewGrid");

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
loadSavedDailyTasks();
loadSavedWeeklyTasks();
loadSavedMilestoneReview();

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
    await regenerateDailyTasks(event.currentTarget);
  });

  document.querySelector("#loadSavedDailyTasksBtn").addEventListener("click", async () => {
    await loadSavedDailyTasks();
  });

  document.querySelector("#loadSavedWeeklyBtn").addEventListener("click", async () => {
    await loadSavedWeeklyTasks();
  });

  document.querySelector("#regenWeeklyBtn").addEventListener("click", async () => {
    await regenerateWeeklyTasks();
  });

  document.querySelector("#loadSavedMilestoneBtn").addEventListener("click", async () => {
    await loadSavedMilestoneReview();
  });

  document.querySelector("#regenMilestoneBtn").addEventListener("click", async () => {
    await regenerateMilestoneReview();
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

async function loadSavedDailyTasks(form = document.querySelector("#dailyTaskLoadForm")) {
  const button = document.querySelector("#loadSavedDailyTasksBtn");
  const date = form?.elements.date?.value || new Date().toISOString().slice(0, 10);
  const local = loadLocalDailyTasks(date);

  if (local) {
    state.dailyTasks = local;
    renderDailyTasks(local);
  } else {
    dailyTaskBoard.innerHTML = '<div class="empty-state">No saved daily tasks in this browser yet. Press Re-gen to create one.</div>';
  }

  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Loading...";
  }

  try {
    const result = await request(`/daily-tasks?date=${encodeURIComponent(date)}`, { method: "GET" });
    if (result?.people?.length) {
      saveLocalDailyTasks(result);
      state.dailyTasks = result;
      renderDailyTasks(result);
    } else if (!local) {
      dailyTaskSummary.innerHTML = [
        "<strong>Morning task board</strong>",
        `<span>${escapeHtml(result.message || "No saved daily task board for this date.")}</span>`,
      ].join("");
    }
  } catch (error) {
    if (!local) {
      dailyTaskBoard.innerHTML = '<div class="empty-state">Saved tasks could not be loaded. Check WEB_FORM_SECRET and API status.</div>';
    }
    print({ error: error.message });
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function regenerateDailyTasks(form = document.querySelector("#dailyTaskLoadForm")) {
  const button = form?.querySelector('button[type="submit"]');
  const date = form?.elements.date?.value || new Date().toISOString().slice(0, 10);
  dailyTaskBoard.innerHTML = '<div class="empty-state">AI is analyzing the full timelines for both games...</div>';

  const result = await postJson("/daily-tasks", { date, regenerate: true }, button);
  if (!result) {
    dailyTaskBoard.innerHTML = '<div class="empty-state">Daily tasks could not be loaded. Check WEB_FORM_SECRET and API status.</div>';
    return;
  }

  saveLocalDailyTasks(result);
  state.dailyTasks = result;
  renderDailyTasks(result);
}

async function loadSavedWeeklyTasks(form = document.querySelector("#dailyTaskLoadForm")) {
  const button = document.querySelector("#loadSavedWeeklyBtn");
  const weekStart = weekStartFromDate(form?.elements.date?.value || new Date().toISOString().slice(0, 10));
  const local = loadLocalWeeklyTasks(weekStart);

  if (local) {
    state.weeklyTasks = local;
    renderWeeklyTasks(local);
  } else {
    weeklyTaskBoard.innerHTML = '<div class="empty-state">No saved weekly tasks in this browser yet. Press Re-gen to create one.</div>';
  }

  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Loading...";
  }

  try {
    const result = await request(`/weekly-tasks?weekStart=${encodeURIComponent(weekStart)}`, { method: "GET" });
    if (result?.people?.length) {
      saveLocalWeeklyTasks(result);
      state.weeklyTasks = result;
      renderWeeklyTasks(result);
    } else if (!local) {
      weeklyTaskSummary.innerHTML = [
        "<strong>No saved weekly task board loaded.</strong>",
        `<span>${escapeHtml(result.message || "No saved weekly task board for this week.")}</span>`,
      ].join("");
    }
  } catch (error) {
    if (!local) {
      weeklyTaskBoard.innerHTML = '<div class="empty-state">Saved weekly tasks could not be loaded. Check WEB_FORM_SECRET and API status.</div>';
    }
    print({ error: error.message });
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function regenerateWeeklyTasks(form = document.querySelector("#dailyTaskLoadForm")) {
  const button = document.querySelector("#regenWeeklyBtn");
  const weekStart = weekStartFromDate(form?.elements.date?.value || new Date().toISOString().slice(0, 10));
  weeklyTaskBoard.innerHTML = '<div class="empty-state">AI is planning the full week from both timelines...</div>';

  const result = await postJson("/weekly-tasks", { weekStart, regenerate: true }, button);
  if (!result) {
    weeklyTaskBoard.innerHTML = '<div class="empty-state">Weekly tasks could not be loaded. Check WEB_FORM_SECRET and API status.</div>';
    return;
  }

  saveLocalWeeklyTasks(result);
  state.weeklyTasks = result;
  renderWeeklyTasks(result);
}

async function loadSavedMilestoneReview(form = document.querySelector("#dailyTaskLoadForm")) {
  const button = document.querySelector("#loadSavedMilestoneBtn");
  const date = form?.elements.date?.value || new Date().toISOString().slice(0, 10);
  const local = loadLocalMilestoneReview(date);

  if (local) {
    state.milestoneReview = local;
    renderMilestoneReview(local);
  } else {
    milestoneReviewGrid.innerHTML = '<div class="empty-state">No saved milestone review in this browser yet. Press Re-gen to create one.</div>';
  }

  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Loading...";
  }

  try {
    const result = await request(`/milestone-review?date=${encodeURIComponent(date)}`, { method: "GET" });
    if (result?.projects?.length) {
      saveLocalMilestoneReview(result);
      state.milestoneReview = result;
      renderMilestoneReview(result);
    } else if (!local) {
      milestoneReviewSummary.innerHTML = [
        "<strong>No saved milestone review loaded.</strong>",
        `<span>${escapeHtml(result.message || "No saved milestone review for this date.")}</span>`,
      ].join("");
    }
  } catch (error) {
    if (!local) {
      milestoneReviewGrid.innerHTML = '<div class="empty-state">Saved milestone review could not be loaded. Check WEB_FORM_SECRET and API status.</div>';
    }
    print({ error: error.message });
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function regenerateMilestoneReview(form = document.querySelector("#dailyTaskLoadForm")) {
  const button = document.querySelector("#regenMilestoneBtn");
  const date = form?.elements.date?.value || new Date().toISOString().slice(0, 10);
  milestoneReviewGrid.innerHTML = '<div class="empty-state">AI is analyzing full milestone progress for both projects...</div>';

  const result = await postJson("/milestone-review", { date, regenerate: true }, button);
  if (!result) {
    milestoneReviewGrid.innerHTML = '<div class="empty-state">Milestone review could not be loaded. Check WEB_FORM_SECRET and API status.</div>';
    return;
  }

  saveLocalMilestoneReview(result);
  state.milestoneReview = result;
  renderMilestoneReview(result);
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
  const savedText = data.generatedAt ? ` Generated ${new Date(data.generatedAt).toLocaleString()}.` : "";
  dailyTaskMeta.textContent = `AI review for ${data.date} at ${data.morningReviewTime || "06:00"} Bangkok time.${savedText}`;
  dailyTaskSummary.innerHTML = [
    `<strong>${escapeHtml(data.headline || "Daily task board")}</strong>`,
    `<span>${escapeHtml(formatDailyTaskSummary(data))}</span>`,
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

function formatDailyTaskSummary(data) {
  const analysis = data.timelineAnalysis || {};
  const risks = asTextList(analysis.deadlineRisks).slice(0, 3).join(" | ");
  const blocked = asTextList(analysis.blockedOrLateWork).slice(0, 3).join(" | ");
  const signals = formatSignalCounts(data.scheduleSignals);
  return [
    data.summary || "Review today's tasks, carry-over work, and advance suggestions.",
    signals,
    risks ? `Deadline risks: ${risks}` : "",
    blocked ? `Blocked/late: ${blocked}` : "",
  ].filter(Boolean).join(" ");
}

function asTextList(value) {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item));
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function renderWeeklyTasks(data) {
  const people = Array.isArray(data.people) ? data.people : [];
  const savedText = data.generatedAt ? ` Generated ${new Date(data.generatedAt).toLocaleString()}.` : "";
  weeklyTaskMeta.textContent = `AI weekly plan for ${data.weekStart} to ${data.weekEnd || ""}.${savedText}`;
  weeklyTaskSummary.innerHTML = [
    `<strong>${escapeHtml(data.headline || "Weekly task board")}</strong>`,
    `<span>${escapeHtml(formatWeeklySummary(data))}</span>`,
  ].join("");
  weeklyTaskBoard.innerHTML = people.length
    ? people.map(renderWeeklyPersonTasks).join("")
    : '<div class="empty-state">No weekly tasks returned by AI.</div>';
}

function formatWeeklySummary(data) {
  const finish = asTextList(data.finishByWeekEnd).slice(0, 4).join(" | ");
  const risks = asTextList(data.weeklyRisks).slice(0, 4).join(" | ");
  const signals = formatSignalCounts(data.scheduleSignals);
  return [
    data.summary || "Review what should be completed this week.",
    signals,
    finish ? `Finish: ${finish}` : "",
    risks ? `Risks: ${risks}` : "",
  ].filter(Boolean).join(" ");
}

function renderWeeklyPersonTasks(person) {
  return [
    `<article class="person-card" data-member="${escapeHtml(person.member)}">`,
    '<div class="person-head">',
    `<div><h3>${escapeHtml(person.member)}</h3><p>${escapeHtml(person.role || "")}</p></div>`,
    `<strong>${escapeHtml(person.focus || "Weekly focus")}</strong>`,
    '</div>',
    renderTaskGroup(person.member, "Must Finish", person.mustFinishThisWeek || []),
    renderTaskGroup(person.member, "Late Recovery", person.recoveryTasks || []),
    renderTaskGroup(person.member, "If Ahead", person.advanceTasks || []),
    (person.risks || []).length ? `<div class="risk-list">${person.risks.map((risk) => `<span>${escapeHtml(risk)}</span>`).join("")}</div>` : "",
    '</article>',
  ].join("");
}

function renderMilestoneReview(data) {
  const projects = Array.isArray(data.projects) ? data.projects : [];
  const savedText = data.generatedAt ? ` Generated ${new Date(data.generatedAt).toLocaleString()}.` : "";
  milestoneReviewMeta.textContent = `AI milestone review for ${data.date} at ${data.morningReviewTime || "06:00"} Bangkok time.${savedText}`;
  milestoneReviewSummary.innerHTML = [
    `<strong>${escapeHtml(data.headline || "Milestone Review")} - ${Number(data.overallPercent || 0)}%</strong>`,
    `<span>${escapeHtml(formatMilestoneSummary(data))}</span>`,
  ].join("");
  milestoneReviewGrid.innerHTML = projects.length
    ? projects.map(renderMilestoneProject).join("")
    : '<div class="empty-state">No milestone review returned by AI.</div>';
}

function renderMilestoneProject(project) {
  const concerns = renderMiniList("Worry", project.concerns);
  const smooth = renderMiniList("Smooth", project.smoothAreas);
  const focus = renderMiniList("Next", project.nextReviewFocus);
  const rows = Array.isArray(project.evidenceRows) && project.evidenceRows.length
    ? `<p class="evidence-row">Rows: ${project.evidenceRows.map((row) => `#${escapeHtml(row)}`).join(", ")}</p>`
    : "";

  return [
    `<article class="milestone-card ${escapeHtml(project.status || "smooth")}">`,
    '<div class="milestone-card-head">',
    `<div><h4>${escapeHtml(project.project || projectLabel(project.projectKey))}</h4><p>${escapeHtml(project.currentMilestone || "Current milestone")}</p></div>`,
    `<strong>${Number(project.percentComplete || 0)}%</strong>`,
    '</div>',
    `<div class="progress-bar"><span style="width: ${Math.max(0, Math.min(100, Number(project.percentComplete || 0)))}%"></span></div>`,
    `<p class="deadline-status">${escapeHtml(project.deadlineStatus || "Unknown timing")}</p>`,
    concerns,
    smooth,
    focus,
    rows,
    '</article>',
  ].join("");
}

function formatMilestoneSummary(data) {
  const concerns = asTextList(data.concerns).slice(0, 3).join(" | ");
  const smooth = asTextList(data.smoothAreas).slice(0, 3).join(" | ");
  const signals = formatSignalCounts(data.scheduleSignals);
  return [
    data.summary || "Full timeline milestone review for both projects.",
    signals,
    concerns ? `Worry: ${concerns}` : "",
    smooth ? `Smooth: ${smooth}` : "",
  ].filter(Boolean).join(" ");
}

function formatSignalCounts(scheduleSignals) {
  const signals = Array.isArray(scheduleSignals) ? scheduleSignals : [];
  if (!signals.length) return "";
  const totals = signals.reduce((total, item) => ({
    overdue: total.overdue + (item.overdue?.length || 0),
    dueSoon: total.dueSoon + (item.dueSoon?.length || 0),
    blocked: total.blocked + (item.blocked?.length || 0),
    lowProgressDeadline: total.lowProgressDeadline + (item.lowProgressDeadline?.length || 0),
  }), { overdue: 0, dueSoon: 0, blocked: 0, lowProgressDeadline: 0 });
  return `Detected: overdue ${totals.overdue}, due soon ${totals.dueSoon}, blocked ${totals.blocked}, low progress near deadline ${totals.lowProgressDeadline}.`;
}

function renderMiniList(label, values) {
  const items = asTextList(values);
  if (!items.length) return "";
  return [
    '<div class="mini-list">',
    `<strong>${escapeHtml(label)}</strong>`,
    ...items.slice(0, 4).map((item) => `<span>${escapeHtml(item)}</span>`),
    '</div>',
  ].join("");
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
    '<input type="checkbox">',
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

function dailyTaskStorageKey(date) {
  return `eccentrixDailyTasks:${date}`;
}

function saveLocalDailyTasks(data) {
  if (!data?.date) return;
  localStorage.setItem(dailyTaskStorageKey(data.date), JSON.stringify(data));
}

function loadLocalDailyTasks(date) {
  try {
    return JSON.parse(localStorage.getItem(dailyTaskStorageKey(date)) || "null");
  } catch (_error) {
    return null;
  }
}

function weeklyTaskStorageKey(weekStart) {
  return `eccentrixWeeklyTasks:${weekStart}`;
}

function saveLocalWeeklyTasks(data) {
  if (!data?.weekStart) return;
  localStorage.setItem(weeklyTaskStorageKey(data.weekStart), JSON.stringify(data));
}

function loadLocalWeeklyTasks(weekStart) {
  try {
    return JSON.parse(localStorage.getItem(weeklyTaskStorageKey(weekStart)) || "null");
  } catch (_error) {
    return null;
  }
}

function weekStartFromDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - (day - 1));
  return date.toISOString().slice(0, 10);
}

function milestoneStorageKey(date) {
  return `eccentrixMilestoneReview:${date}`;
}

function saveLocalMilestoneReview(data) {
  if (!data?.date) return;
  localStorage.setItem(milestoneStorageKey(data.date), JSON.stringify(data));
}

function loadLocalMilestoneReview(date) {
  try {
    return JSON.parse(localStorage.getItem(milestoneStorageKey(date)) || "null");
  } catch (_error) {
    return null;
  }
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
