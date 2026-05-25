const state = {
  secret: localStorage.getItem("eccentrixSecret") || "",
  status: null,
};

const output = document.querySelector("#output");
const secretInput = document.querySelector("#secretInput");
const statusGrid = document.querySelector("#statusGrid");
const interactionEndpoint = document.querySelector("#interactionEndpoint");

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
    output.textContent = "พร้อมใช้งาน";
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
}

async function submitForm(form) {
  const button = form.querySelector('button[type="submit"]');
  const data = Object.fromEntries(new FormData(form).entries());

  Object.keys(data).forEach((key) => {
    if (data[key] === "") delete data[key];
  });

  await postJson(form.dataset.endpoint, data, button);
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
