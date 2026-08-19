// Pebble — frontend logic.
//
// This file owns everything the Rust side doesn't: showing/hiding the
// window, computing where it sits on screen, growing it as the response
// (or the dashboard) needs, rendering markdown + LaTeX + rich content
// blocks, copy buttons, and talking to Groq.

import "./renderers/catalog.js"; // registers lazy loaders — costs nothing until a block type is used
import { resolveBlockType, BLOCK_TYPES } from "./renderers/blocktypes.js";
import { mountBlock } from "./renderers/shell.js";
import { escapeHtml } from "./renderers/loader-utils.js";
import { KATEX_MACROS } from "./renderers/math/macros.js";
import { copyToClipboard, makeCopyButton } from "./clipboard.js";
import {
  needsWebSearch,
  BROWSER_SEARCH_TOOL,
  cleanSearchResponse,
  extractCitations,
  buildSourcesBlock,
} from "./web-search.js";
import {
  getAutoSave, setAutoSave,
  loadSavedChats, saveChat, deleteChat, relativeTime,
} from "./chat-store.js";
import { initUpdater, installUpdate, manualCheckForUpdate } from "./updater.js";

const { core, event, window: tauriWindow } = window.__TAURI__;
const { invoke } = core;
const { listen } = event;
const { getCurrentWindow, currentMonitor, LogicalPosition, LogicalSize } = tauriWindow;

const appWindow = getCurrentWindow();

// ---------- layout constants (kept in sync with style.css) ----------

const CAPSULE_WIDTH = 560;
const CAPSULE_ROW_HEIGHT = 58; // #capsule-row's fixed height
const GAP = 10;                // space between the capsule and the response panel
const SCROLL_PAD_Y = 20;       // matches #scroll-area's top/bottom padding
const TOP_FRACTION = 0.20;     // the capsule sits 20% below the screen's top edge
const BOTTOM_FRACTION = 0.90;  // the response panel never grows past 10% above the bottom edge

const MODEL = "openai/gpt-oss-120b";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";
const GITHUB_URL = "https://github.com/NuclearVenom/Pebble";

// The block vocabulary taught to the model is intentionally a curated
// subset of everything blocktypes.js supports, not "every full/partial
// renderer" — math/chemistry/molecules/plots are the current priority
// (see docs/RENDERERS.md), and mermaid is included because it's
// demonstrably reliable. The rest of the registered renderers still work
// if a fenced block happens to name them, but aren't actively taught to
// the model yet, so responses don't fill up with a renderer that isn't
// the current focus reaching for a format it uses inconsistently.
const PRIORITY_TYPES = ["math", "chem", "molecule", "mermaid", "plot"];
const BLOCK_VOCAB = BLOCK_TYPES
  .filter((b) => PRIORITY_TYPES.includes(b.type))
  .map((b) => b.type)
  .join(", ");

const SYSTEM_PROMPT = "You are Pebble, a lightweight always-on-top AI overlay " +
  "assistant for the desktop, opened with the Alt+Space shortcut. You run on " +
  "Groq's openai/gpt-oss-120b model. Pebble was created and is maintained by " +
  "Ranasurya Ghosh. If asked who or what you are, or who made you, say you " +
  "are Pebble and credit Ranasurya Ghosh as the creator and maintainer. If " +
  "asked for more information, the source code, or how to contribute, point " +
  "to the GitHub repository at " + GITHUB_URL + ". Keep answers concise and " +
  "well-formatted with markdown.\n\n" +
  "Pebble can render some content types specially: " + BLOCK_VOCAB + ". " +
  "Follow these rules exactly, since getting the format wrong means it " +
  "displays as broken text instead of rendering:\n" +
  "- Math ($...$ for inline, $$...$$ for display, or a ```math fenced " +
  "block — all three work identically) handles quantum/braket notation " +
  "directly: \\ket{0}, \\bra{\\psi}, \\braket{\\phi|\\psi}, and units like " +
  "\\qty{9.8}{m/s^2}. Never write these as plain text like \"|psi>\".\n" +
  "- Chemistry: write \\ce{...} for any formula or reaction (e.g. " +
  "\\ce{2H2 + O2 -> 2H2O}, \\ce{SO4^2-}, \\ce{CaCO3 ->[heat] CaO + CO2}). " +
  "This works anywhere — inline in a sentence, inside a table cell, or in " +
  "a ```chem block — so use whichever fits the surrounding text. The one " +
  "rule: never put \\ce{...} inside single backtick inline code or a " +
  "generic code fence — write it as plain text (or inside a ```chem " +
  "block), and it will render as a proper equation either way.\n" +
  "- Molecular structure (SMILES, e.g. ethanol \"CCO\", aspirin " +
  "\"CC(=O)OC1=CC=CC=C1C(=O)O\") must use a ```molecule fenced block — " +
  "this one has no inline form, so the fence is required.\n" +
  "- ```mermaid works for flowcharts and diagrams.\n" +
  "- ```plot renders a chart from JSON — it must be the ONLY thing in the " +
  "block, valid JSON, no comments. Each series is EITHER a formula " +
  "(\"expression\") OR data (\"points\", or \"x\"+\"y\" arrays) — never " +
  "neither. One function: {\"type\": \"function\", \"expression\": " +
  "\"sin(x)\", \"xMin\": -10, \"xMax\": 10} (expression syntax: +-*/^, " +
  "parentheses, sin/cos/tan/sqrt/exp/log/abs, x as the variable, pi/e as " +
  "constants). Several function curves together, e.g. V=IR at a few " +
  "resistances: {\"type\": \"function\", \"xLabel\": \"I (A)\", " +
  "\"yLabel\": \"V (V)\", \"xMin\": 0, \"xMax\": 0.5, \"series\": " +
  "[{\"label\": \"10 \\u03a9\", \"expression\": \"10*x\"}, {\"label\": " +
  "\"50 \\u03a9\", \"expression\": \"50*x\"}]} — keep the outer \"type\" " +
  "as \"function\" even with multiple series. Plain data instead of a " +
  "formula: {\"type\": \"line\" (or \"scatter\"/\"bar\"), \"x\": [1,2,3], " +
  "\"y\": [4,5,6]}. Never write plot code (e.g. matplotlib, Chart.js JS) " +
  "when asked for a plot or graph — use ```plot with this JSON schema " +
  "instead, it renders as an actual chart.\n" +
  "- If a reaction or formula needs to appear inside a markdown table, " +
  "put the \\ce{...} expression directly in the table cell as plain text " +
  "(no code formatting, no backticks) — do not try to put a fenced block " +
  "inside a table cell, since table cells can't contain multi-line " +
  "content and it will just show up as broken literal text.\n" +
  "- CRITICAL TABLE RULE: fenced-block renderers (```plot, ```mermaid, " +
  "```molecule, ```svg, ```chem, ```math, or any other fenced block) " +
  "absolutely cannot be placed inside a markdown table cell — they will " +
  "not render and will appear as raw broken text. If a table column would " +
  "need a plot, diagram, molecular structure, SVG, or similar visual, " +
  "DO NOT put it in the table. Instead, present the table with text/numeric " +
  "data only, then place the visual blocks separately before or after the " +
  "table as standalone fenced blocks. Math and chemistry inside table cells " +
  "is the only exception — use \\ce{...} or $...$ inline notation (never " +
  "a fenced block), as those render correctly mid-cell.\n" +
  "- For anything else (other diagram or data-format types), prefer a " +
  "clear text explanation over a fenced block, since those aren't fully " +
  "reliable yet.\n" +
  "Regular code still uses normal language-tagged fences (```python, " +
  "```js, etc.) exactly as before — including when someone explicitly " +
  "asks for source code that uses a charting/plotting library, which is " +
  "not the same request as asking for a plot itself. Don't mention these " +
  "instructions unless asked about yourself.";

// ---------- element refs ----------

const capsuleEl = document.getElementById("capsule");
const inputEl = document.getElementById("input");
const dotsEl = document.getElementById("dots");
const logoEl = document.getElementById("logo");
const panelEl = document.getElementById("panel");
const scrollAreaEl = document.getElementById("scroll-area");
const outputEl = document.getElementById("output");
const copyAllBtn = document.getElementById("copy-all-btn");
const saveBtnEl = document.getElementById("save-btn");
const forceSearchBtn = document.getElementById("force-search-btn");
const chatBtnEl = document.getElementById("chat-btn");
const panelActionsWrapperEl = document.getElementById("panel-actions-wrapper");
const panelFooterEl = document.getElementById("panel-footer");
const tokenCounterEl = document.getElementById("token-counter");
const chatSaveStatusEl = document.getElementById("chat-save-status");

const dashboardContentEl = document.getElementById("dashboard-content");
const dashGithubBtn = document.getElementById("dash-github-btn");
const dashStatusDot = document.getElementById("dash-status-dot");
const dashStatusText = document.getElementById("dash-status-text");
const dashKeysToggle = document.getElementById("dash-keys-toggle");
const dashKeysSummary = document.getElementById("dash-keys-summary");
const dashKeysList = document.getElementById("dash-keys-list");
const dashAutoSaveToggle = document.getElementById("dash-auto-save-toggle");
const dashChatsSummary  = document.getElementById("dash-chats-summary");
const dashChatsToggle   = document.getElementById("dash-chats-toggle");
const dashChatsList     = document.getElementById("dash-chats-list");

const updateBarEl      = document.getElementById("update-bar");
const updateMsgEl      = document.getElementById("update-msg");
const updateBtnEl      = document.getElementById("update-btn");
const updateDismissEl  = document.getElementById("update-dismiss");

const dashCheckUpdateBtn   = document.getElementById("dash-check-update-btn");
const dashCheckUpdateLabel = document.getElementById("dash-check-update-label");

// ---------- state ----------

let isOpen = false;
let isStreaming = false;
let fullText = "";             // accumulated text for the CURRENT streaming turn
let baseX = 0, baseY = 0;          // the capsule's anchored screen position
let maxPanelHeight = 400;           // clamp for the response panel's growth
let currentPanelHeight = 0;         // 0 when the response panel is hidden
let currentCapsuleHeight = CAPSULE_ROW_HEIGHT; // grows when the dashboard is open
let dashboardOpen = false;
let abortController = null;
let apiKeys = [];                   // [{ name, value }], every GROQ_API_KEY* found
let apiKeysLoaded = false;
let apiKeysError = null;
let renderScheduled = false;

// ---------- chat mode state ----------

const CHAT_TOKEN_SAFE   = 95_000;  // start evicting old turns at this estimate
const CHAT_TOKEN_WARN   = 80_000;  // footer turns orange
const CHAT_TOKEN_DANGER = 95_000;  // footer turns red

let chatMode = false;
let conversationHistory = []; // [{role,content}] full message list (no system prompt stored here)
let totalTokensUsed = 0;      // rough running estimate
let lastPrompt = "";          // tracks last submitted prompt for seeding chat history
let saveChatEnabled = true;   // per-session save flag (mirrors save btn active state)

// Rough token estimate: 1 token ≈ 4 chars (fast, no tokenizer needed).
function estimateTokens(text) {
  return Math.ceil((typeof text === "string" ? text : JSON.stringify(text)).length / 4);
}

function totalHistoryTokens() {
  const systemTokens = estimateTokens(SYSTEM_PROMPT);
  const historyTokens = conversationHistory.reduce((s, m) => s + estimateTokens(m.content) + 10, 0);
  return systemTokens + historyTokens;
}

function evictOldTurnsIfNeeded() {
  // Drop oldest user+assistant pairs until we're back under budget.
  // conversationHistory has no system prompt entry — it's prepended at send time.
  while (totalHistoryTokens() > CHAT_TOKEN_SAFE && conversationHistory.length >= 2) {
    conversationHistory.splice(0, 2); // remove oldest user + assistant pair
  }
}

function updateTokenCounter() {
  const total = totalHistoryTokens();
  totalTokensUsed = total;
  const k = Math.round(total / 100) / 10; // one decimal kilo-token
  tokenCounterEl.textContent = `~${k}k tokens used`;
  tokenCounterEl.classList.toggle("warn",   total >= CHAT_TOKEN_WARN   && total < CHAT_TOKEN_DANGER);
  tokenCounterEl.classList.toggle("danger", total >= CHAT_TOKEN_DANGER);
}

marked.setOptions({ breaks: true, gfm: true });

// A rich block reports its own size changes (loading -> ready, a
// preview/code toggle) via this event rather than main.js polling anything.
outputEl.addEventListener("pebble:block-resize", () => { resizePanel(); });

// ---------- API keys (fetched once at startup; the dashboard just displays them) ----------

invoke("get_groq_keys")
  .then((keys) => {
    apiKeys = Array.isArray(keys) ? keys : [];
    apiKeysLoaded = true;
    renderKeysSummary();
    // If the dashboard was opened before this resolved, the status check
    // would have found apiKeysLoaded false and stopped at "Checking…"
    // with nothing left to wake it back up — retry it now that keys
    // actually exist to check against.
    if (dashboardOpen && dashStatusText.textContent === "Checking…") checkGroqStatus();
    // Start the background updater now that the app is fully initialized.
    initUpdater();
  })
  .catch((err) => {
    apiKeysError = typeof err === "string" ? err : "Could not read API keys from your environment.";
    apiKeysLoaded = true;
    renderKeysSummary();
    if (dashboardOpen && dashStatusText.textContent === "Checking…") checkGroqStatus();
  });

function maskKeyValue(value) {
  if (!value) return "";
  if (value.length <= 10) return "•".repeat(Math.max(4, value.length));
  return `${value.slice(0, 6)}••••${value.slice(-4)}`;
}

function renderKeysSummary() {
  if (!apiKeysLoaded) {
    dashKeysSummary.textContent = "Checking API keys…";
    return;
  }
  if (apiKeysError) {
    dashKeysSummary.textContent = apiKeysError;
    growDashboardIfOpen();
    return;
  }
  if (apiKeys.length === 0) {
    dashKeysSummary.textContent = "No GROQ_API_KEY found in system env";
    growDashboardIfOpen();
    return;
  }
  dashKeysSummary.textContent = apiKeys.length === 1
    ? "Found 1 API key in system env"
    : `Found ${apiKeys.length} API keys in system env`;

  const inner = document.createElement("div");
  inner.className = "dash-keys-list-inner";
  for (const k of apiKeys) {
    const row = document.createElement("div");
    row.className = "dash-key-item";
    row.innerHTML =
      `<span class="dash-key-name">${escapeHtml(k.name)}</span>` +
      `<span class="dash-key-value">${escapeHtml(maskKeyValue(k.value))}</span>`;
    inner.appendChild(row);
  }
  dashKeysList.innerHTML = "";
  dashKeysList.appendChild(inner);
  if (dashKeysList.classList.contains("open")) {
    dashKeysList.style.height = `${dashKeysList.scrollHeight}px`;
  }
  growDashboardIfOpen();
}

dashKeysToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  const opening = !dashKeysToggle.classList.contains("open");
  dashKeysToggle.classList.toggle("open", opening);
  dashKeysList.classList.toggle("open", opening);
  dashKeysList.style.height = opening ? `${dashKeysList.scrollHeight}px` : "0px";
  growDashboardIfOpen();
});

// ---------- update bar ----------
// Shown above the capsule when a new Pebble release is detected.
// Never pops up — only appears if the widget is currently open.

document.addEventListener("pebble:update-available", (e) => {
  const version = e.detail?.version ?? "";
  updateMsgEl.textContent = version
    ? `New update available — Pebble v${version}`
    : "New update available for Pebble";
  updateBarEl.classList.remove("hidden");
  // Re-apply geometry so the window grows to include the bar.
  if (isOpen) applyGeometry();
});

updateBtnEl.addEventListener("click", async () => {
  updateBtnEl.textContent = "Downloading…";
  updateBtnEl.classList.add("installing");
  let totalBytes = 0;
  let receivedBytes = 0;

  await installUpdate((event) => {
    switch (event.phase) {
      case "downloading":
        if (event.contentLength) totalBytes = event.contentLength;
        receivedBytes += event.downloaded ?? 0;
        if (totalBytes > 0) {
          const pct = Math.round((receivedBytes / totalBytes) * 100);
          updateBtnEl.textContent = `${pct}%`;
          updateMsgEl.textContent = `Downloading update… ${pct}%`;
        } else {
          updateMsgEl.textContent = "Downloading update…";
        }
        break;
      case "done":
        updateBtnEl.textContent = "Restarting…";
        updateMsgEl.textContent = "Update installed — restarting Pebble…";
        break;
      case "error":
        updateBtnEl.textContent = "Retry";
        updateBtnEl.classList.remove("installing");
        updateMsgEl.textContent = event.message ?? "Update failed. Click to retry.";
        break;
    }
  });
});

updateDismissEl.addEventListener("click", () => {
  updateBarEl.classList.add("hidden");
  if (isOpen) applyGeometry();
});

// ---------- Groq status (checked when the dashboard is opened, not continuously) ----------

async function checkGroqStatus() {
  dashStatusDot.className = "status-dot checking";
  dashStatusText.textContent = "Checking…";

  if (!apiKeysLoaded) {
    dashStatusDot.className = "status-dot checking";
    dashStatusText.textContent = "Checking…";
    return;
  }
  if (apiKeys.length === 0) {
    dashStatusDot.className = "status-dot offline";
    dashStatusText.textContent = "Offline";
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(GROQ_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKeys[0].value}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    dashStatusDot.className = res.ok ? "status-dot online" : "status-dot offline";
    dashStatusText.textContent = res.ok ? "Online" : "Offline";
  } catch (e) {
    dashStatusDot.className = "status-dot offline";
    dashStatusText.textContent = "Offline";
  } finally {
    growDashboardIfOpen();
  }
}

// ---------- geometry ----------
// The capsule's screen position never moves and its width never changes —
// only its own height (growing to show the dashboard) and the response
// panel's height (growing as an answer streams in) do, and both stack
// straightforwardly: capsule height, then the panel's height if it's
// visible. The capsule's top-left corner is the one fixed anchor
// everything else grows down from.

async function computeBaseGeometry() {
  const monitor = await currentMonitor();
  const scale = monitor?.scaleFactor || 1;
  const screenW = monitor ? monitor.size.width / scale : window.screen.width;
  const screenH = monitor ? monitor.size.height / scale : window.screen.height;
  const originX = monitor ? monitor.position.x / scale : 0;
  const originY = monitor ? monitor.position.y / scale : 0;

  const x = originX + (screenW - CAPSULE_WIDTH) / 2;
  const y = originY + screenH * TOP_FRACTION;
  const bottomLimit = originY + screenH * BOTTOM_FRACTION;
  const maxHeight = Math.max(80, bottomLimit - (y + CAPSULE_ROW_HEIGHT + GAP));

  return { x, y, maxHeight };
}

async function applyGeometry() {
  const heightExtra = currentPanelHeight > 0 ? GAP + currentPanelHeight : 0;
  const updateBarH = updateBarEl && !updateBarEl.classList.contains("hidden")
    ? updateBarEl.offsetHeight + 8   // 8 = the gap from #app's gap property
    : 0;
  const totalHeight = updateBarH + currentCapsuleHeight + heightExtra;
  // Shift the Y origin up so the capsule stays in its normal position even
  // when the update bar pushes downward.
  await appWindow.setPosition(new LogicalPosition(baseX, baseY - updateBarH));
  await appWindow.setSize(new LogicalSize(CAPSULE_WIDTH, totalHeight));
}

function restartAnimation(el, className) {
  el.classList.remove(className);
  void el.offsetWidth; // force reflow so the animation replays
  el.classList.add(className);
}

// ---------- open / close ----------

async function openWidget() {
  const g = await computeBaseGeometry();
  baseX = g.x;
  baseY = g.y;
  maxPanelHeight = g.maxHeight;
  currentPanelHeight = 0;

  await applyGeometry();
  await appWindow.show();
  await appWindow.setFocus();
  isOpen = true;
  restartAnimation(capsuleEl, "pop");
  inputEl.focus();
}

async function closeWidget() {
  isOpen = false;

  // Persist the conversation before clearing state.
  maybeSaveCurrentChat();

  if (abortController) abortController.abort();
  isStreaming = false;
  inputEl.value = "";
  fullText = "";
  lastPrompt = "";
  outputEl.innerHTML = "";
  panelEl.classList.remove("visible", "pop", "chat-mode");
  panelEl.style.height = "";
  dotsEl.classList.add("hidden");
  currentPanelHeight = 0;

  // Reset chat state
  chatMode = false;
  conversationHistory = [];
  totalTokensUsed = 0;
  saveChatEnabled = getAutoSave();
  chatBtnEl.classList.remove("active");
  saveBtnEl.classList.toggle("active", saveChatEnabled);
  panelFooterEl.classList.add("hidden");
  inputEl.placeholder = "Ask Pebble…";

  dashboardOpen = false;
  capsuleEl.classList.remove("dashboard-open");
  currentCapsuleHeight = CAPSULE_ROW_HEIGHT;
  capsuleEl.style.height = "";
  dashKeysToggle.classList.remove("open");
  dashKeysList.classList.remove("open");
  dashKeysList.style.height = "0px";
  dashChatsToggle.classList.remove("open");
  dashChatsList.classList.remove("open");
  dashChatsList.style.height = "0px";

  // No need to resize back down before hiding — the next openWidget() call
  // recomputes geometry from scratch with this (now reset) state.
  await appWindow.hide();
}

listen("toggle-widget", () => {
  if (isOpen) closeWidget();
  else openWidget();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closeWidget();
    return;
  }
  if (e.key === "Enter" && !dashboardOpen && document.activeElement === inputEl) {
    e.preventDefault();
    const q = inputEl.value.trim();
    if (q) {
      lastPrompt = q; // track for chat seeding
      askGroq(q);
    }
  }
});

inputEl.addEventListener("blur", () => {
  setTimeout(() => {
    // If the user clicked another element inside the widget (like the logo),
    // the document still has focus. We only want to close if they clicked outside the window.
    if (document.hasFocus()) return;

    if (isOpen && inputEl.value.trim() === "" && !isStreaming && currentPanelHeight === 0 && !dashboardOpen) {
      appWindow.hide();
      isOpen = false;
    }
  }, 100);
});

// ---------- panel actions hover ----------

let panelActionsTimeout = null;

panelActionsWrapperEl.addEventListener("mouseenter", () => {
  clearTimeout(panelActionsTimeout);
  panelActionsWrapperEl.classList.add("expanded");
});

panelActionsWrapperEl.addEventListener("mouseleave", () => {
  panelActionsTimeout = setTimeout(() => {
    panelActionsWrapperEl.classList.remove("expanded");
  }, 1000);
});

// ---------- submit ----------

// ---------- dashboard ----------
// The logo morphs the capsule itself downward into the dashboard, rather
// than opening a separate panel — see #capsule in style.css. Clicking the
// logo again (not Escape, which still closes Pebble entirely) returns to
// the plain search bar.

function growDashboardIfOpen() {
  if (!dashboardOpen) return;
  currentCapsuleHeight = CAPSULE_ROW_HEIGHT + dashboardContentEl.scrollHeight;
  capsuleEl.style.height = `${currentCapsuleHeight}px`;
  applyGeometry();
}

function toggleDashboard() {
  dashboardOpen = !dashboardOpen;
  capsuleEl.classList.toggle("dashboard-open", dashboardOpen);

  if (dashboardOpen) {
    inputEl.blur();
    currentCapsuleHeight = CAPSULE_ROW_HEIGHT + dashboardContentEl.scrollHeight;
    checkGroqStatus();
  } else {
    currentCapsuleHeight = CAPSULE_ROW_HEIGHT;
    dashKeysToggle.classList.remove("open");
    dashKeysList.classList.remove("open");
    dashKeysList.style.height = "0px";
    inputEl.focus();
  }
  capsuleEl.style.height = `${currentCapsuleHeight}px`;
  applyGeometry();
}

logoEl.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleDashboard();
});

dashGithubBtn.addEventListener("click", () => {
  invoke("open_url", { url: GITHUB_URL }).catch(() => { /* best effort */ });
});

// "Check for update" button — runs an on-demand check without touching the
// 6-hour auto-check interval (manualCheckForUpdate bypasses shouldCheck()).
dashCheckUpdateBtn.addEventListener("click", async () => {
  if (dashCheckUpdateBtn.classList.contains("checking")) return; // already in-flight

  dashCheckUpdateBtn.classList.add("checking");
  dashCheckUpdateLabel.textContent = "Checking…";

  // Track whether a new update was found during this manual check.
  let foundUpdate = false;
  const onUpdateFound = () => { foundUpdate = true; };
  document.addEventListener("pebble:update-available", onUpdateFound, { once: true });

  await manualCheckForUpdate();

  document.removeEventListener("pebble:update-available", onUpdateFound);
  dashCheckUpdateBtn.classList.remove("checking");

  if (foundUpdate) {
    // The update bar will already have appeared; just confirm in the button.
    dashCheckUpdateLabel.textContent = "Update found!";
  } else {
    dashCheckUpdateLabel.textContent = "Up to date";
  }

  // Reset button label after 3 seconds.
  setTimeout(() => {
    dashCheckUpdateLabel.textContent = "Check for update";
  }, 3000);

  growDashboardIfOpen();
});

copyAllBtn.addEventListener("click", () => {
  // In chat mode, copy all plaintext of all assistant turns.
  if (chatMode) {
    const allAssistant = conversationHistory
      .filter(m => m.role === "assistant")
      .map(m => m.content)
      .join("\n\n---\n\n");
    if (allAssistant) copyToClipboard(allAssistant, copyAllBtn);
  } else {
    if (fullText) copyToClipboard(fullText, copyAllBtn);
  }
});

// Save button — toggles whether this specific conversation will be saved.
saveBtnEl.addEventListener("click", () => {
  saveChatEnabled = !saveChatEnabled;
  saveBtnEl.classList.toggle("active", saveChatEnabled);
  updateSaveStatus();
});

function updateSaveStatus() {
  if (saveChatEnabled) {
    chatSaveStatusEl.textContent = "This chat will be saved and can be found in Pebble's dashboard.";
    chatSaveStatusEl.className = "saved";
  } else {
    chatSaveStatusEl.textContent = "Chat is not saved, you may lose the conversation.";
    chatSaveStatusEl.className = "unsaved";
  }
}

// Attempt to persist the current conversation (if enabled and non-empty).
function maybeSaveCurrentChat() {
  const shouldSave = saveChatEnabled;
  if (!shouldSave) return;
  if (conversationHistory.length === 0) {
    // Single-shot mode — build a temp history from lastPrompt + fullText.
    if (!lastPrompt || !fullText) return;
    saveChat([
      { role: "user",      content: lastPrompt },
      { role: "assistant", content: fullText   },
    ]);
  } else {
    saveChat(conversationHistory);
  }
}

// ---------- auto-save pill toggle ----------

function applyAutoSaveUI() {
  const on = getAutoSave();
  dashAutoSaveToggle.setAttribute("aria-pressed", String(on));
}

// Initialise from stored preference.
applyAutoSaveUI();

dashAutoSaveToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  setAutoSave(!getAutoSave());
  applyAutoSaveUI();
  growDashboardIfOpen();
});

// ---------- saved chats panel ----------

function renderSavedChats() {
  const chats = loadSavedChats();
  const count = chats.length;

  dashChatsSummary.textContent = count > 0 ? `Saved Chats (${count})` : "Saved Chats";

  const inner = document.createElement("div");
  inner.className = "dash-section-list-inner";

  if (count === 0) {
    const empty = document.createElement("div");
    empty.className = "dash-chat-empty";
    empty.textContent = "No saved chats yet.";
    inner.appendChild(empty);
  } else {
    for (const chat of chats) {
      const row = document.createElement("div");
      row.className = "dash-chat-item";

      const info = document.createElement("div");
      info.className = "dash-chat-info";

      const titleEl = document.createElement("div");
      titleEl.className = "dash-chat-title";
      titleEl.textContent = chat.title || "Untitled";

      const metaEl = document.createElement("div");
      metaEl.className = "dash-chat-meta";
      metaEl.textContent = relativeTime(chat.savedAt);

      info.appendChild(titleEl);
      info.appendChild(metaEl);

      const delBtn = document.createElement("button");
      delBtn.className = "dash-chat-delete";
      delBtn.title = "Delete this chat";
      delBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M3 4h10M6 4V3h4v1M5 4l.5 9h5L11 4"/>
      </svg>`;
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteChat(chat.id);
        renderSavedChats();
        if (dashChatsList.classList.contains("open")) {
          dashChatsList.style.height = `${dashChatsList.scrollHeight}px`;
        }
        growDashboardIfOpen();
      });

      row.appendChild(info);
      row.appendChild(delBtn);

      row.addEventListener("click", () => restoreChat(chat));

      inner.appendChild(row);
    }
  }

  dashChatsList.innerHTML = "";
  dashChatsList.appendChild(inner);

  if (dashChatsList.classList.contains("open")) {
    dashChatsList.style.height = `${dashChatsList.scrollHeight}px`;
  }
}

dashChatsToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  const opening = !dashChatsToggle.classList.contains("open");
  dashChatsToggle.classList.toggle("open", opening);
  dashChatsList.classList.toggle("open", opening);
  if (opening) {
    renderSavedChats();
    dashChatsList.style.height = `${dashChatsList.scrollHeight}px`;
  } else {
    dashChatsList.style.height = "0px";
  }
  growDashboardIfOpen();
});

// ---------- restore a saved chat ----------

async function restoreChat(savedChat) {
  // Close dashboard first.
  toggleDashboard();

  // Reset current session.
  if (abortController) abortController.abort();
  isStreaming = false;
  fullText = "";
  lastPrompt = "";

  // Load conversation into state.
  conversationHistory = savedChat.messages.map(m => ({ ...m }));
  totalTokensUsed = 0;

  // Switch to chat mode (without overwriting conversationHistory).
  chatMode = true;
  chatBtnEl.classList.add("active");
  panelFooterEl.classList.remove("hidden");
  panelEl.classList.add("chat-mode");
  inputEl.placeholder = "Ask a follow-up…";
  inputEl.value = "";
  saveChatEnabled = true;
  saveBtnEl.classList.add("active");
  updateSaveStatus();
  updateTokenCounter();

  // Render the conversation history into the output DOM.
  outputEl.innerHTML = "";
  for (let i = 0; i < conversationHistory.length; i++) {
    const msg = conversationHistory[i];
    if (msg.role === "user") {
      const bubble = document.createElement("div");
      bubble.className = "chat-user-bubble";
      bubble.innerHTML = `<div class="chat-user-bubble-inner">${escapeHtml(msg.content)}</div>`;
      outputEl.appendChild(bubble);
    } else if (msg.role === "assistant") {
      const block = document.createElement("div");
      block.className = "chat-assistant-block";
      renderIntoBlock(block, msg.content);
      outputEl.appendChild(block);

      // Add per-turn action buttons for all but the last turn
      // (the user can regen or copy from the last one naturally).
      const promptMsg = conversationHistory[i - 1];
      if (promptMsg) {
        appendTurnActions(block, promptMsg.content, msg.content);
      }

      // Add divider between turns (not after the very last block).
      const hasMore = conversationHistory.slice(i + 1).some(m => m.role === "user");
      if (hasMore) {
        const divider = document.createElement("div");
        divider.className = "chat-turn-divider";
        outputEl.appendChild(divider);
      }
    }
  }

  showPanel();
  await resizePanel();
  inputEl.focus();
  // Scroll to bottom so the most recent turn is visible.
  requestAnimationFrame(() => {
    scrollAreaEl.scrollTop = scrollAreaEl.scrollHeight;
  });
}

// Chat button — enters chat mode from the current single-shot response.
chatBtnEl.addEventListener("click", () => {
  if (chatMode || isStreaming) return; // already in chat mode or mid-stream
  enterChatMode();
});

forceSearchBtn.addEventListener("click", () => {
  if (isStreaming) return;
  const prompt = inputEl.value.trim();
  if (!prompt) return;
  
  if (chatMode) {
    // If somehow clicked in chat mode, do a chat turn with search
    askGroqWithSearch(prompt, abortController || new AbortController(), () => true, true, true);
  } else {
    // Single shot forced search
    askGroqWithSearch(prompt, abortController || new AbortController(), () => true, false, true);
  }
});

function enterChatMode() {
  chatMode = true;
  chatBtnEl.classList.add("active");
  panelFooterEl.classList.remove("hidden");
  panelEl.classList.add("chat-mode");
  inputEl.placeholder = "Ask a follow-up…";
  inputEl.value = ""; // clear the bar when entering chat mode

  // Save button is ON by default when entering chat mode.
  saveChatEnabled = true;
  saveBtnEl.classList.add("active");
  updateSaveStatus();

  // Seed conversation history with the Q&A already visible in the panel.
  if (lastPrompt && fullText) {
    conversationHistory = [
      { role: "user",      content: lastPrompt },
      { role: "assistant", content: fullText   },
    ];
  }
  updateTokenCounter();
  updateSaveStatus();

  // Prepend the first-prompt bubble above the existing assistant content,
  // then wrap that content in a .chat-assistant-block for consistent styling.
  const existingNodes = Array.from(outputEl.childNodes);
  if (existingNodes.length > 0 && lastPrompt) {
    // User bubble for the original question
    const bubble = document.createElement("div");
    bubble.className = "chat-user-bubble";
    bubble.innerHTML = `<div class="chat-user-bubble-inner">${escapeHtml(lastPrompt)}</div>`;
    outputEl.insertBefore(bubble, outputEl.firstChild);

    // Wrap existing response nodes in an assistant block
    const wrapper = document.createElement("div");
    wrapper.className = "chat-assistant-block";
    // existingNodes was snapshotted before the bubble insert; re-collect
    // everything after the bubble (i.e. the original response nodes)
    Array.from(outputEl.childNodes)
      .filter(n => n !== bubble)
      .forEach(n => wrapper.appendChild(n));
    outputEl.appendChild(wrapper);
  }

  // Resize in case footer changed layout.
  resizePanel();
}

// ---------- markdown + LaTeX rendering ----------
// Math is pulled out before marked touches the text (so things like `x_i`
// inside a formula don't get mangled by markdown's emphasis rules), then
// rendered with KaTeX and spliced back into the HTML marked produced.
//
// Every pattern below refuses to match across a blank line (a paragraph
// break). That's what keeps a single malformed/unclosed delimiter from the
// model — which happens occasionally in long technical answers — from
// swallowing everything after it into one giant, unparseable "equation":
// the damage is contained to the one paragraph it actually appears in.
//
// Rendering happens block-by-block (via marked's lexer, rather than one
// marked.parse() call) so each block can carry its own copy button, sourced
// from that block's own original text — and so a fenced block naming a
// registered semantic type (```mermaid, ```chem, ```svg, ...) can be
// diverted to the rich-content renderer registry instead of a plain code
// block. See renderers/registry.js and renderers/shell.js.

const NO_BLANK_LINE = "(?:(?!\\n[ \\t]*\\n)[\\s\\S])+?";

// Chemistry notation is extracted the same way math is — by scanning the
// raw text for \ce{...}/\pu{...} directly, before marked or protectMath
// even run — rather than only through the ```chem fence. This is what
// makes it work no matter how the model formats it: as its own paragraph,
// inline mid-sentence, wrapped in single-backtick inline code, or even
// inside a markdown table cell. mhchem's braces can nest (e.g. "Fe^{3+}"
// or "[Cu(NH3)4]^2+"), so this does real brace-depth matching rather than
// a non-greedy regex, which would break on the first inner "}".
function extractChem(text) {
  const chemBlocks = [];
  let out = "";
  let i = 0;
  while (i < text.length) {
    const isChem = text.startsWith("\\ce{", i) || text.startsWith("\\pu{", i);
    if (isChem) {
      let depth = 1;
      let j = i + 4; // past "\ce{" / "\pu{"
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        j++;
      }
      if (depth === 0) {
        let end = j;
        if (out.endsWith("`") && text[end] === "`") {
          out = out.slice(0, -1);
          end += 1;
        }
        const token = `\u0002CHEM${chemBlocks.length}\u0002`;
        chemBlocks.push(text.slice(i, j));
        out += token;
        i = end;
        continue;
      }
    }
    out += text[i];
    i++;
  }
  return { text: out, chemBlocks };
}

function renderChem(raw) {
  try {
    return katex.renderToString(raw, { throwOnError: true, displayMode: true, strict: false, macros: { ...KATEX_MACROS } });
  } catch (e) {
    return `<div class="pebble-math-fallback">${escapeHtml(raw)}</div>`;
  }
}

function restoreChemHtml(html, chemBlocks) {
  return html.replace(/\u0002CHEM(\d+)\u0002/g, (_, i) => renderChem(chemBlocks[Number(i)]));
}

function restoreChemRaw(text, chemBlocks) {
  return text.replace(/\u0002CHEM(\d+)\u0002/g, (_, i) => chemBlocks[Number(i)]);
}

function protectMath(text) {
  const blocks = [];
  const stash = (raw, src, display) => {
    if (/^[\.\s…]+$/.test(src)) return raw;
    const token = `\u0001MATH${blocks.length}\u0001`;
    blocks.push({ raw, src: src.trim(), display });
    return token;
  };
  let out = text;
  out = out.replace(new RegExp(`\\$\\$(${NO_BLANK_LINE})\\$\\$`, "g"), (whole, inner) => stash(whole, inner, true));
  out = out.replace(new RegExp(`\\\\\\[(${NO_BLANK_LINE})\\\\\\]`, "g"), (whole, inner) => stash(whole, inner, true));
  out = out.replace(new RegExp(`\\\\\\((${NO_BLANK_LINE})\\\\\\)`, "g"), (whole, inner) => stash(whole, inner, false));
  out = out.replace(/\$([^\$\n]+?)\$/g, (whole, inner) => stash(whole, inner, false));
  return { text: out, blocks };
}

// Renders with KaTeX ourselves (throwOnError: true) rather than letting
// KaTeX draw its own red error text — an expression we can't parse just
// falls back to plain, quiet text instead of an alarming red blob.
function renderMath(src, display) {
  try {
    return katex.renderToString(src, { throwOnError: true, displayMode: display, strict: false, macros: { ...KATEX_MACROS } });
  } catch (e) {
    const escaped = escapeHtml(src);
    return display
      ? `<div class="pebble-math-fallback">${escaped}</div>`
      : `<span class="pebble-math-fallback">${escaped}</span>`;
  }
}

function restoreHtml(html, blocks) {
  return html.replace(/\u0001MATH(\d+)\u0001/g, (_, i) => {
    const b = blocks[Number(i)];
    return renderMath(b.src, b.display);
  });
}

function restoreRaw(text, blocks) {
  return text.replace(/\u0001MATH(\d+)\u0001/g, (_, i) => blocks[Number(i)].raw);
}

// A fenced block is only handed to a renderer once its closing fence has
// actually streamed in — this counts fence-marker lines in marked's raw
// match for the token (marked itself auto-closes an unterminated fence at
// end-of-input, so an in-progress block still tokenizes as type "code",
// just with only one fence-marker line rather than two).
function isFenceClosed(raw) {
  const fenceLines = raw.match(/^[ \t]*(`{3,}|~{3,})/gm);
  return !!fenceLines && fenceLines.length >= 2;
}

function buildGeneratingPlaceholder(semanticType) {
  const wrapper = document.createElement("div");
  wrapper.className = "pebble-block";
  const box = document.createElement("div");
  box.className = "rich-block-generating";
  box.innerHTML = `<span class="rich-block-spinner"></span><span>Generating ${escapeHtml(semanticType)}…</span>`;
  wrapper.appendChild(box);
  return wrapper;
}

function buildMathBlock(source) {
  const wrapper = document.createElement("div");
  wrapper.className = "pebble-block";
  wrapper.innerHTML = renderMath(source.trim(), true);
  wrapper.appendChild(makeCopyButton(() => source.trim()));
  return wrapper;
}

// protectMath()/extractChem() run on the whole response before marked ever
// sees it, so a semantic block's token.text/token.raw is sourced from
// that already-substituted text. In the rare case a block's own content
// happens to contain something those patterns matched (an unescaped "$",
// "\(...\)", or "\ce{...}" inside, say, a ```svg block, or a ```chem
// fenced block whose content also gets caught by extractChem() first),
// restoring here guarantees the renderer always gets the model's actual
// original text, never a leftover placeholder token.
function buildSemanticBlock(token, mathBlocks, chemBlocks) {
  const lang = (token.lang || "").trim().split(/\s+/)[0].toLowerCase();
  const semanticType = resolveBlockType(lang);
  if (!semanticType) return null;

  if (!isFenceClosed(token.raw)) return buildGeneratingPlaceholder(semanticType);

  const source = restoreChemRaw(restoreRaw(token.text, mathBlocks), chemBlocks);
  if (semanticType === "math") return buildMathBlock(source);

  const wrapper = document.createElement("div");
  wrapper.className = "pebble-block";
  wrapper.appendChild(mountBlock(semanticType, source, { rawLang: lang }));
  return wrapper;
}

// A table can end up wider than the panel — long column headers, or an
// unwrappable KaTeX equation inside a cell — and #scroll-area clips
// horizontal overflow rather than showing a scrollbar for it (that's
// deliberate everywhere else, so a wide code block or diagram doesn't
// force the whole message wider). Tables get their own scroll container
// instead of just being cut off.
// Columns beyond this threshold make every column too narrow — force hscroll.
const TABLE_HSCROLL_COL_THRESHOLD = 5;

function tableNeedsHScroll(table) {
  // Many columns → each becomes too thin; use horizontal scroll.
  const headerCols = table.querySelectorAll("thead tr:first-child th, thead tr:first-child td");
  if (headerCols.length > TABLE_HSCROLL_COL_THRESHOLD) return true;

  // Any cell that contains KaTeX-rendered math or mhchem chemistry must not
  // be broken across lines — detect by looking for .katex or .mhchem nodes.
  const hasMathOrChem =
    table.querySelector(".katex, .mhchem, .katex-html, .katex-display") !== null;
  if (hasMathOrChem) return true;

  return false;
}

function wrapTables(wrapper) {
  for (const table of wrapper.querySelectorAll("table")) {
    const scrollWrap = document.createElement("div");
    scrollWrap.className = "pebble-table-scroll";
    if (tableNeedsHScroll(table)) scrollWrap.classList.add("needs-hscroll");
    table.parentNode.insertBefore(scrollWrap, table);
    scrollWrap.appendChild(table);
  }
}

function renderOutput() {
  const { text: chemStripped, chemBlocks } = extractChem(fullText);
  const { text, blocks } = protectMath(chemStripped);
  const tokens = marked.lexer(text);
  const frag = document.createDocumentFragment();

  for (const token of tokens) {
    if (token.type === "space" || token.type === "def") continue;

    if (token.type === "code") {
      const semanticBlock = buildSemanticBlock(token, blocks, chemBlocks);
      if (semanticBlock) {
        frag.appendChild(semanticBlock);
        continue;
      }
    }

    // Ordinary block (paragraph, list, heading, table, blockquote, or a
    // code block with no registered renderer) — unchanged path, just also
    // restoring any \ce{}/\pu{} that landed inside it (this is what makes
    // chemistry inside a table cell, for instance, still render).
    const single = [token];
    single.links = tokens.links;
    const html = restoreChemHtml(restoreHtml(marked.parser(single), blocks), chemBlocks);

    const wrapper = document.createElement("div");
    wrapper.className = "pebble-block";
    wrapper.innerHTML = html;
    wrapTables(wrapper);

    const copySource = token.type === "code"
      ? token.text
      : restoreChemRaw(restoreRaw(token.raw, blocks), chemBlocks).trim();
    if (copySource) wrapper.appendChild(makeCopyButton(() => copySource));

    frag.appendChild(wrapper);
  }

  outputEl.innerHTML = "";
  outputEl.appendChild(frag);
  fixEdgeMargins();
}

// The copy button is appended as a DOM sibling of each block's rendered
// content, which means it — not the content — is what :last-child would
// match in CSS. Zero the real top/bottom margins here instead.
function fixEdgeMargins() {
  const blocks = outputEl.querySelectorAll(".pebble-block");
  if (blocks.length === 0) return;
  const first = blocks[0].querySelector(":scope > *:not(.copy-btn)");
  if (first) first.style.marginTop = "0";
  const last = blocks[blocks.length - 1].querySelector(":scope > *:not(.copy-btn)");
  if (last) last.style.marginBottom = "0";
}

function showError(message) {
  outputEl.innerHTML = `<div class="pebble-error">${escapeHtml(message)}</div>`;
}

// ---------- panel sizing ----------
// The capsule's top stays put; only the panel's height changes, so the
// widget always grows downward from the same fixed point.

async function resizePanel() {
  const contentHeight = outputEl.scrollHeight;
  let desired = contentHeight + SCROLL_PAD_Y * 2;
  if (chatMode) {
    desired += 36; // leave room for the footer
  }
  const panelHeight = Math.min(desired, maxPanelHeight);
  panelEl.style.height = `${panelHeight}px`;
  currentPanelHeight = panelHeight;
  await applyGeometry();
}

function scheduleUpdate() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(async () => {
    renderScheduled = false;
    renderOutput();
    await resizePanel();
    outputEl.scrollTop = outputEl.scrollHeight;
  });
}

function showPanel() {
  if (panelEl.classList.contains("visible")) return;
  panelEl.classList.add("visible");
  restartAnimation(panelEl, "pop");
}

// ---------- Groq streaming ----------
// Every configured GROQ_API_KEY* is tried in order until one returns a
// successful response; a key that's invalid, unauthorized, or rate-limited
// just falls through to the next. All keys are retried fresh on every
// question (nothing is permanently blacklisted), since an issue like a
// rate limit is often transient.

// messages: [{role,content},...] — system prompt is always prepended here.
// options.tools: optional array of Groq tool definitions to attach.
// options.webSearch: true when browser_search tools are active — injects the
//   current date and a grounding instruction so the model knows its training
//   data may be stale and must defer to web results.
async function requestWithFallback(messages, signal, options = {}) {
  let systemContent = SYSTEM_PROMPT;
  if (options.webSearch) {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    systemContent +=
      `\n\nCurrent date: ${dateStr}. ` +
      "You have access to live web search results. " +
      "Always use those search results as your primary source for any question about current events, recent outcomes, prices, standings, or anything that may have changed since your training cutoff. " +
      "If the search results contradict your training knowledge, trust the search results. " +
      "Do not fall back to training data when search results are available.";
  }
  const body = {
    model: MODEL,
    stream: true,
    messages: [
      { role: "system", content: systemContent },
      ...messages,
    ],
  };
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = options.tool_choice ?? "auto";
  }
  let lastErrorMessage = null;
  for (const keyEntry of apiKeys) {
    let res;
    try {
      res = await fetch(GROQ_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${keyEntry.value}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (networkErr) {
      if (networkErr?.name === "AbortError") throw networkErr;
      lastErrorMessage = networkErr?.message || "Network error.";
      continue;
    }

    if (res.ok && res.body) return res;

    let detail = `Request failed (${res.status})`;
    try {
      const bodyJson = await res.json();
      if (bodyJson?.error?.message) detail = bodyJson.error.message;
    } catch (_) { /* response wasn't JSON, keep the generic message */ }
    lastErrorMessage = detail;
  }
  throw new Error(lastErrorMessage || "All configured API keys failed.");
}

// ---------- streaming helper (shared between single-shot and chat) ----------

// Streams a Groq response into onDelta(delta) callbacks.
// Also fires onToolStatus(message) when a tool_call chunk is received so the
// caller can update the UI status indicator.
// Returns the full accumulated text.
async function streamResponse(messages, signal, onDelta, options = {}) {
  const res = await requestWithFallback(messages, signal, options);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  const onToolStatus = options.onToolStatus ?? null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const choice = json.choices?.[0];
        if (!choice) continue;

        // Tool call chunk — update status UI, do not emit content.
        if (choice.delta?.tool_calls) {
          if (onToolStatus) onToolStatus("Searching the internet…");
          continue;
        }

        // When the model finished a tool call and is now writing its answer,
        // update the status to indicate the review phase.
        if (choice.finish_reason === "tool_calls") {
          if (onToolStatus) onToolStatus("Reviewing sources…");
          continue;
        }

        const delta = choice.delta?.content;
        if (delta) {
          accumulated += delta;
          onDelta(delta);
        }
      } catch (_) { /* ignore partial JSON fragments */ }
    }
  }
  return accumulated;
}

// ---------- chat-mode turn appender ----------

// Appends a user bubble + live streaming assistant block for a new chat turn.
// Returns the container element so the caller can finalise it.
function appendChatTurn(prompt) {
  // Divider between turns (skip before the very first turn wrapper)
  if (outputEl.children.length > 0) {
    const divider = document.createElement("div");
    divider.className = "chat-turn-divider";
    outputEl.appendChild(divider);
  }

  // User bubble
  const bubble = document.createElement("div");
  bubble.className = "chat-user-bubble";
  bubble.innerHTML = `<div class="chat-user-bubble-inner">${escapeHtml(prompt)}</div>`;
  outputEl.appendChild(bubble);

  // Assistant block — starts empty, filled as chunks arrive
  const assistantBlock = document.createElement("div");
  assistantBlock.className = "chat-assistant-block";
  outputEl.appendChild(assistantBlock);

  return assistantBlock;
}

// Appends per-turn action buttons (copy, regenerate) under an assistant turn in chat mode.
function appendTurnActions(container, promptText, answerText) {
  const actionsBar = document.createElement("div");
  actionsBar.className = "chat-turn-actions";

  // Copy button
  const copyBtn = document.createElement("button");
  copyBtn.className = "panel-action-btn copy-btn";
  copyBtn.title = "Copy response";
  copyBtn.innerHTML = `
    <svg class="icon-copy" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
      <rect x="5.5" y="5.5" width="8" height="9" rx="1.5" />
      <path d="M3.5 10.5V3a1.5 1.5 0 0 1 1.5-1.5h6.5" />
    </svg>
    <svg class="icon-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  `;
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(answerText);
    copyBtn.classList.add("copied");
    setTimeout(() => copyBtn.classList.remove("copied"), 1500);
  });
  actionsBar.appendChild(copyBtn);

  // Regenerate with web search button
  const regenBtn = document.createElement("button");
  regenBtn.className = "panel-action-btn regen-btn";
  regenBtn.title = "Regenerate with web search";
  regenBtn.innerHTML = `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
      <circle cx="8" cy="8" r="6" />
      <ellipse cx="8" cy="8" rx="3" ry="6" />
      <path d="M2 8h12" />
    </svg>
  `;
  regenBtn.addEventListener("click", () => {
    if (isStreaming) return;
    askGroqWithSearch(promptText, abortController || new AbortController(), () => true, true, true);
  });
  actionsBar.appendChild(regenBtn);

  // Instead of inside the assistantBlock (which receives markdown), we append it as a sibling.
  // Wait, if it's a sibling, we should append it after the assistantBlock.
  container.insertAdjacentElement("afterend", actionsBar);
}

async function askGroq(prompt) {
  const myController = new AbortController();
  if (abortController) abortController.abort();
  abortController = myController;
  const isCurrent = () => abortController === myController;

  if (!apiKeysLoaded) {
    showPanel();
    showError("Still reading API keys from your environment — try again in a moment.");
    await resizePanel();
    return;
  }
  if (apiKeys.length === 0) {
    showPanel();
    showError(apiKeysError || "No GROQ_API_KEY (or GROQ_API_KEY_*) found in your environment.");
    await resizePanel();
    return;
  }

  isStreaming = true;
  dotsEl.classList.remove("hidden");

  const useSearch = needsWebSearch(prompt);

  if (chatMode) {
    if (useSearch) {
      await askGroqWithSearch(prompt, myController, isCurrent, /* isChat */ true);
    } else {
      await askGroqChat(prompt, myController, isCurrent);
    }
  } else {
    if (useSearch) {
      await askGroqWithSearch(prompt, myController, isCurrent, /* isChat */ false);
    } else {
      await askGroqSingleShot(prompt, myController, isCurrent);
    }
  }
}

// ---- single-shot mode (original behaviour) ----

async function askGroqSingleShot(prompt, myController, isCurrent) {
  fullText = "";
  outputEl.innerHTML = "";
  let firstChunk = true;

  try {
    const accumulated = await streamResponse(
      [{ role: "user", content: prompt }],
      myController.signal,
      (delta) => {
        if (!isCurrent()) return;
        dotsEl.classList.add("hidden");
        if (firstChunk) { showPanel(); firstChunk = false; }
        fullText += delta;
        scheduleUpdate();
      },
    );
    if (isCurrent()) {
      fullText = accumulated; // in case scheduleUpdate lagged
      // Auto-save single-shot response if global setting is on.
      if (getAutoSave() && saveChatEnabled) {
        maybeSaveCurrentChat();
      }
    }
  } catch (err) {
    if (err?.name === "AbortError" || !isCurrent()) return;
    showPanel();
    showError(err?.message || "Something went wrong talking to Groq.");
    await resizePanel();
  } finally {
    if (isCurrent()) {
      isStreaming = false;
      dotsEl.classList.add("hidden");
    }
  }
}

// ---- web-search mode (single-shot or chat, with browser_search tool) ----

async function askGroqWithSearch(prompt, myController, isCurrent, isChat, forceTool = false) {
  // Prepare messages list (same as chat or single-shot path)
  let messages;
  if (isChat) {
    conversationHistory.push({ role: "user", content: prompt });
    evictOldTurnsIfNeeded();
    messages = conversationHistory;
  } else {
    fullText = "";
    outputEl.innerHTML = "";
    messages = [{ role: "user", content: prompt }];
  }

  // Show panel and status indicator before any content arrives.
  showPanel();

  // In chat mode, add the user bubble first.
  let assistantContainer;
  if (isChat) {
    inputEl.value = "";
    assistantContainer = appendChatTurn(prompt);
    requestAnimationFrame(() => {
      const bubble = assistantContainer.previousElementSibling;
      if (bubble) scrollAreaEl.scrollTop = bubble.offsetTop - 8;
    });
  }

  // Insert the animated status row.
  const statusEl = document.createElement("div");
  statusEl.className = "web-search-status";
  statusEl.innerHTML = `<span class="web-search-spinner"></span><span class="web-search-label">Searching the internet\u2026</span>`;
  const labelEl = statusEl.querySelector(".web-search-label");

  if (isChat) {
    assistantContainer.appendChild(statusEl);
  } else {
    outputEl.appendChild(statusEl);
  }
  dotsEl.classList.add("hidden");
  await resizePanel();

  let turnText = "";
  let firstChunk = true;
  let renderPending = false;

  // Target container where the rendered answer goes (separate from statusEl).
  const answerContainer = isChat ? assistantContainer : null;

  function scheduleSearchRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(async () => {
      renderPending = false;
      if (isChat) {
        renderIntoBlock(answerContainer, turnText);
      } else {
        fullText = turnText;
        renderOutput();
      }
      await resizePanel();
      if (isChat) scrollAreaEl.scrollTop = scrollAreaEl.scrollHeight;
    });
  }

  try {
    const accumulated = await streamResponse(
      messages,
      myController.signal,
      (delta) => {
        if (!isCurrent()) return;
        // Once content starts arriving, fade the status row.
        if (firstChunk) {
          statusEl.classList.add("done");
          firstChunk = false;
        }
        turnText += delta;
        scheduleSearchRender();
      },
      {
        tools: [BROWSER_SEARCH_TOOL],
        tool_choice: forceTool ? "required" : "auto",
        webSearch: true,
        onToolStatus: (msg) => {
          if (isCurrent() && labelEl) labelEl.textContent = msg;
        },
      },
    );

    if (isCurrent()) {
      // Strip Groq's internal annotation tags before final render.
      turnText = cleanSearchResponse(accumulated);
      // Final clean render.
      if (isChat) {
        renderIntoBlock(answerContainer, turnText);
      } else {
        fullText = turnText;
        renderOutput();
      }
      await resizePanel();

      // Remove status row now that rendering is complete.
      if (statusEl.parentNode) {
        statusEl.remove();
      }

      // Extract citations and append sources block.
      const citations = extractCitations(turnText);
      const sourcesEl = buildSourcesBlock(citations, (url) => {
        invoke("open_url", { url }).catch(() => {});
      });
      if (sourcesEl) {
        if (isChat) {
          assistantContainer.appendChild(sourcesEl);
        } else {
          // Wrap in a pebble-block so it sits in the normal layout.
          const wrapper = document.createElement("div");
          wrapper.className = "pebble-block";
          wrapper.appendChild(sourcesEl);
          outputEl.appendChild(wrapper);
        }
        await resizePanel();
      }

      // Commit to chat history.
      if (isChat) {
        conversationHistory.push({ role: "assistant", content: turnText });
        updateTokenCounter();
        appendTurnActions(assistantContainer, prompt, turnText);
      }
    }
  } catch (err) {
    if (err?.name === "AbortError" || !isCurrent()) return;
    if (statusEl.parentNode) statusEl.remove();
    const errMsg = err?.message || "Something went wrong during web search.";
    if (isChat) {
      assistantContainer.innerHTML = `<div class="pebble-error">${escapeHtml(errMsg)}</div>`;
      if (conversationHistory[conversationHistory.length - 1]?.role === "user") {
        conversationHistory.pop();
      }
    } else {
      showError(errMsg);
    }
    await resizePanel();
  } finally {
    if (isCurrent()) {
      isStreaming = false;
      dotsEl.classList.add("hidden");
    }
  }
}

// ---- chat mode ----

async function askGroqChat(prompt, myController, isCurrent) {
  // 1. Add user turn to history and evict if over budget.
  conversationHistory.push({ role: "user", content: prompt });
  evictOldTurnsIfNeeded();

  // 2. Build the turn UI (user bubble + empty assistant block).
  showPanel();
  inputEl.value = "";
  const assistantBlock = appendChatTurn(prompt);

  // Scroll so the user bubble's top is visible (not the very bottom).
  // We read offsetTop after a rAF so the layout has settled.
  requestAnimationFrame(() => {
    const bubble = assistantBlock.previousElementSibling; // the .chat-user-bubble
    if (bubble) {
      scrollAreaEl.scrollTop = bubble.offsetTop - 8; // 8px breathing room above the bubble
    }
  });

  // 3. Stream the response, rendering chunks live into assistantBlock.
  let turnText = "";
  let renderPending = false;

  function scheduleChatRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(async () => {
      renderPending = false;
      renderIntoBlock(assistantBlock, turnText);
      await resizePanel();
      // Don't auto-scroll during streaming — keep the user bubble in view.
    });
  }

  try {
    dotsEl.classList.add("hidden");
    const accumulated = await streamResponse(
      conversationHistory,
      myController.signal,
      (delta) => {
        if (!isCurrent()) return;
        turnText += delta;
        scheduleChatRender();
      },
    );

    if (isCurrent()) {
      // Final clean render.
      turnText = accumulated;
      renderIntoBlock(assistantBlock, turnText);
      await resizePanel();

      // 4. Commit assistant turn to history and refresh token counter.
      conversationHistory.push({ role: "assistant", content: turnText });
      updateTokenCounter();
      appendTurnActions(assistantBlock, prompt, turnText);
    }
  } catch (err) {
    if (err?.name === "AbortError" || !isCurrent()) return;
    assistantBlock.innerHTML = `<div class="pebble-error">${escapeHtml(err?.message || "Something went wrong.")}</div>`;
    // Remove the failed user turn from history so it doesn't pollute future sends.
    if (conversationHistory[conversationHistory.length - 1]?.role === "user") {
      conversationHistory.pop();
    }
    await resizePanel();
  } finally {
    if (isCurrent()) {
      isStreaming = false;
      dotsEl.classList.add("hidden");
    }
  }
}

// Renders markdown+math into a given container element (used per chat turn).
function renderIntoBlock(container, text) {
  const { text: chemStripped, chemBlocks } = extractChem(text);
  const { text: protected_, blocks } = protectMath(chemStripped);
  const tokens = marked.lexer(protected_);
  const frag = document.createDocumentFragment();

  for (const token of tokens) {
    if (token.type === "space" || token.type === "def") continue;

    if (token.type === "code") {
      const semanticBlock = buildSemanticBlock(token, blocks, chemBlocks);
      if (semanticBlock) {
        frag.appendChild(semanticBlock);
        continue;
      }
    }

    const single = [token];
    single.links = tokens.links;
    const html = restoreChemHtml(restoreHtml(marked.parser(single), blocks), chemBlocks);
    const wrapper = document.createElement("div");
    wrapper.className = "pebble-block";
    wrapper.innerHTML = html;
    wrapTables(wrapper);

    const copySource = token.type === "code"
      ? token.text
      : restoreChemRaw(restoreRaw(token.raw, blocks), chemBlocks).trim();
    if (copySource) wrapper.appendChild(makeCopyButton(() => copySource));
    frag.appendChild(wrapper);
  }

  container.innerHTML = "";
  container.appendChild(frag);
  // Note: fixEdgeMargins scoped to the outputEl won't be called here;
  // chat turns are self-contained blocks so edge margins are less critical.
}
