// web-search.js — Pebble web research abstraction.
//
// This module isolates all web-search concerns so that main.js does not
// depend on Groq-specific tool implementation details. The public API is:
//
//   needsWebSearch(prompt)          → bool
//   BROWSER_SEARCH_TOOL             → Groq tool definition object
//   cleanSearchResponse(text)       → string  (strips Groq annotation noise)
//   extractCitations(responseText)  → Citation[]
//   buildSourcesBlock(citations)    → HTMLElement

import { escapeHtml } from "./renderers/loader-utils.js";

// ---------- tool definition ----------
// The browser_search tool is a Groq built-in for openai/gpt-oss-120b.
// It takes no parameters — Groq executes it server-side.

export const BROWSER_SEARCH_TOOL = { type: "browser_search" };

// ---------- cleanSearchResponse ----------
// Groq's browser_search tool injects internal source-annotation markers into
// the streamed text, e.g. 【1†L7-L10】 or 【2†source】. These are meaningless
// to the end user and must be stripped before rendering.
// We also remove the trailing reference-link section ("[1]: https://...") so
// it doesn't show up as raw markdown in the response body.

export function cleanSearchResponse(text) {
  return text
    // Groq annotation brackets: 【N†anything】
    .replace(/\u3010\d+\u2020[^\u3011]*\u3011/g, "")
    // Tidy up any double spaces left by the removals
    .replace(/ {2,}/g, " ")
    // Strip trailing newlines before reference-link sections
    .replace(/\n+\[\d+\]: https?:\/\/[^\n]+(\n\[\d+\]: https?:\/\/[^\n]+)*/g, "")
    .trim();
}

// ---------- needsWebSearch ----------
// Fast heuristic — zero API calls, zero tokens.
// Returns true when a prompt is likely to require current/external information.

const SEARCH_TRIGGERS = [
  // Time-sensitive signals
  /\b(today|tonight|right now|this (week|month|year|morning|evening|afternoon))\b/i,
  /\b(latest|newest|most recent|current|up.?to.?date|as of)\b/i,
  /\b(just (announced|released|launched|dropped|happened))\b/i,
  /\b(breaking|live|real.?time|ongoing)\b/i,

  // Information-need signals
  /\b(news|update|release|version|patch|changelog)\b/i,
  /\b(price|cost|how much|stock|market|crypto|bitcoin|ethereum)\b/i,
  /\b(weather|forecast|temperature|rain|snow|wind)\b/i,
  /\b(who won|who is winning|score|standings|results)\b/i,
  /\b(available|download|install|get the|where (to|can) (i|you|we))\b/i,
  /\b(when (does|did|is|was|will)|what happened|what('s| is) new)\b/i,
  /\b(schedule|event|concert|match|game|election|vote|poll)\b/i,
  /\b(regulations?|law|policy|ruling|decision|verdict)\b/i,
  /\b(review|benchmark|comparison|vs\.?|versus)\b.*\b(2025|2026|new|latest)\b/i,
  /\b(search|find|look up|google|search for)\b/i,
  /\bhttps?:\/\//i,  // explicit URL in the prompt
];

// Prompts that look time-sensitive but are actually stable knowledge.
const STABLE_BYPASSES = [
  /^(what is|explain|how does|define|describe|what are|tell me about)\s+(?!the (latest|current|newest))/i,
  /\b(mathematically|mathemat(ics|ical)|theorem|proof|formula|equation)\b/i,
  /\b(history of|historical|in the \d{4}s?|ancient|medieval|classical)\b/i,
  /\b(syntax|grammar|how to (write|code|use|implement))\b/i,
];

export function needsWebSearch(prompt) {
  const p = prompt.trim();

  // If any bypass matches, skip search.
  for (const re of STABLE_BYPASSES) {
    if (re.test(p)) return false;
  }

  // If any trigger matches, use search.
  for (const re of SEARCH_TRIGGERS) {
    if (re.test(p)) return true;
  }

  return false;
}

// ---------- extractCitations ----------
// Pulls citations from the response text.
// The model typically produces inline [1], [2] references and may append
// a "Sources:" section. We parse both forms and deduplicate by URL.

export function extractCitations(responseText) {
  const citations = [];
  const seen = new Set();

  // Pattern 1: Markdown reference links — [1]: https://... "title"
  // or [^1]: https://... title
  const refLink = /\[[\^]?(\d+)\]:\s+(https?:\/\/[^\s"']+)(?:\s+"([^"]+)")?/g;
  let m;
  while ((m = refLink.exec(responseText)) !== null) {
    const url = normalizeUrl(m[2]);
    if (!seen.has(url)) {
      seen.add(url);
      citations.push({
        id: parseInt(m[1], 10),
        url,
        title: m[3] || domainFromUrl(url),
        domain: domainFromUrl(url),
      });
    }
  }

  // Pattern 2: Numbered list that looks like a Sources section
  // e.g.  1. https://example.com — Page Title
  if (citations.length === 0) {
    const sourceSection = responseText.match(/(?:sources?|references?)[\s\S]{0,20}?\n([\s\S]+)/i);
    if (sourceSection) {
      const listItem = /\d+\.\s+(https?:\/\/[^\s]+)/g;
      while ((m = listItem.exec(sourceSection[1])) !== null) {
        const url = normalizeUrl(m[1]);
        if (!seen.has(url)) {
          seen.add(url);
          citations.push({
            id: citations.length + 1,
            url,
            title: domainFromUrl(url),
            domain: domainFromUrl(url),
          });
        }
      }
    }
  }

  return citations.sort((a, b) => a.id - b.id);
}

function normalizeUrl(raw) {
  try {
    const u = new URL(raw.replace(/[.,;)>]+$/, "")); // strip trailing punctuation
    u.search = ""; // strip tracking params
    u.hash = "";
    return u.toString();
  } catch {
    return raw;
  }
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ---------- buildSourcesBlock ----------
// Returns a DOM element: a collapsible source list to append after the answer.
// Each source, when clicked, opens the URL in the user's default browser via
// Tauri's open_url IPC command.

export function buildSourcesBlock(citations, openUrlFn) {
  if (!citations || citations.length === 0) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "pebble-sources";

  const toggle = document.createElement("button");
  toggle.className = "pebble-sources-toggle";
  toggle.type = "button";
  toggle.innerHTML =
    `<svg class="pebble-sources-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6l4 4 4-4"/></svg>` +
    `<span>Sources (${citations.length})</span>`;
  wrapper.appendChild(toggle);

  const list = document.createElement("div");
  list.className = "pebble-sources-list";
  list.setAttribute("aria-hidden", "true");

  for (const c of citations) {
    const item = document.createElement("div");
    item.className = "pebble-source-item";

    const num = document.createElement("span");
    num.className = "pebble-source-num";
    num.textContent = `[${c.id}]`;

    const link = document.createElement("button");
    link.className = "pebble-source-link";
    link.type = "button";
    link.title = c.url;
    link.innerHTML =
      `<span class="pebble-source-title">${escapeHtml(c.title)}</span>` +
      `<span class="pebble-source-domain">${escapeHtml(c.domain)}</span>`;
    link.addEventListener("click", () => {
      if (openUrlFn) openUrlFn(c.url);
    });

    item.appendChild(num);
    item.appendChild(link);
    list.appendChild(item);
  }

  wrapper.appendChild(list);

  // Toggle expand/collapse
  let open = false;
  toggle.addEventListener("click", () => {
    open = !open;
    toggle.classList.toggle("open", open);
    list.setAttribute("aria-hidden", String(!open));
  });

  return wrapper;
}
