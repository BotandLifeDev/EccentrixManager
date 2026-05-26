require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const { google } = require("googleapis");
const OpenAI = require("openai");
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} = require("discord.js");

let waitUntil = (promise) => {
  promise.catch((error) => {
    console.error("Background task failed:", error.message);
  });
};
try {
  waitUntil = require("@vercel/functions").waitUntil;
} catch (_error) {
  // Optional in local development. Vercel provides it after install.
}

const SHEET_HEADERS = [
  "Date",
  "Developer",
  "Raw Update",
  "Summary",
  "Completed",
  "In Progress",
  "Blockers",
  "Next Steps",
  "Tags",
  "Confidence",
  "Source",
  "Created At",
];

const TIMELINE_HEADERS = [
  "ID",
  "Rock",
  "Priority",
  "Task",
  "Start",
  "End",
  "Blockers",
  "Percent",
  "Response",
  "Sub Response",
  "Status&LateDay",
];

const FEEDBACK_HEADERS = [
  "Date",
  "Developer",
  "Feedback",
  "Summary",
  "Category",
  "Suggested Action",
  "Status",
  "Source",
  "Created At",
];

const TARGET_HEADERS = [
  "Week Start",
  "Project",
  "Owner",
  "Raw Target",
  "AI Refined Target",
  "Success Criteria",
  "Risks",
  "Source",
  "Created At",
];

const PLAN_HEADERS = [
  "Week Start",
  "Project",
  "Assignee",
  "Role",
  "Task",
  "Priority",
  "Success Criteria",
  "Dependencies",
  "Status",
  "Source",
  "Created At",
];

const TIMELINE_EDIT_FIELDS = {
  id: { header: "ID", column: "A" },
  rock: { header: "Rock", column: "B" },
  priority: { header: "Priority", column: "C" },
  task: { header: "Task", column: "D" },
  start: { header: "Start", column: "E" },
  end: { header: "End", column: "F" },
  deadline: { header: "End", column: "F" },
  blockers: { header: "Blockers", column: "G" },
  blocker: { header: "Blockers", column: "G" },
  blocked: { header: "Blockers", column: "G" },
  percent: { header: "Percent", column: "H" },
  progress: { header: "Percent", column: "H" },
  response: { header: "Response", column: "I" },
  subresponse: { header: "Sub Response", column: "J" },
  "sub response": { header: "Sub Response", column: "J" },
  status: { header: "Status&LateDay", column: "K" },
  lateday: { header: "Status&LateDay", column: "K" },
  "status&lateday": { header: "Status&LateDay", column: "K" },
};

const TEAM_MEMBERS = [
  {
    name: "ทีน",
    role: "Leader and overall manager",
    projects: ["dynozoic", "eaa"],
  },
  {
    name: "แมน",
    role: "Art developer",
    projects: ["dynozoic", "eaa"],
  },
  {
    name: "นน",
    role: "Main developer for Earth Atlantis Abyss",
    projects: ["eaa"],
  },
  {
    name: "ภูผา",
    role: "Main developer for Dynozoic",
    projects: ["dynozoic"],
  },
];

const ACTIVE_TEAM_MEMBERS = [
  {
    name: "\u0e17\u0e35\u0e19",
    role: "Leader and overall manager",
    projects: ["dynozoic", "eaa"],
  },
  {
    name: "\u0e41\u0e21\u0e19",
    role: "Art developer",
    projects: ["dynozoic", "eaa"],
  },
  {
    name: "\u0e19\u0e19",
    role: "Main developer for Earth Atlantis Abyss",
    projects: ["eaa"],
  },
  {
    name: "\u0e20\u0e39\u0e1c\u0e32",
    role: "Main developer for Dynozoic",
    projects: ["dynozoic"],
  },
];

const PROJECTS = {
  dynozoic: {
    key: "dynozoic",
    label: "Dynozoic timeline",
    aliases: ["dynozoic", "dyno", "dynozoic timeline"],
    spreadsheetId: process.env.DYNOZOIC_SHEET_ID || process.env.GOOGLE_SHEET_ID,
    sheetName:
      process.env.DYNOZOIC_SHEET_NAME ||
      process.env.GOOGLE_SHEET_NAME ||
      "Timeline",
    feedbackSheetName: process.env.DYNOZOIC_FEEDBACK_SHEET_NAME || "Feedback",
    targetSheetName: process.env.DYNOZOIC_TARGET_SHEET_NAME || "WeeklyTargets",
    planSheetName: process.env.DYNOZOIC_PLAN_SHEET_NAME || "WeeklyPlan",
  },
  eaa: {
    key: "eaa",
    label: "Earth Atlantis Abyss",
    aliases: ["eaa", "earth atlantis abyss", "earth atlantis", "abyss"],
    spreadsheetId: process.env.EAA_SHEET_ID || process.env.GOOGLE_SHEET_ID,
    sheetName:
      process.env.EAA_SHEET_NAME ||
      process.env.GOOGLE_SHEET_NAME ||
      "Timeline",
    feedbackSheetName: process.env.EAA_FEEDBACK_SHEET_NAME || "Feedback",
    targetSheetName: process.env.EAA_TARGET_SHEET_NAME || "WeeklyTargets",
    planSheetName: process.env.EAA_PLAN_SHEET_NAME || "WeeklyPlan",
  },
};

const env = {
  port: Number(process.env.PORT || 3000),
  grokApiKey: process.env.GROK_API_KEY,
  grokModel: process.env.GROK_MODEL || "grok-3-latest",
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  googlePrivateKey: normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY),
  discordToken: process.env.DISCORD_TOKEN,
  discordClientId: process.env.DISCORD_CLIENT_ID,
  discordPublicKey: process.env.DISCORD_PUBLIC_KEY,
  discordGuildId: process.env.DISCORD_GUILD_ID,
  discordUpdateChannelId: process.env.DISCORD_UPDATE_CHANNEL_ID,
  discordReportChannelId: process.env.DISCORD_REPORT_CHANNEL_ID,
  dailyReportTime: process.env.DAILY_REPORT_TIME || "21:00",
  dailyTaskTime: process.env.DAILY_TASK_TIME || "06:00",
  timelineContextLimit: Number(process.env.TIMELINE_CONTEXT_LIMIT || 1000),
  enableDiscordBot: process.env.ENABLE_DISCORD_BOT === "true",
  cronSecret: process.env.CRON_SECRET,
  webFormSecret: process.env.WEB_FORM_SECRET,
};

const grok = env.grokApiKey
  ? new OpenAI({
      apiKey: env.grokApiKey,
      baseURL: "https://api.x.ai/v1",
    })
  : null;
let discordClient = null;
let dailyReportTimer = null;
const dailyTaskCache = new Map();
const milestoneReviewCache = new Map();

const PM_ASSISTANT_SYSTEM_PROMPT = [
  "You are an AI Project Manager Assistant responsible for managing project updates, timelines, reporting, and workflow organization.",
  "Your responsibilities include tracking daily progress updates from the team, updating project timelines and schedules in real-time, managing and editing Google Sheets provided via shared links, monitoring task completion status, deadlines, and milestones, identifying delayed, blocked, or high-risk tasks, sending reminders and warnings for tasks that are close to deadlines or falling behind schedule, helping prioritize tasks and adjust development plans when needed, maintaining clear project structure and organization, creating concise daily summaries for the team and stakeholders, generating visual summaries, charts, progress reports, and timeline overviews every day, and helping ensure the project stays on track and aligned with its target milestones.",
  "Workflow rules: wait for daily work updates from the user or team members; analyze progress and compare it against the current timeline; automatically update schedules, milestones, and completion percentages when the user clearly asks for changes; detect schedule risks and recommend solutions or adjustments; highlight critical tasks that require immediate attention; organize updates into clean summaries with clear priorities; maintain consistency between all project documents and Google Sheets; when a Google Sheet link is provided, access and manage the sheet structure appropriately through the available backend tools; always keep the timeline realistic and updated based on actual development speed; assist with production planning, resource balancing, and milestone management.",
  "Communication style: professional, concise, proactive, highly organized, focused on productivity and delivery, clear with priorities and deadlines, and solution-oriented rather than passive.",
  "Daily output format when producing a report: Daily Progress Summary, Completed Tasks, In Progress Tasks, Blocked/Risk Tasks, Timeline Changes, Upcoming Priorities, Deadline Warnings, Suggested Actions, Visual Progress Overview.",
  "Your goal is to function as a reliable production manager that helps keep the entire project moving efficiently and on schedule.",
].join("\n");

const app = express();
app.use(
  "/discord/interactions",
  express.raw({ type: "application/json", limit: "1mb" }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/admin/status", (req, res) => {
  try {
    assertWebAuth(req);
    res.json(createAdminStatus(req));
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.post("/discord/interactions", (req, res) => {
  try {
    if (!verifyDiscordRequest(req)) {
      res.status(401).send("Bad request signature");
      return;
    }

    const interaction = JSON.parse(req.body.toString("utf8"));
    if (interaction.type === 1) {
      res.json({ type: 1 });
      return;
    }

    if (!isAllowedDiscordChannel(interaction.channel_id)) {
      res.json({
        type: 4,
        data: {
          content: "Please use this in the configured update channel.",
          flags: 64,
        },
      });
      return;
    }

    if (interaction.type === 2 && interaction.data?.name === "managerpanel") {
      res.json({
        type: 4,
        data: {
          content: "AI Project Manager Panel",
          components: [createManagerPanelButtonPayload()],
        },
      });
      return;
    }

    waitUntil(runDiscordWebhookInteraction(interaction));
    res.json({ type: 5 });
  } catch (error) {
    console.error("Discord interaction error:", error.message);
    res.status(500).json({ error: "Interaction failed" });
  }
});

app.post("/discord/register-commands", async (req, res) => {
  try {
    assertWebAuth(req);
    await registerSlashCommands();
    res.json({ ok: true });
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.post("/discord/test-report", async (req, res) => {
  try {
    assertWebAuth(req);
    const message = String(req.body.message || "Eccentrix Timeline Manager test report.").trim();
    if (!isConfirmedSend(req)) {
      res.json(createDiscordPreviewResponse(message, "Test Report"));
      return;
    }
    await sendDiscordReport(message);
    res.json({ ok: true, sent: true, message });
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.post("/updates", async (req, res) => {
  try {
    assertWebAuth(req);
    const update = normalizeUpdate(req.body, "web");
    const result = await handleDeveloperUpdate(update);
    res.status(201).json(result);
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.post("/feedback", async (req, res) => {
  try {
    assertWebAuth(req);
    const feedback = normalizeFeedback(req.body, "web");
    const result = await handleFeedback(feedback);
    res.status(201).json(result);
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.post("/daily-summary", async (req, res) => {
  try {
    assertWebAuth(req);
    const date = normalizeDate(req.body.date);
    const summaries = await createAllDailyReports(date);
    const report = formatDailyReportBatch(summaries);
    if (!isConfirmedSend(req)) {
      res.json({ ...createDiscordPreviewResponse(report, "Daily Summary"), summaries });
      return;
    }
    await sendDiscordReport(report);
    res.json({ ok: true, sent: true, summaries, report });
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.post("/weekly-goal", async (req, res) => {
  try {
    assertWebAuth(req);
    const project = req.body.project ? resolveProject(req.body.project) : null;
    const result = await createWeeklyGoalReport(project?.key);
    if (!isConfirmedSend(req)) {
      res.json(createDiscordPreviewResponse(result, "Weekly Goal"));
      return;
    }
    await sendDiscordReport(result);
    res.json({ ok: true, sent: true, report: result });
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.post("/weekly-target", async (req, res) => {
  try {
    assertWebAuth(req);
    const result = await handleWeeklyTarget(normalizeWeeklyTarget(req.body, "web"));
    res.status(201).json(result);
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.post("/weekly-plan", async (req, res) => {
  try {
    assertWebAuth(req);
    const project = req.body.project ? resolveProject(req.body.project) : null;
    const weekStart = normalizeWeekStart(req.body.weekStart || req.body.week);
    const result = await createAndSaveWeeklyPlan(project?.key, weekStart, "web:/weekly-plan");
    res.status(201).json(result);
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.post("/milestone", async (req, res) => {
  try {
    assertWebAuth(req);
    const result = await createMilestoneReport();
    if (!isConfirmedSend(req)) {
      res.json(createDiscordPreviewResponse(result, "Milestone"));
      return;
    }
    await sendDiscordReport(result);
    res.json({ ok: true, sent: true, report: result });
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.post("/timeline-analysis", async (req, res) => {
  try {
    assertWebAuth(req);
    const result = await createCurrentTimelineAnalysisReport();
    if (!isConfirmedSend(req)) {
      res.json(createDiscordPreviewResponse(result, "Timeline Analysis"));
      return;
    }
    await sendDiscordReport(result);
    res.json({ ok: true, sent: true, report: result });
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.post("/assistant/chat", async (req, res) => {
  try {
    assertWebAuth(req);
    const result = await handleAssistantChat(req.body);
    res.json(result);
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.get("/daily-tasks", (req, res) => {
  try {
    assertWebAuth(req);
    const date = normalizeDate(req.query.date);
    const cached = getCachedDailyTaskBoard(date);
    res.json(cached || {
      ok: true,
      cached: false,
      date,
      message: "No saved daily task board for this date. Press Re-gen to create one.",
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.post("/daily-tasks", async (req, res) => {
  try {
    assertWebAuth(req);
    const date = normalizeDate(req.body.date);
    const regenerate = req.body.regenerate === true;
    const result = regenerate
      ? await createDailyTaskBoard(date)
      : getCachedDailyTaskBoard(date);
    res.json(result || {
      ok: true,
      cached: false,
      date,
      message: "No saved daily task board for this date. Send regenerate=true to create one.",
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.post("/daily-task-submit", async (req, res) => {
  try {
    assertWebAuth(req);
    const result = await handleDailyTaskSubmission(req.body);
    res.status(201).json(result);
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.get("/milestone-review", (req, res) => {
  try {
    assertWebAuth(req);
    const date = normalizeDate(req.query.date);
    const cached = getCachedMilestoneReview(date);
    res.json(cached || {
      ok: true,
      cached: false,
      date,
      message: "No saved milestone review for this date. Press Re-gen to create one.",
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.post("/milestone-review", async (req, res) => {
  try {
    assertWebAuth(req);
    const date = normalizeDate(req.body.date);
    const regenerate = req.body.regenerate === true;
    const result = regenerate
      ? await createMilestoneReview(date)
      : getCachedMilestoneReview(date);
    res.json(result || {
      ok: true,
      cached: false,
      date,
      message: "No saved milestone review for this date. Send regenerate=true to create one.",
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.get("/cron/daily-report", async (req, res) => {
  try {
    assertCronAuth(req);
    const summaries = await createAllDailyReports(todayBangkok());
    await sendDiscordReport(formatDailyReportBatch(summaries));
    res.json({ ok: true, summaries });
  } catch (error) {
    sendHttpError(res, error);
  }
});

if (require.main === module) {
  app.listen(env.port, () => {
    console.log(`Timeline updater listening on http://localhost:${env.port}`);
  });

  if (env.enableDiscordBot) {
    startDiscordBot().catch((error) => {
      console.error("Discord bot failed to start:", error.message);
    });
  } else {
    console.log("Discord gateway bot is disabled. Set ENABLE_DISCORD_BOT=true to run it locally.");
  }
}

async function handleDeveloperUpdate(update) {
  validateRuntimeConfig();
  update.developer = normalizePersonName(update.developer);

  const analysis = await analyzeWithGrok(update);
  const project = resolveProject(update.project || analysis.project);
  update.project = project.key;

  const sheets = await getSheetsClient();
  await ensureHeader(sheets, project, project.sheetName, TIMELINE_HEADERS);
  await appendTimelineRow(sheets, project, update, analysis);

  return {
    ok: true,
    update,
    project,
    analysis,
  };
}

async function handleAssistantTimelineUpdate(update) {
  validateRuntimeConfig();
  update.developer = normalizePersonName(update.developer || "Unknown");
  update.text = String(update.text || update.message || update.update || "").trim();
  update.date = normalizeDate(update.date);

  if (!update.text) {
    const error = new Error("Missing update text");
    error.statusCode = 400;
    throw error;
  }

  const analysis = await analyzeWithGrok(update);
  const project = resolveProject(update.project || analysis.project);
  update.project = project.key;

  const sheets = await getSheetsClient();
  await ensureHeader(sheets, project, project.sheetName, TIMELINE_HEADERS);

  const rows = await readRows(sheets, project, project.sheetName, "A:K");
  const existingRows = rows
    .slice(1)
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter((item) => isMeaningfulTimelineRow(item.row))
    .slice(-Math.max(1, env.timelineContextLimit || 1000))
    .map((item) => timelineRowToObject(item));

  const decision = await decideTimelineUpdateTargetWithGrok(project, update, analysis, existingRows);
  let patchUpdates = normalizeTimelinePatchUpdates(decision.updates);
  if (decision.mode === "patch" && patchUpdates.length === 0) {
    const rowNumber = inferTimelinePatchRowNumber(decision, existingRows, update, analysis);
    patchUpdates = rowNumber ? buildDefaultTimelinePatchUpdates(rowNumber, update, analysis) : [];
  }

  if (decision.mode === "patch" && patchUpdates.length > 0) {
    const patchResult = await patchSheetCellsFromAction({
      project: project.key,
      sheet: "timeline",
      updates: patchUpdates,
    });

    return {
      ok: true,
      mode: "updated_existing",
      project,
      update,
      analysis,
      decision,
      patchResult,
    };
  }

  await appendTimelineRow(sheets, project, update, analysis);

  return {
    ok: true,
    mode: "created_new",
    project,
    update,
    analysis,
    decision,
  };
}

async function handleFeedback(feedback) {
  validateRuntimeConfig();
  feedback.developer = normalizePersonName(feedback.developer);

  const project = resolveProject(feedback.project);
  const analysis = await analyzeFeedbackWithGrok(project, feedback);
  const sheets = await getSheetsClient();

  await ensureHeader(sheets, project, project.feedbackSheetName, FEEDBACK_HEADERS);
  await appendFeedbackRow(sheets, project, feedback, analysis);

  return {
    ok: true,
    project,
    feedback,
    analysis,
  };
}

async function handleWeeklyTarget(target) {
  validateRuntimeConfig();

  const project = resolveProject(target.project);
  const sheets = await getSheetsClient();
  const context = await buildProjectManagementContext(sheets, project, target.weekStart);
  const aiTarget = await refineWeeklyTargetWithGrok(project, target, context);
  const plan = await createWeeklyPlanWithGrok(project, target.weekStart, aiTarget, context);

  await ensureHeader(sheets, project, project.targetSheetName, TARGET_HEADERS);
  await ensureHeader(sheets, project, project.planSheetName, PLAN_HEADERS);
  await appendWeeklyTargetRow(sheets, project, target, aiTarget);
  await appendWeeklyPlanRows(sheets, project, target.weekStart, plan.tasks, "ai:/weekly-target");

  await appendTimelineRow(
    sheets,
    project,
    {
      date: target.weekStart,
      developer: "ทีน / AI Project Manager",
      text: `Weekly target set by ${target.owner}: ${target.text}`,
      project: project.key,
      source: target.source,
    },
    {
      summary: aiTarget.refinedTarget,
      completed: [],
      inProgress: plan.tasks.map((task) => `${task.assignee}: ${task.task}`),
      blockers: aiTarget.risks,
      nextSteps: plan.tasks.map((task) => task.successCriteria).filter(Boolean),
      tags: ["weekly-target", "ai-manager"],
      confidence: aiTarget.confidence,
    },
  );

  return {
    ok: true,
    project,
    target,
    aiTarget,
    plan,
  };
}

async function handleAssistantChat(body) {
  validateRuntimeConfig();

  const message = String(body.message || body.text || "").trim();
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const projectKey = normalizeProjectKey(body.project || "");

  if (!message) {
    const error = new Error("Missing chat message");
    error.statusCode = 400;
    throw error;
  }

  const sheets = await getSheetsClient();
  const weekStart = currentWeekStartBangkok();
  const projects = projectKey ? [resolveProject(projectKey)] : Object.values(PROJECTS);
  const context = [];

  for (const project of projects) {
    context.push(await buildProjectManagementContext(sheets, project, weekStart));
  }
  const contextSummary = summarizeProjectContexts(context);

  const response = await grok.chat.completions.create({
    model: env.grokModel,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          PM_ASSISTANT_SYSTEM_PROMPT,
          "Return only valid JSON with keys: reply, actions, visualProgressOverview.",
          "actions must be an array. Only include actions when the user clearly asks to save, update, create, register, send, or generate something.",
          "Supported action types: save_update, save_feedback, set_weekly_target, generate_weekly_plan, update_timeline_field, patch_sheet_cells, send_discord_report.",
          "For save_update use fields: project, developer, text, date.",
          "When the user asks to update a timeline from a progress paragraph, search the provided timeline rows first. If an existing row is related by task, feature, developer, system, art area, blocker, next step, or date, use patch_sheet_cells for that row. Use save_update only when no related timeline row exists.",
          "For save_feedback use fields: project, developer, text, date.",
          "For set_weekly_target use fields: project, owner, target, weekStart.",
          "For generate_weekly_plan use fields: project, weekStart. project may be empty for both projects.",
          "For update_timeline_field use fields: project, field, value, scope. Allowed timeline fields: ID, Rock, Priority, Task, Start, End, Blockers, Percent, Response, Sub Response, Status&LateDay. scope can be all or meaningful_rows. project may be empty for both projects.",
          "For patch_sheet_cells use fields: project, sheet, updates. sheet can be timeline, feedback, targets, or plan. updates is an array of { rowNumber, field, value }. rowNumber is the Google Sheet row number provided in context rows. timeline field must be one of ID, Rock, Priority, Task, Start, End, Blockers, Percent, Response, Sub Response, Status&LateDay.",
          "Use patch_sheet_cells when you need to edit many specific timeline rows after analyzing the full sheet context. Keep updates focused and do not edit Date, Source, or Created At unless the user explicitly asks.",
          "For send_discord_report use field: message.",
          "Never claim Google Sheets were edited unless you include the exact edit action in actions. If you only analyzed data, say that no sheet edit was performed.",
          "If a required field is missing, do not create the action; ask a concise follow-up in reply.",
          "When answering timeline questions, rely on the provided projects context. If contextSummary shows zero recentTimeline rows, clearly say the timeline was not loaded and suggest checking sheet tab names and sheet IDs.",
          "The user may write in Thai, English, or mixed language. Understand Thai normally, but reply and visualProgressOverview must be English only.",
          "Do not translate action values that will be written to Google Sheets; preserve the source language for saved timeline, feedback, target, and plan content.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          today: todayBangkok(),
          weekStart,
          contextSummary,
          projects: context,
          chatHistory: history,
          userMessage: message,
        }),
      },
    ],
  });

  const parsed = parseJsonObject(response.choices?.[0]?.message?.content);
  let actions = Array.isArray(parsed.actions) ? parsed.actions : [];
  if (actions.length === 0) {
    actions = inferAssistantActionsFromMessage(message, projectKey);
  }
  const appliedActions = await executeAssistantActions(actions, { confirmSend: isConfirmedSend({ body }) });
  const discordPreview = appliedActions.find((action) => action.requiresConfirmation);

  return {
    ok: true,
    ...(discordPreview
      ? createDiscordPreviewResponse(discordPreview.preview, "AI Chat Discord Report")
      : {}),
    reply: buildAssistantReply(parsed.reply, actions, appliedActions),
    contextSummary,
    visualProgressOverview: parsed.visualProgressOverview || null,
    actionsRequested: actions,
    actionsApplied: appliedActions,
  };
}

async function createDailyTaskBoard(date = todayBangkok()) {
  validateRuntimeConfig();

  const sheets = await getSheetsClient();
  const weekStart = normalizeWeekStart(date);
  const contexts = [];

  for (const project of Object.values(PROJECTS)) {
    contexts.push(await buildFullDailyTaskContext(sheets, project, weekStart, date));
  }

  const response = await grok.chat.completions.create({
    model: env.grokModel,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          PM_ASSISTANT_SYSTEM_PROMPT,
          "Create a daily work board for a small game team every morning at 06:00 Bangkok time.",
          "The timeline sheet header schema is fixed and must be interpreted exactly as: ID, Rock, Priority, Task, Start, End, Blockers, Percent, Response, Sub Response, Status&LateDay.",
          "Never ask to edit, rename, insert, delete, or overwrite these headers.",
          "You must inspect 100% of the provided fullTimeline rows for both projects before assigning tasks.",
          "Do not rely only on recent rows. Use rowCounts to confirm timelineSentToAi equals meaningfulTimeline for each project.",
          "scheduleSignals is precomputed by the backend from the full timeline. Overdue, dueSoon, activeWindow, blocked, and lowProgressDeadline rows must be considered high priority evidence.",
          "First analyze project problems, blockers, stale work, dependencies, owner workload, dates, time pressure, and deadline risk from every available timeline column.",
          "Use Start as the planned start date, End as the deadline/end date, Percent as completion percentage, Blockers as blocking issues, Priority as urgency, Task as the work item, Response/Sub Response as owner or response context, and Status&LateDay as late/status signal.",
          "Generate daily tasks only after that analysis. Today tasks must be tied to deadline pressure, carry-over risk, blockers, scheduleSignals, or current plan priorities.",
          "If scheduleSignals has overdue or dueSoon rows, include them in todayTasks or carryOverTasks unless they are clearly complete.",
          "Return only valid JSON with keys: headline, summary, timelineAnalysis, people.",
          "timelineAnalysis has projectFindings, deadlineRisks, blockedOrLateWork, workloadNotes, assumptions.",
          "people is an array for every active team member. Each person has member, role, focus, todayTasks, carryOverTasks, advanceTasks, risks.",
          "Each task has id, project, title, why, targetPercent, currentPercent, priority, timelineRowNumber.",
          "todayTasks are tasks that should be completed today or should reach a target percent today.",
          "carryOverTasks are unfinished tasks from previous days.",
          "advanceTasks are recommended ahead-of-schedule tasks for spare time.",
          "Use timelineRowNumber when a task maps to a provided timeline row; otherwise use null.",
          "The why field must briefly mention the timeline evidence, deadline, blocker, or date reason used.",
          "Percent values must be numbers from 0 to 100. Keep Thai task wording when the sheet context is Thai.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          today: date,
          morningReviewTime: env.dailyTaskTime,
          team: teamPromptData(),
          projects: contexts,
          contextSummary: summarizeProjectContexts(contexts),
          scheduleSignals: contexts.map((context) => context.scheduleSignals),
        }),
      },
    ],
  });

  const parsed = parseJsonObject(response.choices?.[0]?.message?.content);
  const people = normalizeDailyTaskPeople(parsed.people);

  const result = {
    ok: true,
    cached: false,
    date,
    generatedAt: new Date().toISOString(),
    morningReviewTime: env.dailyTaskTime,
    headline: String(parsed.headline || "Daily task board").trim(),
    summary: String(parsed.summary || "").trim(),
    timelineAnalysis: parsed.timelineAnalysis || null,
    people,
    contextSummary: summarizeProjectContexts(contexts),
    scheduleSignals: contexts.map((context) => context.scheduleSignals),
  };

  dailyTaskCache.set(date, result);
  return result;
}

async function handleDailyTaskSubmission(body) {
  validateRuntimeConfig();

  const date = normalizeDate(body.date);
  const developer = normalizePersonName(body.developer || body.member || body.name || "Unknown");
  const note = String(body.note || body.text || body.message || "").trim();
  const progressItems = normalizeDailyProgressItems(body.progressItems);

  if (progressItems.length === 0 && !note) {
    const error = new Error("Missing progress items or note");
    error.statusCode = 400;
    throw error;
  }

  const sheets = await getSheetsClient();
  const weekStart = normalizeWeekStart(date);
  const contexts = [];

  for (const project of Object.values(PROJECTS)) {
    contexts.push(await buildProjectManagementContext(sheets, project, weekStart));
  }

  const response = await grok.chat.completions.create({
    model: env.grokModel,
    temperature: 0.15,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          PM_ASSISTANT_SYSTEM_PROMPT,
          "Convert a daily task submission into focused Google Sheet updates.",
          "Return only valid JSON with keys: reply, actions, visualProgressOverview.",
          "Supported actions: patch_sheet_cells and save_update.",
          "Prefer patch_sheet_cells when the submitted item has a valid project and timelineRowNumber.",
          "For patch_sheet_cells use project, sheet='timeline', updates with rowNumber, field, value.",
          "Timeline headers are fixed: ID, Rock, Priority, Task, Start, End, Blockers, Percent, Response, Sub Response, Status&LateDay.",
          "Never edit row 1 or any timeline header. Useful editable timeline fields are Blockers, Percent, Response, Sub Response, and Status&LateDay.",
          "Use save_update when progress cannot be mapped to an existing row.",
          "Keep updates concise. Preserve Thai wording from the submission when writing to sheets.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          date,
          developer,
          note,
          progressItems,
          team: teamPromptData(),
          projects: contexts,
          contextSummary: summarizeProjectContexts(contexts),
        }),
      },
    ],
  });

  const parsed = parseJsonObject(response.choices?.[0]?.message?.content);
  const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
  const appliedActions = await executeAssistantActions(actions, { confirmSend: false });

  return {
    ok: true,
    date,
    developer,
    reply: buildAssistantReply(parsed.reply, actions, appliedActions),
    visualProgressOverview: parsed.visualProgressOverview || null,
    actionsRequested: actions,
    actionsApplied: appliedActions,
  };
}

async function createMilestoneReview(date = todayBangkok()) {
  validateRuntimeConfig();

  const sheets = await getSheetsClient();
  const weekStart = normalizeWeekStart(date);
  const contexts = [];

  for (const project of Object.values(PROJECTS)) {
    contexts.push(await buildFullDailyTaskContext(sheets, project, weekStart, date));
  }

  const response = await grok.chat.completions.create({
    model: env.grokModel,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          PM_ASSISTANT_SYSTEM_PROMPT,
          "Create a milestone review for both game projects at the same 06:00 Bangkok morning review time as Daily Tasks.",
          "The timeline sheet header schema is fixed and must be interpreted exactly as: ID, Rock, Priority, Task, Start, End, Blockers, Percent, Response, Sub Response, Status&LateDay.",
          "Never ask to edit, rename, insert, delete, or overwrite these headers.",
          "You must inspect 100% of each project's provided fullTimeline rows before estimating milestone progress.",
          "scheduleSignals is precomputed by the backend from the full timeline. Use it to identify late, due soon, blocked, low progress, and currently scheduled milestone work.",
          "Use Start as the planned start date, End as the deadline/end date, Percent as completion percentage, Blockers as blocking issues, Priority as urgency, Task as the work item, Rock as milestone/rock grouping, Response/Sub Response as owner or response context, and Status&LateDay as late/status signal.",
          "Analyze current milestone progress, actual completion percentage, schedule pressure, deadline risk, blockers, smooth areas, and next recommendations.",
          "Do not claim a percentage without explaining the evidence used from the timeline.",
          "Return only valid JSON with keys: headline, summary, overallPercent, projects, concerns, smoothAreas, recommendations.",
          "projects is an array with projectKey, project, currentMilestone, percentComplete, status, deadlineStatus, concerns, smoothAreas, evidenceRows, nextReviewFocus.",
          "status must be one of: smooth, watch, risk, blocked.",
          "deadlineStatus should explain whether timing is on track, tight, late, unknown, or blocked.",
          "evidenceRows is an array of Google Sheet row numbers used as evidence.",
          "Percent values must be numbers from 0 to 100. Keep Thai wording when the sheet context is Thai.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          today: date,
          morningReviewTime: env.dailyTaskTime,
          team: teamPromptData(),
          projects: contexts,
          contextSummary: summarizeProjectContexts(contexts),
          scheduleSignals: contexts.map((context) => context.scheduleSignals),
        }),
      },
    ],
  });

  const parsed = parseJsonObject(response.choices?.[0]?.message?.content);
  const projects = normalizeMilestoneProjects(parsed.projects);

  const result = {
    ok: true,
    cached: false,
    date,
    generatedAt: new Date().toISOString(),
    morningReviewTime: env.dailyTaskTime,
    headline: String(parsed.headline || "Milestone Review").trim(),
    summary: String(parsed.summary || "").trim(),
    overallPercent: clampPercent(parsed.overallPercent ?? averagePercent(projects)),
    projects,
    concerns: asArray(parsed.concerns),
    smoothAreas: asArray(parsed.smoothAreas),
    recommendations: asArray(parsed.recommendations),
    contextSummary: summarizeProjectContexts(contexts),
    scheduleSignals: contexts.map((context) => context.scheduleSignals),
  };

  milestoneReviewCache.set(date, result);
  return result;
}

async function executeAssistantActions(actions, options = {}) {
  const results = [];

  for (const action of actions.slice(0, 5)) {
    const type = String(action.type || "").trim();

    if (type === "save_update") {
      const result = await handleAssistantTimelineUpdate({
        project: action.project,
        developer: action.developer || action.name || "Unknown",
        text: action.text || action.message || action.update,
        date: normalizeDate(action.date),
        source: "assistant-chat:/save_update",
      });
      results.push({
        type,
        ok: true,
        project: result.project.label,
        summary: result.analysis.summary,
        mode: result.mode,
        editedCells: result.patchResult?.editedCells || 0,
      });
      continue;
    }

    if (type === "save_feedback") {
      const result = await handleFeedback({
        project: action.project,
        developer: action.developer || action.name || "Unknown",
        text: action.text || action.message || action.feedback,
        date: normalizeDate(action.date),
        source: "assistant-chat:/save_feedback",
      });
      results.push({ type, ok: true, project: result.project.label, summary: result.analysis.summary });
      continue;
    }

    if (type === "set_weekly_target") {
      const result = await handleWeeklyTarget(normalizeWeeklyTarget({
        project: action.project,
        owner: action.owner,
        target: action.target || action.text || action.message,
        weekStart: action.weekStart || action.week,
      }, "assistant-chat:/set_weekly_target"));
      results.push({ type, ok: true, project: result.project.label, target: result.aiTarget.refinedTarget });
      continue;
    }

    if (type === "generate_weekly_plan") {
      const project = action.project ? resolveProject(action.project) : null;
      const weekStart = normalizeWeekStart(action.weekStart || action.week);
      const result = await createAndSaveWeeklyPlan(project?.key, weekStart, "assistant-chat:/generate_weekly_plan");
      results.push({ type, ok: true, weekStart: result.weekStart, projects: result.results.map((item) => item.project) });
      continue;
    }

    if (type === "update_timeline_field") {
      const result = await updateTimelineFieldFromAction(action);
      results.push({ type, ok: true, ...result });
      continue;
    }

    if (type === "patch_sheet_cells") {
      const result = await patchSheetCellsFromAction(action);
      results.push({ type, ok: true, ...result });
      continue;
    }

    if (type === "send_discord_report") {
      const message = String(action.message || "").trim();
      if (!message) continue;
      if (!options.confirmSend) {
        results.push({ type, ok: false, requiresConfirmation: true, preview: message });
        continue;
      }
      await sendDiscordReport(message);
      results.push({ type, ok: true });
    }
  }

  return results;
}

async function updateTimelineFieldFromAction(action) {
  const field = resolveTimelineEditField(action.field || action.column || action.header);
  const value = String(action.value ?? "").trim();
  const scope = String(action.scope || "meaningful_rows").trim().toLowerCase();
  const targetProjects = action.project ? [resolveProject(action.project)] : Object.values(PROJECTS);
  const sheets = await getSheetsClient();
  const projects = [];

  if (!field) {
    const error = new Error("Unsupported timeline field for edit");
    error.statusCode = 400;
    throw error;
  }

  for (const project of targetProjects) {
    await ensureHeader(sheets, project, project.sheetName, TIMELINE_HEADERS);
    const rows = await readRows(sheets, project, project.sheetName, "A:K");
    const rowIndexes = rows
      .slice(1)
      .map((row, index) => ({ row, sheetRow: index + 2 }))
      .filter((item) => scope === "all" || isMeaningfulTimelineRow(item.row))
      .map((item) => item.sheetRow);

    if (rowIndexes.length > 0) {
      await updateSingleColumnRows(sheets, project, project.sheetName, field.column, rowIndexes, value);
    }

    projects.push({
      key: project.key,
      label: project.label,
      field: field.header,
      value,
      scope,
      editedCells: rowIndexes.length,
    });
  }

  return {
    field: field.header,
    value,
    scope,
    projects,
    editedCells: projects.reduce((total, project) => total + project.editedCells, 0),
  };
}

async function patchSheetCellsFromAction(action) {
  const project = resolveProject(action.project);
  const sheetInfo = resolveEditableSheet(project, action.sheet || action.tab || "timeline");
  const rawUpdates = Array.isArray(action.updates) ? action.updates : [];
  const updates = rawUpdates
    .map((update) => normalizeSheetCellPatch(update, sheetInfo))
    .filter(Boolean);

  if (updates.length === 0) {
    const error = new Error("No valid sheet cell updates to apply");
    error.statusCode = 400;
    throw error;
  }

  const sheets = await getSheetsClient();
  await ensureHeader(sheets, project, sheetInfo.sheetName, sheetInfo.headers);

  await batchUpdateValueRanges(
    sheets,
    project.spreadsheetId,
    updates.map((update) => ({
      range: `${quoteSheet(sheetInfo.sheetName)}!${update.column}${update.rowNumber}`,
      values: [[update.value]],
    })),
  );

  return {
    project: project.label,
    sheet: sheetInfo.sheetName,
    editedCells: updates.length,
    updatedFields: [...new Set(updates.map((update) => update.header))],
    firstUpdates: updates.slice(0, 10).map((update) => ({
      rowNumber: update.rowNumber,
      field: update.header,
      value: update.value,
    })),
  };
}

function normalizeSheetCellPatch(update, sheetInfo) {
  const rowNumber = Number(update.rowNumber || update.row || update.sheetRow);
  const field = resolveSheetField(sheetInfo.headers, update.field || update.column || update.header);

  if (!Number.isInteger(rowNumber) || rowNumber < 2 || !field) return null;
  if (sheetInfo.headers === TIMELINE_HEADERS && !TIMELINE_HEADERS.includes(field.header)) return null;

  return {
    rowNumber,
    column: columnLetter(field.index + 1),
    header: field.header,
    value: String(update.value ?? ""),
  };
}

function normalizeTimelinePatchUpdates(updates) {
  const allowedFields = new Set([
    "ID",
    "Rock",
    "Priority",
    "Task",
    "Start",
    "End",
    "Blockers",
    "Percent",
    "Response",
    "Sub Response",
    "Status&LateDay",
  ]);

  return (Array.isArray(updates) ? updates : [])
    .map((update) => {
      const field = resolveSheetField(TIMELINE_HEADERS, update.field || update.column || update.header);
      const rowNumber = Number(update.rowNumber || update.row || update.sheetRow);
      if (!Number.isInteger(rowNumber) || rowNumber < 2 || !field || !allowedFields.has(field.header)) {
        return null;
      }

      return {
        rowNumber,
        field: field.header,
        value: String(update.value ?? ""),
      };
    })
    .filter(Boolean);
}

function inferTimelinePatchRowNumber(decision, existingRows, update, analysis) {
  const explicitRow = (Array.isArray(decision.updates) ? decision.updates : [])
    .map((item) => Number(item.rowNumber || item.row || item.sheetRow))
    .find((rowNumber) => Number.isInteger(rowNumber) && rowNumber >= 2);
  if (explicitRow) return explicitRow;

  const incomingText = [
    update.developer,
    update.text,
    analysis.summary,
    ...analysis.completed,
    ...analysis.inProgress,
    ...analysis.blockers,
    ...analysis.nextSteps,
    ...analysis.tags,
  ].join(" ");
  const incomingTokens = tokenizeForTimelineMatch(incomingText);
  let best = { rowNumber: 0, score: 0 };

  for (const row of existingRows) {
    const rowText = [
      row.developer,
      row.rawUpdate,
      row.summary,
      row.completed,
      row.inProgress,
      row.blockers,
      row.nextSteps,
      row.tags,
    ].join(" ");
    const rowTokens = tokenizeForTimelineMatch(rowText);
    const score = [...incomingTokens].reduce(
      (total, token) => total + (rowTokens.has(token) ? 1 : 0),
      0,
    );
    if (score > best.score) best = { rowNumber: row.rowNumber, score };
  }

  return best.score >= 2 ? best.rowNumber : 0;
}

function buildDefaultTimelinePatchUpdates(rowNumber, update, analysis) {
  return [
    { rowNumber, field: "Task", value: analysis.summary || update.text },
    { rowNumber, field: "Start", value: update.date },
    { rowNumber, field: "Blockers", value: analysis.blockers.join("\n") },
    { rowNumber, field: "Response", value: update.developer },
    { rowNumber, field: "Sub Response", value: [
      update.text,
      analysis.completed.length ? `Completed: ${analysis.completed.join("; ")}` : "",
      analysis.inProgress.length ? `In Progress: ${analysis.inProgress.join("; ")}` : "",
      analysis.nextSteps.length ? `Next: ${analysis.nextSteps.join("; ")}` : "",
    ].filter(Boolean).join("\n") },
    { rowNumber, field: "Status&LateDay", value: analysis.tags.join(", ") || update.source || "" },
  ];
}

function tokenizeForTimelineMatch(value) {
  const normalized = String(value || "").toLowerCase();
  const tokens = normalized.match(/[a-z0-9ก-๙]{3,}/g) || [];
  return new Set(tokens);
}

function resolveEditableSheet(project, value) {
  const key = String(value || "").trim().toLowerCase();
  const sheets = {
    timeline: { sheetName: project.sheetName, headers: TIMELINE_HEADERS },
    main: { sheetName: project.sheetName, headers: TIMELINE_HEADERS },
    feedback: { sheetName: project.feedbackSheetName, headers: FEEDBACK_HEADERS },
    targets: { sheetName: project.targetSheetName, headers: TARGET_HEADERS },
    weeklytargets: { sheetName: project.targetSheetName, headers: TARGET_HEADERS },
    target: { sheetName: project.targetSheetName, headers: TARGET_HEADERS },
    plan: { sheetName: project.planSheetName, headers: PLAN_HEADERS },
    weeklyplan: { sheetName: project.planSheetName, headers: PLAN_HEADERS },
  };

  const info = sheets[key.replace(/[\s_-]/g, "")] || sheets[key] || sheets.timeline;
  return { ...info };
}

function resolveSheetField(headers, value) {
  const input = normalizeFieldName(value);
  if (!input) return null;

  const aliases = {
    rawupdate: "Task",
    update: "Task",
    message: "Task",
    inprogress: "Status&LateDay",
    progress: "Percent",
    percent: "Percent",
    blockers: "Blockers",
    blocker: "Blockers",
    nextsteps: "Sub Response",
    next: "Sub Response",
    response: "Response",
    subresponse: "Sub Response",
    status: "Status&LateDay",
    late: "Status&LateDay",
    createdat: "Created At",
    weeklytarget: "AI Refined Target",
    target: "AI Refined Target",
    task: "Task",
    priority: "Priority",
  };
  const canonical = aliases[input] || value;
  const normalizedCanonical = normalizeFieldName(canonical);
  const index = headers.findIndex((header) => normalizeFieldName(header) === normalizedCanonical);

  if (index < 0) return null;
  return { index, header: headers[index] };
}

function normalizeFieldName(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9ก-๙]/g, "");
}

async function updateSingleColumnRows(sheets, project, sheetName, column, rowIndexes, value) {
  const ranges = contiguousRowRanges(rowIndexes).map((range) => ({
    range: `${quoteSheet(sheetName)}!${column}${range.start}:${column}${range.end}`,
    values: Array.from({ length: range.end - range.start + 1 }, () => [value]),
  }));

  if (ranges.length === 0) return;

  await batchUpdateValueRanges(sheets, project.spreadsheetId, ranges);
}

async function batchUpdateValueRanges(sheets, spreadsheetId, ranges) {
  const chunkSize = 500;
  for (let index = 0; index < ranges.length; index += chunkSize) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: ranges.slice(index, index + chunkSize),
      },
    });
  }
}

function contiguousRowRanges(rowIndexes) {
  const sorted = [...rowIndexes].sort((a, b) => a - b);
  const ranges = [];

  for (const row of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && row === last.end + 1) {
      last.end = row;
    } else {
      ranges.push({ start: row, end: row });
    }
  }

  return ranges;
}

function resolveTimelineEditField(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[_-]/g, " ");
  const compact = key.replace(/\s+/g, "");
  return TIMELINE_EDIT_FIELDS[key] || TIMELINE_EDIT_FIELDS[compact] || null;
}

function inferAssistantActionsFromMessage(message, projectKey) {
  const text = String(message || "").toLowerCase();
  const asksToEdit = /(ปรับ|แก้|เปลี่ยน|set|update|change|make)/i.test(message);
  const mentionsBlocker = text.includes("blocker") || text.includes("blockers") || message.includes("บล็อก") || message.includes("ติด");
  const mentionsZero = /(^|\D)0($|\D)/.test(message) || message.includes("ศูนย์");
  const mentionsAll = message.includes("ทั้งหมด") || text.includes("all");

  if (asksToEdit && mentionsBlocker && mentionsZero && mentionsAll) {
    return [{
      type: "update_timeline_field",
      project: projectKey || "",
      field: "blockers",
      value: "0",
      scope: "meaningful_rows",
    }];
  }

  return [];
}

function buildAssistantReply(reply, actions, appliedActions) {
  const text = String(reply || "").trim();
  if (appliedActions.length > 0) return text || "Sheet update completed.";
  if (actions.length > 0) return text || "No sheet changes were applied.";
  if (/แก้|ปรับ|เปลี่ยน|updated|changed|บันทึก|save/i.test(text)) {
    return `${text}\n\nNote: No Google Sheets edit action was applied by the backend.`;
  }
  return text || "Done.";
}

function summarizeProjectContexts(contexts) {
  return contexts.map((context) => ({
    project: context.project,
    weekStart: context.weekStart,
    timelineTotalCount: context.rowCounts.timeline,
    timelineMeaningfulCount: context.rowCounts.meaningfulTimeline,
    timelineSentToAi: context.rowCounts.timelineSentToAi,
    timelineContextLimit: context.rowCounts.timelineContextLimit,
    fullTimelineCount: context.fullTimeline?.length || 0,
    recentTimelineCount: context.recentTimeline.length,
    scheduleSignalCount: context.scheduleSignals
      ? context.scheduleSignals.overdue.length
        + context.scheduleSignals.dueSoon.length
        + context.scheduleSignals.activeWindow.length
        + context.scheduleSignals.blocked.length
        + context.scheduleSignals.lowProgressDeadline.length
      : 0,
    timelineHeaderMatchesExpected: context.timelineHeaderMatchesExpected ?? null,
    feedbackTotalCount: context.rowCounts.feedback,
    openFeedbackCount: context.openFeedback.length,
    weeklyTargetTotalCount: context.rowCounts.weeklyTargets,
    weeklyTargetCount: context.weeklyTargets.length,
    weeklyPlanTotalCount: context.rowCounts.weeklyPlan,
    currentPlanCount: context.currentPlan.length,
    latestTimeline: context.recentTimeline.slice(-3).map((row) => ({
      rowNumber: row.rowNumber,
      date: row.date,
      developer: row.developer,
      summary: row.summary || row.rawUpdate,
      blockers: row.blockers,
      nextSteps: row.nextSteps,
    })),
  }));
}

async function analyzeWithGrok(update) {
  const response = await grok.chat.completions.create({
    model: env.grokModel,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `${PM_ASSISTANT_SYSTEM_PROMPT}\n\nTurn messy developer daily updates into concise timeline data. Return only valid JSON.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          instruction:
            "Analyze this work update. Keep Thai if the source is Thai. Output keys: project, summary, completed, inProgress, blockers, nextSteps, tags, confidence. Project must be dynozoic or eaa. Use arrays for completed/inProgress/blockers/nextSteps/tags. confidence is 0-1.",
          projects: projectPromptData(),
          team: teamPromptData(update.project),
          developer: update.developer,
          date: update.date,
          project: update.project,
          rawUpdate: update.text,
        }),
      },
    ],
  });

  const parsed = parseJsonObject(response.choices?.[0]?.message?.content);

  return {
    project: normalizeProjectKey(parsed.project),
    summary: String(parsed.summary || "").trim(),
    completed: asArray(parsed.completed),
    inProgress: asArray(parsed.inProgress),
    blockers: asArray(parsed.blockers),
    nextSteps: asArray(parsed.nextSteps),
    tags: asArray(parsed.tags),
    confidence: Number(parsed.confidence || 0),
  };
}

async function decideTimelineUpdateTargetWithGrok(project, update, analysis, existingRows) {
  if (existingRows.length === 0) {
    return { mode: "append", reason: "No existing timeline rows were available.", updates: [] };
  }

  const response = await grok.chat.completions.create({
    model: env.grokModel,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          PM_ASSISTANT_SYSTEM_PROMPT,
          "Decide whether a new progress update should update existing timeline rows or create a new row.",
          "Prefer mode patch when any existing row is related by task, feature, developer, system, art area, blocker, next step, date, or milestone.",
          "Use mode append only when no existing row is genuinely related.",
          "Return only valid JSON with keys: mode, reason, updates.",
          "mode must be patch or append.",
          "updates is an array of { rowNumber, field, value } using rowNumber from existingRows.",
          "Allowed timeline fields: ID, Rock, Priority, Task, Start, End, Blockers, Percent, Response, Sub Response, Status&LateDay.",
          "Never edit row 1 or any header. Keep Thai when the input is Thai.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          project: project.label,
          incomingUpdate: {
            date: update.date,
            developer: update.developer,
            rawUpdate: update.text,
            summary: analysis.summary,
            completed: analysis.completed,
            inProgress: analysis.inProgress,
            blockers: analysis.blockers,
            nextSteps: analysis.nextSteps,
            tags: analysis.tags,
            confidence: analysis.confidence,
          },
          existingRows,
        }),
      },
    ],
  });

  const parsed = parseJsonObject(response.choices?.[0]?.message?.content);
  return {
    mode: String(parsed.mode || "").trim().toLowerCase() === "patch" ? "patch" : "append",
    reason: String(parsed.reason || "").trim(),
    updates: Array.isArray(parsed.updates) ? parsed.updates : [],
  };
}

async function analyzeFeedbackWithGrok(project, feedback) {
  const response = await grok.chat.completions.create({
    model: env.grokModel,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `${PM_ASSISTANT_SYSTEM_PROMPT}\n\nAnalyze game development feedback. Return only valid JSON.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          instruction:
            "Summarize this feedback for a no-deadline feedback timeline. Output keys: summary, category, suggestedAction. Keep Thai if the source is Thai.",
          project: project.label,
          developer: feedback.developer,
          feedback: feedback.text,
        }),
      },
    ],
  });

  const parsed = parseJsonObject(response.choices?.[0]?.message?.content);
  return {
    summary: String(parsed.summary || feedback.text).trim(),
    category: String(parsed.category || "General").trim(),
    suggestedAction: String(parsed.suggestedAction || "").trim(),
  };
}

async function refineWeeklyTargetWithGrok(project, target, context) {
  const response = await grok.chat.completions.create({
    model: env.grokModel,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `${PM_ASSISTANT_SYSTEM_PROMPT}\n\nRefine weekly targets for a small game studio. Return only valid JSON.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          instruction:
            "Refine the user's weekly target into a practical project target. Output keys: refinedTarget, successCriteria, risks, confidence. successCriteria and risks are arrays. Keep Thai if input is Thai.",
          project: project.label,
          weekStart: target.weekStart,
          owner: target.owner,
          rawTarget: target.text,
          team: teamPromptData(project.key),
          context,
        }),
      },
    ],
  });

  const parsed = parseJsonObject(response.choices?.[0]?.message?.content);
  return {
    refinedTarget: String(parsed.refinedTarget || target.text).trim(),
    successCriteria: asArray(parsed.successCriteria),
    risks: asArray(parsed.risks),
    confidence: Number(parsed.confidence || 0),
  };
}

async function createWeeklyPlanWithGrok(project, weekStart, target, context) {
  const response = await grok.chat.completions.create({
    model: env.grokModel,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `${PM_ASSISTANT_SYSTEM_PROMPT}\n\nAssign weekly work by role. Return only valid JSON.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          instruction:
            "Create a realistic weekly task plan for this project based on timeline, feedback, target, and team roles. Output key tasks as an array. Each task has assignee, role, task, priority, successCriteria, dependencies, status. Only assign people whose role fits the project. Keep Thai if context is Thai.",
          project: project.label,
          weekStart,
          target,
          team: teamPromptData(project.key),
          context,
        }),
      },
    ],
  });

  const parsed = parseJsonObject(response.choices?.[0]?.message?.content);
  const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  return {
    tasks: rawTasks.map(normalizePlanTask).filter((task) => task.task),
  };
}

async function createAndSaveWeeklyPlan(projectKey = "", weekStart = currentWeekStartBangkok(), source = "web") {
  validateRuntimeConfig();

  const projects = projectKey ? [resolveProject(projectKey)] : Object.values(PROJECTS);
  const sheets = await getSheetsClient();
  const results = [];

  for (const project of projects) {
    const context = await buildProjectManagementContext(sheets, project, weekStart);
    const latestTarget = context.weeklyTargets[context.weeklyTargets.length - 1];
    const target = latestTarget
      ? {
          refinedTarget: latestTarget.refinedTarget,
          successCriteria: splitCellList(latestTarget.successCriteria),
          risks: splitCellList(latestTarget.risks),
          confidence: 0,
        }
      : {
          refinedTarget: "No weekly target set yet. Create a practical maintenance and progress plan from recent timeline.",
          successCriteria: [],
          risks: [],
          confidence: 0,
        };
    const plan = await createWeeklyPlanWithGrok(project, weekStart, target, context);

    await ensureHeader(sheets, project, project.planSheetName, PLAN_HEADERS);
    await appendWeeklyPlanRows(sheets, project, weekStart, plan.tasks, source);
    results.push({ project: project.label, weekStart, plan });
  }

  return { ok: true, weekStart, results };
}

async function createDailySummary(date = todayBangkok(), projectKey = "dynozoic") {
  validateRuntimeConfig();

  const project = resolveProject(projectKey);
  const sheets = await getSheetsClient();
    await ensureHeader(sheets, project, project.sheetName, TIMELINE_HEADERS);

  const rows = await readRows(sheets, project, project.sheetName, "A:K");
  const dataRows = rows.slice(1).filter((row) => sheetDateMatches(row[0], date));
  const openFeedback = await getOpenFeedbackRows(sheets, project);

  if (dataRows.length === 0) {
    return {
      date,
      project: project.label,
      summary: `No updates found for ${date}`,
      totalUpdates: 0,
      developers: [],
      blockers: [],
      nextSteps: [],
      openFeedback,
    };
  }

  const developers = [...new Set(dataRows.map((row) => row[1]).filter(Boolean))];
  const summaries = dataRows.map((row) => `- ${row[1]}: ${row[3]}`).join("\n");
  const blockers = splitCellList(dataRows.map((row) => row[6]).join("\n"));
  const nextSteps = splitCellList(dataRows.map((row) => row[7]).join("\n"));

  const responseAi = await grok.chat.completions.create({
    model: env.grokModel,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `${PM_ASSISTANT_SYSTEM_PROMPT}\n\nCreate a concise Thai daily production summary for Discord. Use the required daily output format when useful. Mention progress, blockers, timeline changes, deadline warnings, next priorities, and unresolved feedback reminders.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          date,
          project: project.label,
          totalUpdates: dataRows.length,
          developers,
          summaries,
          blockers,
          nextSteps,
          openFeedback,
        }),
      },
    ],
  });

  return {
    date,
    project: project.label,
    summary: responseAi.choices?.[0]?.message?.content?.trim() || summaries,
    totalUpdates: dataRows.length,
    developers,
    blockers,
    nextSteps,
    openFeedback,
  };
}

async function createAllDailyReports(date = todayBangkok()) {
  const summaries = [];
  for (const project of Object.values(PROJECTS)) {
    summaries.push(await createDailySummary(date, project.key));
  }
  return summaries;
}

async function createWeeklyGoalReport(projectKey = "") {
  validateRuntimeConfig();

  const projects = projectKey ? [resolveProject(projectKey)] : Object.values(PROJECTS);
  const snapshots = [];
  const sheets = await getSheetsClient();
  const weekStart = currentWeekStartBangkok();

  for (const project of projects) {
    const rows = await readProjectTimeline(project);
    const weekRows = rows.filter((row) => isDateInCurrentBangkokWeek(row[0]));
    const context = await buildProjectManagementContext(sheets, project, weekStart);
    const openFeedback = await getOpenFeedbackRows(sheets, project);
    snapshots.push({
      project: project.label,
      team: teamPromptData(project.key),
      savedTargets: context.weeklyTargets,
      savedPlan: context.currentPlan,
      updates: rowsToObjects(weekRows),
      openFeedback,
    });
  }

  const response = await grok.chat.completions.create({
    model: env.grokModel,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `${PM_ASSISTANT_SYSTEM_PROMPT}\n\nCreate a Thai weekly goal report for Discord. Include week targets, current progress percentage, risk, deadline warnings, visual progress overview, and next actions.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          instruction:
            "For each project, use savedTargets and savedPlan first. If missing, infer this week's target from updates and next steps. Estimate percent progress from completed vs in-progress/blockers/plan status. Keep concise.",
          weekStart,
          projects: snapshots,
        }),
      },
    ],
  });

  return response.choices?.[0]?.message?.content?.trim() || "No weekly data found.";
}

async function createMilestoneReport() {
  validateRuntimeConfig();

  const snapshots = [];
  for (const project of Object.values(PROJECTS)) {
    const rows = await readProjectTimeline(project);
    const recentRows = rows.slice(-30);
    const openFeedback = await getOpenFeedbackRows(await getSheetsClient(), project);
    snapshots.push({
      project: project.label,
      recentUpdates: rowsToObjects(recentRows),
      openFeedback,
    });
  }

  const response = await grok.chat.completions.create({
    model: env.grokModel,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `${PM_ASSISTANT_SYSTEM_PROMPT}\n\nAnalyze milestone status for Discord in Thai.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          instruction:
            "Analyze the current milestone status for both games. Include likely milestone, current state, risks, feedback impact, and recommended next move.",
          projects: snapshots,
        }),
      },
    ],
  });

  return response.choices?.[0]?.message?.content?.trim() || "No milestone data found.";
}

async function createCurrentTimelineAnalysisReport() {
  validateRuntimeConfig();

  const sheets = await getSheetsClient();
  const weekStart = currentWeekStartBangkok();
  const snapshots = [];

  for (const project of Object.values(PROJECTS)) {
    const context = await buildProjectManagementContext(sheets, project, weekStart);
    snapshots.push({
      project: project.label,
      team: teamPromptData(project.key),
      recentTimeline: context.recentTimeline,
      openFeedback: context.openFeedback,
      weeklyTargets: context.weeklyTargets,
      currentPlan: context.currentPlan,
    });
  }

  const response = await grok.chat.completions.create({
    model: env.grokModel,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `${PM_ASSISTANT_SYSTEM_PROMPT}\n\nAnalyze current game timelines for Discord in Thai.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          instruction:
            "Analyze the current timeline state for both games. Include current status, progress trend, blocked/risky areas, people who need attention, feedback pressure, and the next 3 manager actions. Keep it concise and practical.",
          date: todayBangkok(),
          weekStart,
          projects: snapshots,
        }),
      },
    ],
  });

  return response.choices?.[0]?.message?.content?.trim() || "No timeline data found.";
}

async function appendTimelineRow(sheets, project, update, analysis) {
  const values = [
    [
      `${update.date}-${Date.now()}`,
      project.label,
      "Medium",
      analysis.summary || update.text,
      update.date,
      "",
      analysis.blockers.join("\n"),
      "",
      update.developer,
      [
        update.text,
        analysis.completed.length ? `Completed: ${analysis.completed.join("; ")}` : "",
        analysis.inProgress.length ? `In Progress: ${analysis.inProgress.join("; ")}` : "",
        analysis.nextSteps.length ? `Next: ${analysis.nextSteps.join("; ")}` : "",
        analysis.tags.length ? `Tags: ${analysis.tags.join(", ")}` : "",
      ].filter(Boolean).join("\n"),
      update.source || "web",
    ],
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: project.spreadsheetId,
    range: `${quoteSheet(project.sheetName)}!A:K`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

async function appendFeedbackRow(sheets, project, feedback, analysis) {
  const values = [
    [
      feedback.date,
      feedback.developer,
      feedback.text,
      analysis.summary,
      analysis.category,
      analysis.suggestedAction,
      "Open",
      feedback.source,
      new Date().toISOString(),
    ],
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: project.spreadsheetId,
    range: `${quoteSheet(project.feedbackSheetName)}!A:I`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

async function appendWeeklyTargetRow(sheets, project, target, aiTarget) {
  const values = [
    [
      target.weekStart,
      project.label,
      target.owner,
      target.text,
      aiTarget.refinedTarget,
      aiTarget.successCriteria.join("\n"),
      aiTarget.risks.join("\n"),
      target.source,
      new Date().toISOString(),
    ],
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: project.spreadsheetId,
    range: `${quoteSheet(project.targetSheetName)}!A:I`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

async function appendWeeklyPlanRows(sheets, project, weekStart, tasks, source) {
  if (tasks.length === 0) return;

  const values = tasks.map((task) => [
    weekStart,
    project.label,
    task.assignee,
    task.role,
    task.task,
    task.priority,
    task.successCriteria,
    task.dependencies,
    task.status || "Planned",
    source,
    new Date().toISOString(),
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: project.spreadsheetId,
    range: `${quoteSheet(project.planSheetName)}!A:K`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

async function ensureHeader(sheets, project, sheetName, headers) {
  await ensureSheetTab(sheets, project, sheetName);

  const range = `${quoteSheet(sheetName)}!A1:${columnLetter(headers.length)}1`;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: project.spreadsheetId,
    range,
  });

  const current = response.data.values?.[0] || [];
  const hasHeader = headers.every((header, index) => current[index] === header);
  if (hasHeader) return;

  if (current.some((value) => String(value || "").trim())) {
    const error = new Error(`Header mismatch in ${project.label} / ${sheetName}. Existing headers will not be overwritten.`);
    error.statusCode = 500;
    throw error;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: project.spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headers] },
  });
}

async function ensureSheetTab(sheets, project, sheetName) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: project.spreadsheetId,
    fields: "sheets.properties.title",
  });
  const exists = spreadsheet.data.sheets?.some(
    (sheet) => sheet.properties?.title === sheetName,
  );
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: project.spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }],
    },
  });
}

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: env.googleServiceAccountEmail,
    key: env.googlePrivateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

async function readRows(sheets, project, sheetName, columns) {
  await ensureHeader(
    sheets,
    project,
    sheetName,
    headersForSheet(project, sheetName),
  );

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: project.spreadsheetId,
    range: `${quoteSheet(sheetName)}!${columns}`,
  });
  return response.data.values || [];
}

async function readRowsRaw(sheets, project, sheetName, columns) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: project.spreadsheetId,
    range: `${quoteSheet(sheetName)}!${columns}`,
  });
  return response.data.values || [];
}

async function buildProjectManagementContext(sheets, project, weekStart) {
  const timelineRows = await readRows(sheets, project, project.sheetName, "A:K");
  const feedbackRows = await readRows(sheets, project, project.feedbackSheetName, "A:I");
  const targetRows = await readRows(sheets, project, project.targetSheetName, "A:I");
  const planRows = await readRows(sheets, project, project.planSheetName, "A:K");
  const timelineDataRows = timelineRows.slice(1);
  const meaningfulTimelineRows = timelineDataRows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter((item) => isMeaningfulTimelineRow(item.row));
  const timelineContextLimit = Math.max(1, env.timelineContextLimit || 1000);
  const timelineRowsForAi = meaningfulTimelineRows.slice(-timelineContextLimit);

  return {
    project: project.label,
    weekStart,
    team: teamPromptData(project.key),
    rowCounts: {
      timeline: timelineDataRows.length,
      meaningfulTimeline: meaningfulTimelineRows.length,
      timelineSentToAi: timelineRowsForAi.length,
      timelineContextLimit,
      feedback: Math.max(0, feedbackRows.length - 1),
      weeklyTargets: Math.max(0, targetRows.length - 1),
      weeklyPlan: Math.max(0, planRows.length - 1),
    },
    recentTimeline: timelineRowsForAi.map((item) => timelineRowToObject(item)),
    openFeedback: feedbackRows
      .slice(1)
      .map((row, index) => ({ row, rowNumber: index + 2 }))
      .filter((item) => String(item.row[6] || "").toLowerCase() !== "done")
      .map((item) => feedbackRowToObject(item.row, item.rowNumber)),
    weeklyTargets: targetRows
      .slice(1)
      .map((row, index) => ({ row, rowNumber: index + 2 }))
      .filter((item) => item.row[0] === weekStart)
      .map((item) => targetRowToObject(item.row, item.rowNumber)),
    currentPlan: planRows
      .slice(1)
      .map((row, index) => ({ row, rowNumber: index + 2 }))
      .filter((item) => item.row[0] === weekStart)
      .map((item) => planRowToObject(item.row, item.rowNumber)),
  };
}

async function buildFullDailyTaskContext(sheets, project, weekStart, reviewDate = todayBangkok()) {
  const timelineRows = await readRowsRaw(sheets, project, project.sheetName, "A:K");
  const feedbackRows = await readRows(sheets, project, project.feedbackSheetName, "A:I");
  const targetRows = await readRows(sheets, project, project.targetSheetName, "A:I");
  const planRows = await readRows(sheets, project, project.planSheetName, "A:K");
  const actualTimelineHeaders = normalizeSheetHeaders(timelineRows[0] || []);
  const timelineHeaders = normalizeTimelineHeaders(timelineRows[0] || TIMELINE_HEADERS);
  const timelineDataRows = timelineRows.slice(1);
  const meaningfulTimelineRows = timelineDataRows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter((item) => isMeaningfulSheetRow(item.row));
  const fullTimeline = meaningfulTimelineRows.map((item) => sheetRowToObject(timelineHeaders, item.row, item.rowNumber));
  const scheduleSignals = buildScheduleSignals(project, fullTimeline, reviewDate);

  return {
    project: project.label,
    projectKey: project.key,
    weekStart,
    team: teamPromptData(project.key),
    rowCounts: {
      timeline: timelineDataRows.length,
      meaningfulTimeline: meaningfulTimelineRows.length,
      timelineSentToAi: meaningfulTimelineRows.length,
      timelineContextLimit: "full",
      feedback: Math.max(0, feedbackRows.length - 1),
      weeklyTargets: Math.max(0, targetRows.length - 1),
      weeklyPlan: Math.max(0, planRows.length - 1),
    },
    timelineHeaders,
    actualTimelineHeaders,
    expectedTimelineHeaders: TIMELINE_HEADERS,
    timelineHeaderMatchesExpected: TIMELINE_HEADERS.every((header, index) => actualTimelineHeaders[index] === header),
    fullTimeline,
    scheduleSignals,
    recentTimeline: meaningfulTimelineRows.slice(-10).map((item) => timelineRowToObject(item)),
    openFeedback: feedbackRows
      .slice(1)
      .map((row, index) => ({ row, rowNumber: index + 2 }))
      .filter((item) => String(item.row[6] || "").toLowerCase() !== "done")
      .map((item) => feedbackRowToObject(item.row, item.rowNumber)),
    weeklyTargets: targetRows
      .slice(1)
      .map((row, index) => ({ row, rowNumber: index + 2 }))
      .filter((item) => item.row[0] === weekStart)
      .map((item) => targetRowToObject(item.row, item.rowNumber)),
    currentPlan: planRows
      .slice(1)
      .map((row, index) => ({ row, rowNumber: index + 2 }))
      .filter((item) => item.row[0] === weekStart)
      .map((item) => planRowToObject(item.row, item.rowNumber)),
  };
}

function getCachedDailyTaskBoard(date) {
  const cached = dailyTaskCache.get(date);
  return cached ? { ...cached, cached: true } : null;
}

function getCachedMilestoneReview(date) {
  const cached = milestoneReviewCache.get(date);
  return cached ? { ...cached, cached: true } : null;
}

function normalizeSheetHeaders(headers) {
  return headers.map((header, index) => String(header || `Column ${columnLetter(index + 1)}`).trim());
}

function normalizeTimelineHeaders(headers) {
  return TIMELINE_HEADERS.slice(0, headers.length || TIMELINE_HEADERS.length);
}

function sheetRowToObject(headers, row, rowNumber) {
  const fields = {};
  headers.forEach((header, index) => {
    const value = row[index];
    if (String(value || "").trim()) fields[header] = value;
  });

  return {
    rowNumber,
    ...timelineRowToObject({ row, rowNumber }),
    fields,
  };
}

function buildScheduleSignals(project, fullTimeline, reviewDate) {
  const today = normalizeDate(reviewDate);
  const todayTime = new Date(`${today}T00:00:00+07:00`).getTime();
  const soonTime = todayTime + 3 * 24 * 60 * 60 * 1000;
  const signals = {
    project: project.label,
    projectKey: project.key,
    reviewDate: today,
    overdue: [],
    dueSoon: [],
    activeWindow: [],
    blocked: [],
    lowProgressDeadline: [],
  };

  for (const row of fullTimeline) {
    const analysis = analyzeTimelineScheduleRow(row, todayTime, soonTime);
    if (analysis.isComplete) continue;

    const item = {
      rowNumber: row.rowNumber,
      title: analysis.title,
      owner: analysis.owner,
      status: analysis.status,
      percent: analysis.percent,
      dates: analysis.dates,
      deadlineDates: analysis.deadlineDates,
      blockers: analysis.blockers,
    };

    if (analysis.blockers) signals.blocked.push(item);
    if (analysis.isOverdue) signals.overdue.push(item);
    if (analysis.isDueSoon) signals.dueSoon.push(item);
    if (analysis.isActiveWindow) signals.activeWindow.push(item);
    if ((analysis.isOverdue || analysis.isDueSoon) && analysis.percent < 80) {
      signals.lowProgressDeadline.push(item);
    }
  }

  for (const key of ["overdue", "dueSoon", "activeWindow", "blocked", "lowProgressDeadline"]) {
    signals[key] = signals[key].slice(0, 30);
  }

  return signals;
}

function analyzeTimelineScheduleRow(row, todayTime, soonTime) {
  const entries = Object.entries(row.fields || {});
  const text = entries.map(([header, value]) => `${header}: ${value}`).join(" | ");
  const lowerText = text.toLowerCase();
  const dates = [];
  const deadlineDates = [];

  for (const [header, value] of entries) {
    const headerText = String(header || "").toLowerCase();
    const normalizedDates = [...possibleSheetDates(value)];
    if (normalizedDates.length === 0) continue;

    const isDeadlineField = /deadline|due|end|target|finish|milestone|กำหนด|เดดไลน์|สิ้นสุด|ส่ง/.test(headerText);
    for (const date of normalizedDates) {
      dates.push({ field: header, date });
      if (isDeadlineField) deadlineDates.push({ field: header, date });
    }
  }

  const percent = extractProgressPercent(entries, lowerText);
  const isComplete = percent >= 100 || /(^|\b)(done|complete|completed|finished|closed)(\b|$)|เสร็จ|ปิดงาน/.test(lowerText);
  const blockers = entries
    .filter(([header, value]) => /block|risk|issue|problem|ติด|ปัญหา|เสี่ยง/i.test(`${header} ${value}`))
    .map(([header, value]) => `${header}: ${value}`)
    .join(" | ");
  const status = findFirstField(entries, /status|progress|state|สถานะ|ความคืบหน้า/i);
  const owner = findFirstField(entries, /owner|assignee|developer|person|name|ผู้รับผิดชอบ|คนทำ|ชื่อ/i) || row.developer;
  const title = findFirstField(entries, /task|milestone|feature|summary|title|name|work|งาน|หัวข้อ|ระบบ/i)
    || row.summary
    || row.rawUpdate
    || text.slice(0, 120);

  const deadlineTimes = deadlineDates
    .map((item) => ({ ...item, time: new Date(`${item.date}T00:00:00+07:00`).getTime() }))
    .filter((item) => Number.isFinite(item.time));
  const allTimes = dates
    .map((item) => ({ ...item, time: new Date(`${item.date}T00:00:00+07:00`).getTime() }))
    .filter((item) => Number.isFinite(item.time));

  return {
    title,
    owner,
    status,
    percent,
    blockers,
    dates,
    deadlineDates,
    isComplete,
    isOverdue: deadlineTimes.some((item) => item.time < todayTime),
    isDueSoon: deadlineTimes.some((item) => item.time >= todayTime && item.time <= soonTime),
    isActiveWindow: allTimes.some((item) => item.time <= todayTime && item.time >= todayTime - 7 * 24 * 60 * 60 * 1000),
  };
}

function extractProgressPercent(entries, fallbackText) {
  const percentValues = [];
  for (const [header, value] of entries) {
    const text = `${header} ${value}`;
    if (/percent|progress|complete|done|%|เปอร์|ความคืบหน้า/i.test(text)) {
      const matches = String(value || "").match(/\d{1,3}/g) || [];
      percentValues.push(...matches.map(Number).filter((number) => number >= 0 && number <= 100));
    }
  }

  const fallbackMatches = String(fallbackText || "").match(/(\d{1,3})\s*%/g) || [];
  percentValues.push(...fallbackMatches.map((value) => Number(value.replace(/\D/g, ""))).filter((number) => number >= 0 && number <= 100));
  return percentValues.length ? Math.max(...percentValues) : 0;
}

function findFirstField(entries, pattern) {
  const found = entries.find(([header, value]) => pattern.test(String(header || "")) && String(value || "").trim());
  return found ? String(found[1]).trim() : "";
}

async function readProjectTimeline(project) {
  const sheets = await getSheetsClient();
  const rows = await readRows(sheets, project, project.sheetName, "A:K");
  return rows.slice(1);
}

async function getOpenFeedbackRows(sheets, project) {
  const rows = await readRows(sheets, project, project.feedbackSheetName, "A:I");
  return rows
    .slice(1)
    .filter((row) => String(row[6] || "").toLowerCase() !== "done")
    .map((row) => ({
      date: row[0] || "",
      developer: row[1] || "",
      feedback: row[2] || "",
      summary: row[3] || "",
      category: row[4] || "",
      suggestedAction: row[5] || "",
      status: row[6] || "Open",
    }));
}

async function startDiscordBot() {
  if (!env.discordToken) return;

  if (env.discordClientId) {
    await registerSlashCommands();
  } else {
    console.warn("DISCORD_CLIENT_ID is missing. Slash commands were not registered.");
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });
  discordClient = client;

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Discord bot ready as ${readyClient.user.tag}`);
    scheduleDailyReport();
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (env.discordUpdateChannelId && message.channelId !== env.discordUpdateChannelId) {
      return;
    }
    await handleLegacyDiscordMessage(message);
  });

  await client.login(env.discordToken);
}

async function registerSlashCommands() {
  const projectOption = (option) =>
    option
      .setName("project")
      .setDescription("Game timeline")
      .setRequired(true)
      .addChoices(
        { name: "Dynozoic timeline", value: "dynozoic" },
        { name: "Earth Atlantis Abyss", value: "eaa" },
      );

  const commands = [
    new SlashCommandBuilder()
      .setName("updatework")
      .setDescription("Add developer work update to the selected game timeline")
      .addStringOption(projectOption)
      .addStringOption((option) =>
        option.setName("name").setDescription("Developer name").setRequired(true),
      )
      .addStringOption((option) =>
        option.setName("message").setDescription("Work update").setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("feedback")
      .setDescription("Add feedback to the selected game's feedback timeline")
      .addStringOption(projectOption)
      .addStringOption((option) =>
        option.setName("name").setDescription("Reporter name").setRequired(true),
      )
      .addStringOption((option) =>
        option.setName("message").setDescription("Feedback message").setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("weeklygold")
      .setDescription("Ask Grok to summarize this week's target and progress")
      .addStringOption((option) =>
        option
          .setName("project")
          .setDescription("Optional game timeline")
          .setRequired(false)
          .addChoices(
            { name: "Both games", value: "all" },
            { name: "Dynozoic timeline", value: "dynozoic" },
            { name: "Earth Atlantis Abyss", value: "eaa" },
          ),
      ),
    new SlashCommandBuilder()
      .setName("milestone")
      .setDescription("Ask Grok to analyze milestone status for both games"),
    new SlashCommandBuilder()
      .setName("managerpanel")
      .setDescription("Post AI project manager buttons for timeline analysis"),
  ].map((command) => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(env.discordToken);
  if (env.discordGuildId) {
    await rest.put(Routes.applicationGuildCommands(env.discordClientId, env.discordGuildId), {
      body: commands,
    });
    console.log("Registered guild slash commands.");
    return;
  }

  await rest.put(Routes.applicationCommands(env.discordClientId), { body: commands });
  console.log("Registered global slash commands.");
}

async function handleSlashCommand(interaction) {
  try {
    if (env.discordUpdateChannelId && interaction.channelId !== env.discordUpdateChannelId) {
      await interaction.reply({
        content: "Please use this command in the configured update channel.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    if (interaction.commandName === "updatework") {
      const result = await handleDeveloperUpdate({
        developer: interaction.options.getString("name", true),
        text: interaction.options.getString("message", true),
        date: todayBangkok(),
        project: interaction.options.getString("project", true),
        source: "discord:/updatework",
      });
      await interaction.editReply(
        `Saved to ${result.project.label}: ${result.analysis.summary}`,
      );
      return;
    }

    if (interaction.commandName === "feedback") {
      const result = await handleFeedback({
        developer: interaction.options.getString("name", true),
        text: interaction.options.getString("message", true),
        date: todayBangkok(),
        project: interaction.options.getString("project", true),
        source: "discord:/feedback",
      });
      await interaction.editReply(
        `Feedback saved to ${result.project.label}: ${result.analysis.summary}`,
      );
      return;
    }

    if (interaction.commandName === "weeklygold") {
      const project = interaction.options.getString("project") || "all";
      const report = await createWeeklyGoalReport(project === "all" ? "" : project);
      await interaction.editReply(truncateDiscordMessage(report));
      return;
    }

    if (interaction.commandName === "milestone") {
      const report = await createMilestoneReport();
      await interaction.editReply(truncateDiscordMessage(report));
      return;
    }

    if (interaction.commandName === "managerpanel") {
      await interaction.editReply({
        content: "AI Project Manager Panel",
        components: [createManagerPanelButtons()],
      });
    }
  } catch (error) {
    const message = `Command failed: ${error.message || "Unexpected error"}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message);
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
}

async function handleButtonInteraction(interaction) {
  try {
    if (env.discordUpdateChannelId && interaction.channelId !== env.discordUpdateChannelId) {
      await interaction.reply({
        content: "Please use this button in the configured update channel.",
        ephemeral: true,
      });
      return;
    }

    if (interaction.customId !== "ai_analyze_current_timelines") {
      await interaction.reply({ content: "Unknown action.", ephemeral: true });
      return;
    }

    await interaction.deferReply();
    const report = await createCurrentTimelineAnalysisReport();
    await interaction.editReply(truncateDiscordMessage(report));
  } catch (error) {
    const message = `Button action failed: ${error.message || "Unexpected error"}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message);
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
}

async function runDiscordWebhookInteraction(interaction) {
  let content = "Done.";

  try {
    if (interaction.type === 2) {
      content = await handleWebhookSlashCommand(interaction);
    } else if (interaction.type === 3) {
      content = await handleWebhookButton(interaction);
    } else {
      content = "Unsupported interaction.";
    }
  } catch (error) {
    content = `Command failed: ${error.message || "Unexpected error"}`;
  }

  await editDiscordWebhookOriginal(interaction, {
    content: truncateDiscordMessage(content),
  });
}

async function handleWebhookSlashCommand(interaction) {
  const command = interaction.data?.name;
  const options = discordOptionsToObject(interaction.data?.options || []);

  if (command === "updatework") {
    const result = await handleDeveloperUpdate({
      developer: String(options.name || "Unknown"),
      text: String(options.message || ""),
      date: todayBangkok(),
      project: String(options.project || ""),
      source: "discord-webhook:/updatework",
    });
    return `Saved to ${result.project.label}: ${result.analysis.summary}`;
  }

  if (command === "feedback") {
    const result = await handleFeedback({
      developer: String(options.name || "Unknown"),
      text: String(options.message || ""),
      date: todayBangkok(),
      project: String(options.project || ""),
      source: "discord-webhook:/feedback",
    });
    return `Feedback saved to ${result.project.label}: ${result.analysis.summary}`;
  }

  if (command === "weeklygold") {
    const project = String(options.project || "all");
    return createWeeklyGoalReport(project === "all" ? "" : project);
  }

  if (command === "milestone") {
    return createMilestoneReport();
  }

  if (command === "managerpanel") {
    return "Use the panel button to analyze timelines.";
  }

  return `Unknown command: ${command}`;
}

async function handleWebhookButton(interaction) {
  if (interaction.data?.custom_id === "ai_analyze_current_timelines") {
    return createCurrentTimelineAnalysisReport();
  }

  return "Unknown button action.";
}

async function handleLegacyDiscordMessage(message) {
  const content = message.content.trim();

  if (content.startsWith("!daily")) {
    await message.channel.send("Creating daily report...");
    const summaries = await createAllDailyReports(todayBangkok());
    await message.channel.send(truncateDiscordMessage(formatDailyReportBatch(summaries)));
    return;
  }

  if (!content.startsWith("!update")) return;

  const updateArgs = parseDiscordArgs(content.replace(/^!update\s*/i, "").trim());
  if (!updateArgs.text) {
    await message.reply("Please type your work update after `!update`.");
    return;
  }

  await message.channel.send("Update received. Analyzing and saving to Timeline...");
  const result = await handleDeveloperUpdate({
    developer: message.member?.displayName || message.author.username,
    text: updateArgs.text,
    date: updateArgs.date,
    project: updateArgs.project,
    source: "discord:legacy",
  });
  await message.reply(`Saved to ${result.project.label}: ${result.analysis.summary}`);
}

function scheduleDailyReport() {
  if (dailyReportTimer) clearTimeout(dailyReportTimer);

  const nextRun = nextBangkokRun(env.dailyReportTime);
  const delay = Math.max(1000, nextRun.getTime() - Date.now());
  console.log(`Next daily Discord report: ${nextRun.toISOString()}`);

  dailyReportTimer = setTimeout(async () => {
    try {
      const summaries = await createAllDailyReports(todayBangkok());
      await sendDiscordReport(formatDailyReportBatch(summaries));
    } catch (error) {
      console.error("Daily report failed:", error.message);
    } finally {
      scheduleDailyReport();
    }
  }, delay);
}

async function sendDiscordReport(content) {
  if (!env.discordToken || !env.discordReportChannelId) return;

  const client = discordClient || new Client({ intents: [GatewayIntentBits.Guilds] });
  const shouldDestroy = !discordClient;
  if (shouldDestroy) {
    await client.login(env.discordToken);
  }

  const channel = await client.channels.fetch(env.discordReportChannelId);
  if (channel?.isTextBased()) {
    for (const part of splitDiscordMessages(content)) {
      await channel.send(part);
    }
  }
  if (shouldDestroy) {
    await client.destroy();
  }
}

function normalizeUpdate(body, source) {
  const text = String(body.text || body.update || body.message || "").trim();
  const developer = normalizePersonName(body.developer || body.name || "Unknown");
  const date = normalizeDate(body.date);
  const project = normalizeProjectKey(body.project || body.game);

  if (!text) {
    const error = new Error("Missing update text");
    error.statusCode = 400;
    throw error;
  }

  return { developer, text, date, project, source };
}

function normalizeFeedback(body, source) {
  const text = String(body.text || body.feedback || body.message || "").trim();
  const developer = normalizePersonName(body.developer || body.name || "Unknown");
  const date = normalizeDate(body.date);
  const project = normalizeProjectKey(body.project || body.game);

  if (!text) {
    const error = new Error("Missing feedback text");
    error.statusCode = 400;
    throw error;
  }

  return { developer, text, date, project, source };
}

function normalizeWeeklyTarget(body, source) {
  const text = String(body.target || body.text || body.message || "").trim();
  const project = normalizeProjectKey(body.project || body.game);
  const owner = normalizePersonName(body.owner || body.developer || body.name || "ทีน");
  const weekStart = normalizeWeekStart(body.weekStart || body.week);

  if (!project) {
    const error = new Error("Missing project for weekly target");
    error.statusCode = 400;
    throw error;
  }

  if (!text) {
    const error = new Error("Missing weekly target text");
    error.statusCode = 400;
    throw error;
  }

  return { project, owner, text, weekStart, source };
}

function normalizeDate(value) {
  if (!value) return todayBangkok();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).trim();
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

function sheetDateMatches(value, targetDate) {
  const target = normalizeDate(targetDate);
  return possibleSheetDates(value).has(target);
}

function possibleSheetDates(value) {
  const input = String(value || "").trim();
  const dates = new Set();
  if (!input) return dates;

  if (typeof value === "number" || /^\d+(\.\d+)?$/.test(input)) {
    const serial = Number(value);
    if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 24 * 60 * 60 * 1000);
      dates.add(date.toLocaleDateString("en-CA", { timeZone: "UTC" }));
    }
  }

  const iso = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    dates.add(formatDateParts(normalizeCalendarYear(Number(iso[1])), Number(iso[2]), Number(iso[3])));
  }

  const slash = input.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = normalizeCalendarYear(Number(slash[3]));
    dates.add(formatDateParts(year, first, second));
    dates.add(formatDateParts(year, second, first));
  }

  const thaiMonth = input.match(/(\d{1,2})\s+([ก-๙]+)\s+(\d{4})/);
  if (thaiMonth) {
    const month = THAI_MONTHS[thaiMonth[2]];
    if (month) {
      dates.add(formatDateParts(normalizeCalendarYear(Number(thaiMonth[3])), month, Number(thaiMonth[1])));
    }
  }

  const parsed = new Date(input);
  if (!Number.isNaN(parsed.getTime())) {
    dates.add(parsed.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }));
  }

  return new Set([...dates].filter(Boolean));
}

const THAI_MONTHS = {
  มกราคม: 1,
  กุมภาพันธ์: 2,
  มีนาคม: 3,
  เมษายน: 4,
  พฤษภาคม: 5,
  มิถุนายน: 6,
  กรกฎาคม: 7,
  สิงหาคม: 8,
  กันยายน: 9,
  ตุลาคม: 10,
  พฤศจิกายน: 11,
  ธันวาคม: 12,
};

function normalizeCalendarYear(year) {
  if (year < 100) return year + 2000;
  return year > 2400 ? year - 543 : year;
}

function formatDateParts(year, month, day) {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return "";
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function todayBangkok() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

function currentWeekStartBangkok() {
  const today = new Date(`${todayBangkok()}T00:00:00+07:00`);
  const day = today.getDay() || 7;
  const monday = new Date(today.getTime() - (day - 1) * 24 * 60 * 60 * 1000);
  return monday.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

function normalizeWeekStart(value) {
  if (!value) return currentWeekStartBangkok();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).trim();
  const normalized = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = normalized.getUTCDay() || 7;
  normalized.setUTCDate(normalized.getUTCDate() - (day - 1));
  return normalized.toLocaleDateString("en-CA", { timeZone: "UTC" });
}

function nextBangkokRun(timeValue) {
  const [hoursRaw, minutesRaw] = String(timeValue || "21:00").split(":");
  const hours = Number(hoursRaw || 21);
  const minutes = Number(minutesRaw || 0);
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const bangkokTodayUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hours - 7,
    minutes,
    0,
  );
  let run = new Date(bangkokTodayUtc);
  if (run <= now) {
    run = new Date(run.getTime() + 24 * 60 * 60 * 1000);
  }
  return run;
}

function normalizePrivateKey(value) {
  return value ? value.replace(/\\n/g, "\n") : value;
}

function validateRuntimeConfig() {
  const missing = [];
  if (!grok) missing.push("GROK_API_KEY");
  if (!PROJECTS.dynozoic.spreadsheetId) missing.push("DYNOZOIC_SHEET_ID");
  if (!PROJECTS.eaa.spreadsheetId) missing.push("EAA_SHEET_ID");
  if (!env.googleServiceAccountEmail) missing.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  if (!env.googlePrivateKey) missing.push("GOOGLE_PRIVATE_KEY");

  if (missing.length > 0) {
    const error = new Error(`Missing required env: ${missing.join(", ")}`);
    error.statusCode = 500;
    throw error;
  }
}

function resolveProject(value) {
  const key = normalizeProjectKey(value) || "dynozoic";
  const project = PROJECTS[key];
  if (!project) {
    const error = new Error(`Unknown project: ${value}`);
    error.statusCode = 400;
    throw error;
  }
  if (!project.spreadsheetId) {
    const error = new Error(`Missing sheet id for project: ${project.label}`);
    error.statusCode = 500;
    throw error;
  }
  return project;
}

function normalizeProjectKey(value) {
  const input = String(value || "").trim().toLowerCase();
  if (!input) return "";

  for (const project of Object.values(PROJECTS)) {
    if (project.key === input || project.aliases.includes(input)) {
      return project.key;
    }
  }

  if (input.includes("eaa") || input.includes("earth atlantis")) return "eaa";
  if (input.includes("dyno")) return "dynozoic";
  return "";
}

function normalizePersonName(value) {
  const input = String(value || "").trim();
  if (!input) return "Unknown";
  const lower = input.toLowerCase();
  const found = ACTIVE_TEAM_MEMBERS.find((member) => {
    const name = member.name.toLowerCase();
    return lower === name || lower.includes(name);
  });
  return found ? found.name : input;
}

function parseDiscordArgs(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  const maybeProject = normalizeProjectKey(parts[0]);
  const project = maybeProject || "";
  const rest = maybeProject ? parts.slice(1) : parts;
  const maybeDate = rest[0] && /^\d{4}-\d{2}-\d{2}$/.test(rest[0]) ? rest[0] : "";
  const textParts = maybeDate ? rest.slice(1) : rest;

  return {
    project,
    date: normalizeDate(maybeDate),
    text: textParts.join(" "),
  };
}

function assertWebAuth(req) {
  if (!env.webFormSecret) return;
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (token === env.webFormSecret) return;

  const error = new Error("Unauthorized");
  error.statusCode = 401;
  throw error;
}

function assertCronAuth(req) {
  if (!env.cronSecret) return;
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (token === env.cronSecret || req.query.secret === env.cronSecret) return;

  const error = new Error("Unauthorized cron request");
  error.statusCode = 401;
  throw error;
}

function isConfirmedSend(req) {
  return req.body?.confirm === true || req.body?.confirmed === true;
}

function createDiscordPreviewResponse(content, title) {
  return {
    ok: true,
    sent: false,
    requiresConfirmation: true,
    title,
    preview: String(content || "").trim(),
  };
}

function createAdminStatus(req) {
  const origin = `${req.protocol}://${req.get("host")}`;
  return {
    ok: true,
    app: "Eccentrix Timeline Manager",
    date: todayBangkok(),
    dailyReportTime: env.dailyReportTime,
    dailyTaskTime: env.dailyTaskTime,
    auth: {
      webFormSecretEnabled: Boolean(env.webFormSecret),
      cronSecretEnabled: Boolean(env.cronSecret),
    },
    ai: {
      grokConfigured: Boolean(env.grokApiKey),
      model: env.grokModel,
    },
    google: {
      serviceAccountConfigured: Boolean(env.googleServiceAccountEmail && env.googlePrivateKey),
      dynozoicSheetConfigured: Boolean(PROJECTS.dynozoic.spreadsheetId),
      eaaSheetConfigured: Boolean(PROJECTS.eaa.spreadsheetId),
      sheetTabs: {
        dynozoic: {
          timeline: PROJECTS.dynozoic.sheetName,
          feedback: PROJECTS.dynozoic.feedbackSheetName,
          targets: PROJECTS.dynozoic.targetSheetName,
          plan: PROJECTS.dynozoic.planSheetName,
        },
        eaa: {
          timeline: PROJECTS.eaa.sheetName,
          feedback: PROJECTS.eaa.feedbackSheetName,
          targets: PROJECTS.eaa.targetSheetName,
          plan: PROJECTS.eaa.planSheetName,
        },
      },
    },
    discord: {
      tokenConfigured: Boolean(env.discordToken),
      clientIdConfigured: Boolean(env.discordClientId),
      publicKeyConfigured: Boolean(env.discordPublicKey),
      guildIdConfigured: Boolean(env.discordGuildId),
      updateChannelConfigured: Boolean(env.discordUpdateChannelId),
      reportChannelConfigured: Boolean(env.discordReportChannelId),
      gatewayEnabled: env.enableDiscordBot,
      interactionEndpoint: `${origin}/discord/interactions`,
    },
    endpoints: {
      health: "/health",
      updates: "/updates",
      feedback: "/feedback",
      weeklyTarget: "/weekly-target",
      weeklyPlan: "/weekly-plan",
      dailyTasks: "/daily-tasks",
      dailyTaskSubmit: "/daily-task-submit",
      milestoneReview: "/milestone-review",
      timelineAnalysis: "/timeline-analysis",
      registerCommands: "/discord/register-commands",
      testReport: "/discord/test-report",
    },
  };
}

function verifyDiscordRequest(req) {
  if (!env.discordPublicKey) return false;

  const signature = req.get("x-signature-ed25519");
  const timestamp = req.get("x-signature-timestamp");
  if (!signature || !timestamp || !Buffer.isBuffer(req.body)) return false;

  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        Buffer.from(env.discordPublicKey, "hex"),
      ]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(
      null,
      Buffer.concat([Buffer.from(timestamp), req.body]),
      publicKey,
      Buffer.from(signature, "hex"),
    );
  } catch (_error) {
    return false;
  }
}

function isAllowedDiscordChannel(channelId) {
  return !env.discordUpdateChannelId || channelId === env.discordUpdateChannelId;
}

async function editDiscordWebhookOriginal(interaction, payload) {
  const appId = interaction.application_id || env.discordClientId;
  const url = `https://discord.com/api/v10/webhooks/${appId}/${interaction.token}/messages/@original`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord webhook edit failed: ${response.status} ${text}`);
  }
}

function discordOptionsToObject(options) {
  const result = {};
  for (const option of options) {
    result[option.name] = option.value;
  }
  return result;
}

function sendHttpError(res, error) {
  const status = error.statusCode || 500;
  res.status(status).json({ error: error.message || "Unexpected error" });
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (!value) return [];
  return [String(value).trim()].filter(Boolean);
}

function splitCellList(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonObject(value) {
  try {
    return JSON.parse(value || "{}");
  } catch (_error) {
    return {};
  }
}

function rowsToObjects(rows, startRowNumber = 2) {
  return rows.map((row, index) => ({
    rowNumber: startRowNumber + index,
    id: row[0] || "",
    rock: row[1] || "",
    priority: row[2] || "",
    task: row[3] || "",
    start: row[4] || "",
    end: row[5] || "",
    blockers: row[6] || "",
    percent: row[7] || "",
    response: row[8] || "",
    subResponse: row[9] || "",
    statusLateDay: row[10] || "",
  }));
}

function timelineRowToObject(item) {
  const row = item.row || item;
  return {
    rowNumber: item.rowNumber || 0,
    id: row[0] || "",
    rock: row[1] || "",
    priority: row[2] || "",
    task: row[3] || "",
    start: row[4] || "",
    end: row[5] || "",
    blockers: row[6] || "",
    percent: row[7] || "",
    response: row[8] || "",
    subResponse: row[9] || "",
    statusLateDay: row[10] || "",
    date: row[4] || "",
    developer: row[8] || "",
    rawUpdate: row[3] || row[9] || "",
    summary: row[3] || "",
    completed: row[7] || "",
    inProgress: row[10] || "",
    nextSteps: row[9] || "",
    tags: row[1] || "",
  };
}

function isMeaningfulTimelineRow(row) {
  return isMeaningfulSheetRow(row);
}

function isMeaningfulSheetRow(row) {
  return (Array.isArray(row) ? row : []).some((value) => String(value || "").trim());
}

function feedbackRowToObject(row, rowNumber = 0) {
  return {
    rowNumber,
    date: row[0] || "",
    developer: row[1] || "",
    feedback: row[2] || "",
    summary: row[3] || "",
    category: row[4] || "",
    suggestedAction: row[5] || "",
    status: row[6] || "Open",
  };
}

function targetRowToObject(row, rowNumber = 0) {
  return {
    rowNumber,
    weekStart: row[0] || "",
    project: row[1] || "",
    owner: row[2] || "",
    rawTarget: row[3] || "",
    refinedTarget: row[4] || "",
    successCriteria: row[5] || "",
    risks: row[6] || "",
    source: row[7] || "",
  };
}

function planRowToObject(row, rowNumber = 0) {
  return {
    rowNumber,
    weekStart: row[0] || "",
    project: row[1] || "",
    assignee: row[2] || "",
    role: row[3] || "",
    task: row[4] || "",
    priority: row[5] || "",
    successCriteria: row[6] || "",
    dependencies: row[7] || "",
    status: row[8] || "Planned",
  };
}

function normalizePlanTask(task) {
  const assignee = normalizePersonName(task.assignee || task.name || "");
  const member = ACTIVE_TEAM_MEMBERS.find((item) => item.name === assignee);
  return {
    assignee,
    role: String(task.role || member?.role || "").trim(),
    task: String(task.task || task.title || task.description || "").trim(),
    priority: String(task.priority || "Medium").trim(),
    successCriteria: String(task.successCriteria || task.doneWhen || "").trim(),
    dependencies: String(task.dependencies || task.dependency || "").trim(),
    status: String(task.status || "Planned").trim(),
  };
}

function normalizeDailyTaskPeople(people) {
  const byName = new Map(
    (Array.isArray(people) ? people : [])
      .map((person) => [normalizePersonName(person.member || person.name || person.developer), person])
      .filter(([name]) => name && name !== "Unknown"),
  );

  return ACTIVE_TEAM_MEMBERS.map((member) => {
    const person = byName.get(member.name) || {};
    return {
      member: member.name,
      role: String(person.role || member.role || "").trim(),
      focus: String(person.focus || "").trim(),
      todayTasks: normalizeDailyTasks(person.todayTasks, "today"),
      carryOverTasks: normalizeDailyTasks(person.carryOverTasks, "carry-over"),
      advanceTasks: normalizeDailyTasks(person.advanceTasks, "advance"),
      risks: asArray(person.risks),
    };
  });
}

function normalizeDailyTasks(tasks, fallbackPrefix) {
  return (Array.isArray(tasks) ? tasks : [])
    .map((task, index) => {
      const project = normalizeProjectKey(task.project || task.game);
      const title = String(task.title || task.task || task.description || "").trim();
      if (!title) return null;

      return {
        id: String(task.id || `${fallbackPrefix}-${index + 1}`).trim(),
        project,
        title,
        why: String(task.why || task.reason || "").trim(),
        targetPercent: clampPercent(task.targetPercent ?? task.target ?? task.percent),
        currentPercent: clampPercent(task.currentPercent ?? task.current ?? 0),
        priority: String(task.priority || "Medium").trim(),
        timelineRowNumber: normalizeOptionalRowNumber(task.timelineRowNumber || task.rowNumber || task.row),
      };
    })
    .filter(Boolean);
}

function normalizeDailyProgressItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const title = String(item.title || item.task || "").trim();
      const project = normalizeProjectKey(item.project || item.game);
      const percent = clampPercent(item.percent ?? item.currentPercent ?? item.donePercent);
      const timelineRowNumber = normalizeOptionalRowNumber(item.timelineRowNumber || item.rowNumber || item.row);
      const status = String(item.status || "").trim();
      const note = String(item.note || item.comment || "").trim();

      if (!title && !note) return null;
      return { title, project, percent, timelineRowNumber, status, note };
    })
    .filter(Boolean);
}

function normalizeMilestoneProjects(projects) {
  return (Array.isArray(projects) ? projects : [])
    .map((project) => {
      const projectKey = normalizeProjectKey(project.projectKey || project.project || project.name);
      const resolved = projectKey ? PROJECTS[projectKey] : null;

      return {
        projectKey,
        project: String(project.project || resolved?.label || "Unknown project").trim(),
        currentMilestone: String(project.currentMilestone || project.milestone || "Current milestone").trim(),
        percentComplete: clampPercent(project.percentComplete ?? project.percent ?? project.progress),
        status: normalizeMilestoneStatus(project.status),
        deadlineStatus: String(project.deadlineStatus || project.timing || "Unknown").trim(),
        concerns: asArray(project.concerns),
        smoothAreas: asArray(project.smoothAreas),
        evidenceRows: normalizeEvidenceRows(project.evidenceRows || project.rows),
        nextReviewFocus: asArray(project.nextReviewFocus || project.nextSteps),
      };
    })
    .filter((project) => project.projectKey || project.project !== "Unknown project");
}

function normalizeMilestoneStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (["smooth", "watch", "risk", "blocked"].includes(status)) return status;
  if (status.includes("block")) return "blocked";
  if (status.includes("risk") || status.includes("late")) return "risk";
  if (status.includes("watch") || status.includes("tight")) return "watch";
  return "smooth";
}

function normalizeEvidenceRows(value) {
  return (Array.isArray(value) ? value : [])
    .map((row) => Number(row))
    .filter((row) => Number.isInteger(row) && row >= 2)
    .slice(0, 12);
}

function averagePercent(projects) {
  const values = projects
    .map((project) => Number(project.percentComplete))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return 0;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeOptionalRowNumber(value) {
  const rowNumber = Number(value);
  return Number.isInteger(rowNumber) && rowNumber >= 2 ? rowNumber : null;
}

function headersForSheet(project, sheetName) {
  if (sheetName === project.feedbackSheetName) return FEEDBACK_HEADERS;
  if (sheetName === project.targetSheetName) return TARGET_HEADERS;
  if (sheetName === project.planSheetName) return PLAN_HEADERS;
  return TIMELINE_HEADERS;
}

function isDateInCurrentBangkokWeek(value) {
  const today = new Date(`${todayBangkok()}T00:00:00+07:00`);
  const day = today.getDay() || 7;
  const monday = new Date(today.getTime() - (day - 1) * 24 * 60 * 60 * 1000);
  const nextMonday = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);

  for (const normalized of possibleSheetDates(value)) {
    const rowDate = new Date(`${normalized}T00:00:00+07:00`);
    if (!Number.isNaN(rowDate.getTime()) && rowDate >= monday && rowDate < nextMonday) {
      return true;
    }
  }

  return false;
}

function formatDailyReportBatch(summaries) {
  return summaries
    .map((summary) => {
      const feedbackText =
        summary.openFeedback.length > 0
          ? [
              "",
              "Open feedback reminders:",
              ...summary.openFeedback
                .slice(0, 10)
                .map((item) => `- ${item.summary || item.feedback} (${item.status})`),
            ].join("\n")
          : "";

      return [
        `Daily Summary - ${summary.project} - ${summary.date}`,
        `Updates: ${summary.totalUpdates}`,
        `Developers: ${summary.developers.join(", ") || "-"}`,
        "",
        summary.summary,
        feedbackText,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function createManagerPanelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ai_analyze_current_timelines")
      .setLabel("Analyze Current Timelines")
      .setStyle(ButtonStyle.Primary),
  );
}

function createManagerPanelButtonPayload() {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: "ai_analyze_current_timelines",
        label: "Analyze Current Timelines",
        style: 1,
      },
    ],
  };
}

function splitDiscordMessages(content) {
  const text = String(content || "").trim() || "No data.";
  const chunks = [];
  for (let i = 0; i < text.length; i += 1900) {
    chunks.push(text.slice(i, i + 1900));
  }
  return chunks;
}

function truncateDiscordMessage(content) {
  const text = String(content || "No data.");
  return text.length > 1900 ? `${text.slice(0, 1890)}...` : text;
}

function projectPromptData() {
  return Object.values(PROJECTS).map((project) => ({
    key: project.key,
    name: project.label,
  }));
}

function teamPromptData(projectKey = "") {
  return ACTIVE_TEAM_MEMBERS.filter(
    (member) => !projectKey || member.projects.includes(projectKey),
  ).map((member) => ({
    name: member.name,
    role: member.role,
    projects: member.projects,
  }));
}

function quoteSheet(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function columnLetter(index) {
  let value = index;
  let result = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    result = String.fromCharCode(65 + mod) + result;
    value = Math.floor((value - mod) / 26);
  }
  return result;
}

module.exports = app;
