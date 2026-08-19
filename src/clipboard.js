// Shared clipboard helpers used by both the core markdown block renderer
// and every rich-content renderer's "copy source" button.

export const COPY_ICONS_HTML =
  '<svg class="icon-copy" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">' +
  '<rect x="5.5" y="5.5" width="8" height="9" rx="1.5"/>' +
  '<path d="M3.5 10.5V3a1.5 1.5 0 0 1 1.5-1.5h6.5"/></svg>' +
  '<svg class="icon-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">' +
  '<path d="M3 8.5l3 3 7-7"/></svg>';

export async function copyToClipboard(text, btn) {
  let ok = true;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      throw new Error("clipboard API unavailable");
    }
  } catch (e) {
    // Fallback for environments where the async Clipboard API is blocked.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e2) {
      ok = false;
    }
  }
  if (ok && btn) {
    btn.classList.add("copied");
    clearTimeout(btn._copyTimeout);
    btn._copyTimeout = setTimeout(() => btn.classList.remove("copied"), 1200);
  }
  return ok;
}

/** A small icon-only copy button. `getText` is called lazily on click. */
export function makeCopyButton(getText, title = "Copy") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "copy-btn";
  btn.title = title;
  btn.innerHTML = COPY_ICONS_HTML;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    copyToClipboard(getText(), btn);
  });
  return btn;
}
