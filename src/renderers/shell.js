// The shared visual/behavioral shell every rich content block uses,
// regardless of which renderer produced it. Keeps 18 different renderers
// from turning into 18 different-looking cards. Handles:
//
//  - a small header with a type badge and action buttons (copy source,
//    a preview/source view toggle, retry-on-error)
//  - loading / error / ready states
//  - viewport-gated rendering for renderers flagged `heavy` in
//    blocktypes.js (via IntersectionObserver — the renderer's module and
//    its underlying library aren't touched until the block is about to be
//    visible)
//  - the render cache (registry.js) so an unchanged block isn't
//    re-rendered
//
// main.js calls mountBlock() once per completed semantic block; everything
// else happens here.
//
// A block always renders at full size (no clamped/expandable height) —
// the response panel's own scroll handles anything tall. The one view
// toggle a block has is preview vs. source: the "preview" side is a
// persistent, detached-when-not-shown DOM node (`previewBody`), so
// flipping to source and back never re-runs the renderer or loses state
// (e.g. a map's pan position, a canvas's drawn content) — it's just
// re-attached.

import { getBlockTypeInfo } from "./blocktypes.js";
import { getRenderer, cacheKeyFor, getCached, setCached } from "./registry.js";
import { makeCopyButton } from "../clipboard.js";
import { escapeHtml } from "./loader-utils.js";

const CODE_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">' +
  '<path d="M5.5 4L1.5 8l4 4M10.5 4l4 4-4 4"/></svg>';
const PREVIEW_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">' +
  '<path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z"/>' +
  '<circle cx="8" cy="8" r="1.8" fill="currentColor" stroke="none"/></svg>';
const RETRY_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">' +
  '<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3.2h-3.2"/></svg>';

function notifyResize(el) {
  el.dispatchEvent(new CustomEvent("pebble:block-resize", { bubbles: true }));
}

function buildShell(type) {
  const info = getBlockTypeInfo(type);
  const label = info?.label || type;

  const shell = document.createElement("div");
  shell.className = "rich-block";
  shell.dataset.type = type;

  const header = document.createElement("div");
  header.className = "rich-block-header";

  const badge = document.createElement("span");
  badge.className = "rich-block-badge";
  badge.textContent = label;
  header.appendChild(badge);

  const spacer = document.createElement("span");
  spacer.className = "rich-block-spacer";
  header.appendChild(spacer);

  const actions = document.createElement("div");
  actions.className = "rich-block-actions";
  header.appendChild(actions);

  const body = document.createElement("div");
  body.className = "rich-block-body";

  shell.appendChild(header);
  shell.appendChild(body);

  return { shell, actions, body, label };
}

function showLoadingState(target, text) {
  target.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "rich-block-status";
  wrap.innerHTML = `<span class="rich-block-spinner"></span><span>${escapeHtml(text)}</span>`;
  target.appendChild(wrap);
}

function showErrorState(target, actions, { message, source, onRetry }) {
  target.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "rich-block-error";
  wrap.innerHTML =
    `<div class="rich-block-error-message">${escapeHtml(message)}</div>` +
    `<pre class="rich-block-error-source">${escapeHtml(source)}</pre>`;
  target.appendChild(wrap);

  if (onRetry) {
    // Replace any previous retry button rather than stacking a new one on
    // top for every failed attempt.
    actions.querySelector(".rich-block-retry")?.remove();
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "rich-block-action rich-block-retry";
    retryBtn.title = "Retry";
    retryBtn.innerHTML = RETRY_ICON;
    retryBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onRetry();
    });
    actions.appendChild(retryBtn);
  }
}

function applyRendered(target, rendered) {
  target.innerHTML = "";
  if (rendered.kind === "node") {
    target.appendChild(rendered.node);
  } else if (rendered.kind === "html") {
    target.innerHTML = rendered.html;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Everything this touches — previewBody, actions, shell — belongs to one
// specific block; nothing here reaches outputEl or fullText, so a retry
// can never affect anything outside its own block.
async function runRender(type, source, options, previewBody, actions, shell, paint, isRetry = false) {
  const info = getBlockTypeInfo(type);
  const key = cacheKeyFor(type, source, options);
  const cached = getCached(key);
  if (cached) {
    applyRendered(previewBody, cached);
    paint();
    notifyResize(shell);
    return;
  }

  showLoadingState(previewBody, "Loading renderer…");
  paint();
  notifyResize(shell);
  // Most render failures (a malformed spec, invalid syntax) are
  // deterministic — retrying re-fails in well under a frame, which reads
  // as the button doing nothing at all. A short minimum delay makes the
  // retry always visibly *do* something, whether it ends up succeeding or
  // not.
  if (isRetry) await wait(350);

  try {
    const renderer = await getRenderer(type);
    if (!renderer) throw new Error(`No renderer registered for "${type}".`);
    showLoadingState(previewBody, "Rendering…");
    paint();
    const rendered = await renderer.render(source, options);
    setCached(key, rendered);
    applyRendered(previewBody, rendered);
  } catch (err) {
    showErrorState(previewBody, actions, {
      message: err?.message || "This block failed to render.",
      source,
      onRetry: () => runRender(type, source, options, previewBody, actions, shell, paint, true),
    });
  } finally {
    paint();
    notifyResize(shell);
  }
}

/**
 * Builds and mounts a Rich Content Block for a completed semantic fenced
 * block. Returns the shell element to insert into the DOM.
 */
export function mountBlock(type, source, options = {}) {
  const info = getBlockTypeInfo(type);
  const { shell, actions, body } = buildShell(type);

  // Copy source is universal — every renderer's raw input is inspectable
  // and copyable, even placeholders and errors.
  actions.appendChild(makeCopyButton(() => source, "Copy source"));

  if (info?.status === "placeholder") {
    const wrap = document.createElement("div");
    wrap.className = "rich-block-placeholder";
    wrap.innerHTML =
      `<div class="rich-block-placeholder-message">${escapeHtml(info.note || "Not yet implemented.")}</div>` +
      `<pre class="rich-block-error-source">${escapeHtml(source)}</pre>`;
    body.appendChild(wrap);
    return shell;
  }

  let view = "preview"; // "preview" | "code"
  const previewBody = document.createElement("div");
  previewBody.className = "rich-block-preview";
  const codeBody = document.createElement("pre");
  codeBody.className = "rich-block-source";
  codeBody.textContent = source;

  function paint() {
    body.innerHTML = "";
    body.appendChild(view === "code" ? codeBody : previewBody);
  }

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "rich-block-action";
  toggleBtn.title = "View source";
  toggleBtn.innerHTML = CODE_ICON;
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    view = view === "preview" ? "code" : "preview";
    toggleBtn.innerHTML = view === "preview" ? CODE_ICON : PREVIEW_ICON;
    toggleBtn.title = view === "preview" ? "View source" : "View preview";
    paint();
    notifyResize(shell);
  });
  actions.appendChild(toggleBtn);

  paint();

  const start = () => runRender(type, source, options, previewBody, actions, shell, paint);

  if (info?.heavy && "IntersectionObserver" in window) {
    showLoadingState(previewBody, "Waiting to load…");
    paint();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            observer.disconnect();
            start();
          }
        }
      },
      { root: null, rootMargin: "200px" }
    );
    observer.observe(shell);
  } else {
    showLoadingState(previewBody, "Loading renderer…");
    paint();
    start();
  }

  return shell;
}
