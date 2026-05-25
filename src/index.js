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

app.get("/admin/sheets-debug", async (req, res) => {
  try {
    assertWebAuth(req);
    const result = await createSheetsDebugSnapshot();
    res.json(result);
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
    await sendDiscordReport(message);
    res.json({ ok: true, message });
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
    await sendDiscordReport(formatDailyReportBatch(summaries));
    res.json(summaries);
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.post("/weekly-goal", async (req, res) => {
  try {
    assertWebAuth(req);
    const project = req.body.project ? resolveProject(req.body.project) : null;
    const result = await createWeeklyGoalReport(project?.key);
    await sendDiscordReport(result);
    res.json({ report: result });
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
    await sendDiscordReport(result);
    res.json({ report: result });
  } catch (error) {
    sendHttpError(res, error);
  }
});

app.post("/timeline-analysis", async (req, res) => {
  try {
    assertWebAuth(req);
    const result = await createCurrentTimelineAnalysisReport();
    await sendDiscordReport(result);
    res.json({ report: result });
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
  await ensureHeader(sheets, project, project.sheetName, SHEET_HEADERS);
  await appendTimelineRow(sheets, project, update, analysis);

  return {
    ok: true,
    update,
    project,
    analysis,
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
          "Supported action types: save_update, save_feedback, set_weekly_target, generate_weekly_plan, send_discord_report.",
          "For save_update use fields: project, developer, text, date.",
          "For save_feedback use fields: project, developer, text, date.",
          "For set_weekly_target use fields: project, owner, target, weekStart.",
          "For generate_weekly_plan use fields: project, weekStart. project may be empty for both projects.",
          "For send_discord_report use field: message.",
          "If a required field is missing, do not create the action; ask a concise follow-up in reply.",
          "When answering timeline questions, rely on the provided projects context. If contextSummary shows zero recentTimeline rows, clearly say the timeline was not loaded and suggest checking sheet tab names and sheet IDs.",
          "Keep Thai if the user writes Thai.",
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
  const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
  const appliedActions = await executeAssistantActions(actions);

  return {
    ok: true,
    reply: String(parsed.reply || "").trim() || "Done.",
    contextSummary,
    visualProgressOverview: parsed.visualProgressOverview || null,
    actionsRequested: actions,
    actionsApplied: appliedActions,
  };
}

async function executeAssistantActions(actions) {
  const results = [];

  for (const action of actions.slice(0, 5)) {
    const type = String(action.type || "").trim();

    if (type === "save_update") {
      const result = await handleDeveloperUpdate({
        project: action.project,
        developer: action.developer || action.name || "Unknown",
        text: action.text || action.message || action.update,
        date: normalizeDate(action.date),
        source: "assistant-chat:/save_update",
      });
      results.push({ type, ok: true, project: result.project.label, summary: result.analysis.summary });
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

    if (type === "send_discord_report") {
      const message = String(action.message || "").trim();
      if (!message) continue;
      await sendDiscordReport(message);
      results.push({ type, ok: true });
    }
  }

  return results;
}

async function createSheetsDebugSnapshot() {
  validateRuntimeConfig();

  const sheets = await getSheetsClient();
  const weekStart = currentWeekStartBangkok();
  const projects = [];

  for (const project of Object.values(PROJECTS)) {
    const context = await buildProjectManagementContext(sheets, project, weekStart);
    projects.push({
      key: project.key,
      label: project.label,
      spreadsheetIdTail: String(project.spreadsheetId || "").slice(-8),
      sheetTabs: {
        timeline: project.sheetName,
        feedback: project.feedbackSheetName,
        targets: project.targetSheetName,
        plan: project.planSheetName,
      },
      counts: {
        timelineTotal: context.rowCounts.timeline,
        recentTimeline: context.recentTimeline.length,
        feedbackTotal: context.rowCounts.feedback,
        openFeedback: context.openFeedback.length,
        weeklyTargetsTotal: context.rowCounts.weeklyTargets,
        weeklyTargets: context.weeklyTargets.length,
        weeklyPlanTotal: context.rowCounts.weeklyPlan,
        currentPlan: context.currentPlan.length,
      },
      lastTimelineRows: context.recentTimeline.slice(-5),
      lastWeeklyTargets: context.weeklyTargets.slice(-3),
      lastPlanRows: context.currentPlan.slice(-5),
    });
  }

  return {
    ok: true,
    date: todayBangkok(),
    weekStart,
    projects,
  };
}

function summarizeProjectContexts(contexts) {
  return contexts.map((context) => ({
    project: context.project,
    weekStart: context.weekStart,
    timelineTotalCount: context.rowCounts.timeline,
    recentTimelineCount: context.recentTimeline.length,
    feedbackTotalCount: context.rowCounts.feedback,
    openFeedbackCount: context.openFeedback.length,
    weeklyTargetTotalCount: context.rowCounts.weeklyTargets,
    weeklyTargetCount: context.weeklyTargets.length,
    weeklyPlanTotalCount: context.rowCounts.weeklyPlan,
    currentPlanCount: context.currentPlan.length,
    latestTimeline: context.recentTimeline.slice(-3).map((row) => ({
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
  await ensureHeader(sheets, project, project.sheetName, SHEET_HEADERS);

  const rows = await readRows(sheets, project, project.sheetName, "A:L");
  const dataRows = rows.slice(1).filter((row) => row[0] === date);
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
      update.date,
      update.developer,
      update.text,
      analysis.summary,
      analysis.completed.join("\n"),
      analysis.inProgress.join("\n"),
      analysis.blockers.join("\n"),
      analysis.nextSteps.join("\n"),
      analysis.tags.join(", "),
      analysis.confidence,
      update.source,
      new Date().toISOString(),
    ],
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: project.spreadsheetId,
    range: `${quoteSheet(project.sheetName)}!A:L`,
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

async function buildProjectManagementContext(sheets, project, weekStart) {
  const timelineRows = await readRows(sheets, project, project.sheetName, "A:L");
  const feedbackRows = await readRows(sheets, project, project.feedbackSheetName, "A:I");
  const targetRows = await readRows(sheets, project, project.targetSheetName, "A:I");
  const planRows = await readRows(sheets, project, project.planSheetName, "A:K");

  return {
    project: project.label,
    weekStart,
    team: teamPromptData(project.key),
    rowCounts: {
      timeline: Math.max(0, timelineRows.length - 1),
      feedback: Math.max(0, feedbackRows.length - 1),
      weeklyTargets: Math.max(0, targetRows.length - 1),
      weeklyPlan: Math.max(0, planRows.length - 1),
    },
    recentTimeline: rowsToObjects(timelineRows.slice(1).slice(-30)),
    openFeedback: feedbackRows
      .slice(1)
      .filter((row) => String(row[6] || "").toLowerCase() !== "done")
      .map(feedbackRowToObject),
    weeklyTargets: targetRows
      .slice(1)
      .filter((row) => row[0] === weekStart)
      .map(targetRowToObject),
    currentPlan: planRows
      .slice(1)
      .filter((row) => row[0] === weekStart)
      .map(planRowToObject),
  };
}

async function readProjectTimeline(project) {
  const sheets = await getSheetsClient();
  const rows = await readRows(sheets, project, project.sheetName, "A:L");
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

function createAdminStatus(req) {
  const origin = `${req.protocol}://${req.get("host")}`;
  return {
    ok: true,
    app: "Eccentrix Timeline Manager",
    date: todayBangkok(),
    dailyReportTime: env.dailyReportTime,
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

function rowsToObjects(rows) {
  return rows.map((row) => ({
    date: row[0] || "",
    developer: row[1] || "",
    rawUpdate: row[2] || "",
    summary: row[3] || "",
    completed: row[4] || "",
    inProgress: row[5] || "",
    blockers: row[6] || "",
    nextSteps: row[7] || "",
    tags: row[8] || "",
  }));
}

function feedbackRowToObject(row) {
  return {
    date: row[0] || "",
    developer: row[1] || "",
    feedback: row[2] || "",
    summary: row[3] || "",
    category: row[4] || "",
    suggestedAction: row[5] || "",
    status: row[6] || "Open",
  };
}

function targetRowToObject(row) {
  return {
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

function planRowToObject(row) {
  return {
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

function headersForSheet(project, sheetName) {
  if (sheetName === project.feedbackSheetName) return FEEDBACK_HEADERS;
  if (sheetName === project.targetSheetName) return TARGET_HEADERS;
  if (sheetName === project.planSheetName) return PLAN_HEADERS;
  return SHEET_HEADERS;
}

function isDateInCurrentBangkokWeek(value) {
  const rowDate = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(rowDate.getTime())) return false;

  const today = new Date(`${todayBangkok()}T00:00:00+07:00`);
  const day = today.getDay() || 7;
  const monday = new Date(today.getTime() - (day - 1) * 24 * 60 * 60 * 1000);
  const nextMonday = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);
  return rowDate >= monday && rowDate < nextMonday;
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
