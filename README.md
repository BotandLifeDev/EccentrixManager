# Eccentrix Timeline Manager

Discord bot + Web API for two game timelines:

- `Dynozoic timeline`
- `Earth Atlantis Abyss` (`EAA`)

Flow:

`Developer Update -> Discord / Web Form -> Node.js -> Grok API -> Google Sheets API -> Timeline -> Daily Summary -> Discord Report`

## What The Bot Does

- `/updatework` saves a developer work update into the selected game's main `Timeline`
- `/feedback` saves feedback into the selected game's separate `Feedback` timeline
- `/weeklygold` asks Grok to summarize this week's target, progress %, risks, and next actions
- `/milestone` asks Grok to analyze current milestone status for both games
- `/managerpanel` posts a button panel; click `Analyze Current Timelines` to make Grok analyze both current timelines
- Backend `POST /weekly-target` lets you set this week's target; Grok refines it, saves it, creates a weekly work plan per person, and writes an AI manager row into the main timeline
- Backend `POST /weekly-plan` lets Grok regenerate the weekly work plan from timeline, target, feedback, and team roles
- Every day at 21:00 Bangkok time, the bot sends a daily report for both games
- Open feedback is reminded in every 21:00 report until its `Status` column is changed to `Done`

## Team Roles

- `ทีน`: leader and overall manager for both projects
- `แมน`: art developer for both projects
- `นน`: main developer for EAA
- `ภูผา`: main developer for Dynozoic

## Setup

1. Copy `.env.example` to `.env`
2. Add `GROK_API_KEY`
3. Create a Google service account
4. Share both Google Sheet files with `GOOGLE_SERVICE_ACCOUNT_EMAIL` as Editor
5. Add both spreadsheet IDs:

```env
DYNOZOIC_SHEET_ID=...
EAA_SHEET_ID=...
```

The bot uses these tabs inside each spreadsheet:

```env
DYNOZOIC_SHEET_NAME=Timeline
DYNOZOIC_FEEDBACK_SHEET_NAME=Feedback
DYNOZOIC_TARGET_SHEET_NAME=WeeklyTargets
DYNOZOIC_PLAN_SHEET_NAME=WeeklyPlan
EAA_SHEET_NAME=Timeline
EAA_FEEDBACK_SHEET_NAME=Feedback
EAA_TARGET_SHEET_NAME=WeeklyTargets
EAA_PLAN_SHEET_NAME=WeeklyPlan
```

If these tabs do not exist, the bot will create them.

## Discord Bot Setup

1. Go to Discord Developer Portal
2. Create an Application
3. Open `Bot`, create/reset token, then put it in:

```env
DISCORD_TOKEN=...
```

4. Open `General Information`, copy Application ID into:

```env
DISCORD_CLIENT_ID=...
```

5. For fast slash command updates while testing, copy your Discord server ID into:

```env
DISCORD_GUILD_ID=...
```

Without `DISCORD_GUILD_ID`, commands are global and may take longer to appear.

6. Invite the bot with these scopes:

```text
bot
applications.commands
```

Recommended permissions:

```text
Send Messages
Read Message History
Use Slash Commands
View Channels
```

7. Put channel IDs into:

```env
DISCORD_UPDATE_CHANNEL_ID=...
DISCORD_REPORT_CHANNEL_ID=...
DAILY_REPORT_TIME=21:00
```

## Run

PowerShell may block `npm.ps1`, so use:

```powershell
npm.cmd start
```

Run the persistent Discord gateway bot locally or on a long-running host:

```powershell
npm.cmd run bot
```

## Deploy To Vercel

This project is Vercel-ready for the Web API, Google Sheets updates, Grok analysis, and scheduled daily report.

Files used by Vercel:

- `api/index.js`: serverless Express entrypoint
- `vercel.json`: route rewrite + daily cron

Deploy steps:

1. Push this project to GitHub
2. Import the repository in Vercel
3. Add all environment variables from `.env.example` in Vercel Project Settings
4. Set `ENABLE_DISCORD_BOT=false` or leave it unset on Vercel
5. Deploy

Vercel routes:

```text
GET  /health
POST /updates
POST /feedback
POST /weekly-target
POST /weekly-plan
POST /weekly-goal
POST /milestone
POST /timeline-analysis
POST /discord/interactions
POST /discord/register-commands
GET  /cron/daily-report
```

The Vercel cron in `vercel.json` runs:

```text
0 14 * * *
```

That is 21:00 Bangkok time.

Discord slash commands and buttons can run fully on Vercel through Discord Interactions Webhook mode. The old gateway bot is still available for local/worker hosting with `npm.cmd run bot`, but it is no longer required for Vercel.

### Discord Interactions On Vercel

After Vercel deploys, open Discord Developer Portal:

1. Go to your Application
2. Open `General Information`
3. Copy `Public Key` into Vercel env:

```env
DISCORD_PUBLIC_KEY=...
```

4. Set `Interactions Endpoint URL` to:

```text
https://your-vercel-domain.vercel.app/discord/interactions
```

5. Save. Discord will ping the endpoint and the app verifies the signature.

6. Register slash commands by calling:

```http
POST https://your-vercel-domain.vercel.app/discord/register-commands
Authorization: Bearer your-WEB_FORM_SECRET
```

If `DISCORD_GUILD_ID` is set, commands update quickly in that server. If it is empty, commands are global and can take longer to appear.

## Slash Commands

Save work update:

```text
/updatework project:eaa name:Bank message:Finished boss VFX and found blocker in animation export
```

Save feedback:

```text
/feedback project:dynozoic name:ทีน message:Combat pacing feels too slow after wave 3
```

Weekly target/progress:

```text
/weeklygold
/weeklygold project:eaa
```

Milestone status:

```text
/milestone
```

AI manager button panel:

```text
/managerpanel
```

Then click `Analyze Current Timelines`.

## Web API

Add work update:

```http
POST /updates
```

```json
{
  "project": "eaa",
  "developer": "Name",
  "text": "Worked on underwater enemy AI and fixed checkpoint bug",
  "date": "2026-05-25"
}
```

Add feedback:

```http
POST /feedback
```

```json
{
  "project": "dynozoic",
  "developer": "Name",
  "text": "Player needs clearer hit feedback",
  "date": "2026-05-25"
}
```

Set this week's target and let Grok refine/save/plan:

```http
POST /weekly-target
```

```json
{
  "project": "eaa",
  "owner": "ทีน",
  "target": "This week make the EAA vertical slice feel playable from start to first boss",
  "weekStart": "2026-05-25"
}
```

This writes to:

- Main `Timeline`: an AI Project Manager timeline row
- `WeeklyTargets`: refined target, success criteria, risks
- `WeeklyPlan`: assigned weekly tasks for `ทีน`, `แมน`, `นน`, or `ภูผา` depending on project roles

Regenerate weekly plan behind the scenes without Discord:

```http
POST /weekly-plan
```

```json
{
  "project": "dynozoic",
  "weekStart": "2026-05-25"
}
```

Analyze both current timelines from backend:

```http
POST /timeline-analysis
```

If `WEB_FORM_SECRET` is set, include:

```text
Authorization: Bearer change-me
```

## Sheet Columns

Main timeline:

`Date, Developer, Raw Update, Summary, Completed, In Progress, Blockers, Next Steps, Tags, Confidence, Source, Created At`

Feedback timeline:

`Date, Developer, Feedback, Summary, Category, Suggested Action, Status, Source, Created At`

Weekly targets:

`Week Start, Project, Owner, Raw Target, AI Refined Target, Success Criteria, Risks, Source, Created At`

Weekly plan:

`Week Start, Project, Assignee, Role, Task, Priority, Success Criteria, Dependencies, Status, Source, Created At`
