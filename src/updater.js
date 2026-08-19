// updater.js — Pebble automatic update checker and installer.
//
// Uses @tauri-apps/plugin-updater (v2) to check for new GitHub Releases
// and surfaces progress inside the Pebble update bar, never in a popup.
//
// NOTE: check() always returns null in `cargo tauri dev`.
//       The update bar only appears in production builds.
//
// Public API:
//   initUpdater()              → void  (call once at startup)
//   manualCheckForUpdate()     → Promise<void>  (user-triggered, ignores 6-hr cache)
//   installUpdate(onProgress)  → Promise<void>

const CHECK_INTERVAL_MS  = 6 * 60 * 60 * 1000;  // 6 hours
const LAST_CHECK_KEY     = "pebble_last_update_check";

// Lazily-resolved reference to the pending Update object returned by check().
let pendingUpdate = null;

// ─── Lazy-load Tauri plugins ─────────────────────────────────────────────────
// We import dynamically so the module doesn't crash in environments where the
// Tauri bridge isn't present (e.g. a plain browser dev server).

async function getTauriUpdater() {
  try {
    return await import("@tauri-apps/plugin-updater");
  } catch {
    return null;
  }
}

async function getTauriProcess() {
  try {
    return await import("@tauri-apps/plugin-process");
  } catch {
    return null;
  }
}

// ─── Check for updates ───────────────────────────────────────────────────────

async function checkForUpdate() {
  const updater = await getTauriUpdater();
  if (!updater) return;   // running outside Tauri — no-op

  try {
    const update = await updater.check();
    if (update && update.available) {
      pendingUpdate = update;
      // Notify main.js so it can show the update bar.
      document.dispatchEvent(
        new CustomEvent("pebble:update-available", {
          detail: { version: update.version },
        })
      );
    }
  } catch (err) {
    // Network errors, missing manifest, signature failures — all silently
    // ignored. The user can try again on the next check.
    console.warn("[Pebble updater] check failed:", err?.message ?? err);
  }

  // Record the timestamp of this check regardless of outcome.
  localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
}

// ─── Throttled check that respects the 6-hour cache ─────────────────────────

function shouldCheck() {
  const last = Number(localStorage.getItem(LAST_CHECK_KEY) || "0");
  return Date.now() - last >= CHECK_INTERVAL_MS;
}

// ─── Public: initialise (call once from main.js) ─────────────────────────────

export function initUpdater() {
  // Startup check (skip if we checked recently).
  if (shouldCheck()) {
    // Delay by 3 s so startup network activity doesn't pile up.
    setTimeout(() => checkForUpdate(), 3000);
  }

  // Periodic check every 6 hours regardless of shouldCheck — the interval
  // itself starts fresh each launch, but we won't spam if the app was just
  // opened.
  setInterval(() => checkForUpdate(), CHECK_INTERVAL_MS);
}

// ─── Public: manual / on-demand check (ignores 6-hour throttle) ──────────────
// Calls checkForUpdate() directly so it always runs immediately, regardless of
// when the last auto-check happened.  The auto-check interval is NOT restarted
// and LAST_CHECK_KEY is updated by checkForUpdate() as normal.

export async function manualCheckForUpdate() {
  await checkForUpdate();
}

// ─── Public: download and install the pending update ─────────────────────────
//
// onProgress(state) is called with:
//   { phase: "downloading", contentLength, downloaded }
//   { phase: "done" }
//   { phase: "error", message }

export async function installUpdate(onProgress) {
  if (!pendingUpdate) {
    onProgress?.({ phase: "error", message: "No update available." });
    return;
  }

  const process = await getTauriProcess();

  try {
    let contentLength = 0;

    await pendingUpdate.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          contentLength = event.data.contentLength ?? 0;
          onProgress?.({ phase: "downloading", contentLength, downloaded: 0 });
          break;
        case "Progress":
          onProgress?.({
            phase: "downloading",
            contentLength,
            downloaded: event.data.chunkLength,
          });
          break;
        case "Finished":
          onProgress?.({ phase: "done" });
          break;
      }
    });

    // Relaunch to apply the update.
    if (process?.relaunch) {
      await process.relaunch();
    }
  } catch (err) {
    onProgress?.({
      phase: "error",
      message: err?.message ?? "Update failed. Please try again.",
    });
  }
}
