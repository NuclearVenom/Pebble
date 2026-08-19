// chat-store.js — Pebble persistent chat storage.
//
// Reads/writes to localStorage so saves survive app restarts without
// any new Rust commands or filesystem permissions.
//
// Public API:
//   getAutoSave()            → bool
//   setAutoSave(bool)        → void
//   loadSavedChats()         → SavedChat[]   (newest first)
//   saveChat(messages)       → SavedChat
//   deleteChat(id)           → void
//
// SavedChat shape:
//   { id, title, savedAt, messages: [{role,content},...] }

const CHATS_KEY    = "pebble_chats";
const AUTOSAVE_KEY = "pebble_auto_save";
const MAX_CHATS    = 50;

// ---------- settings ----------

export function getAutoSave() {
  return localStorage.getItem(AUTOSAVE_KEY) === "true";
}

export function setAutoSave(enabled) {
  localStorage.setItem(AUTOSAVE_KEY, enabled ? "true" : "false");
}

// ---------- chat list ----------

export function loadSavedChats() {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function persistChats(chats) {
  localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
}

// ---------- save a chat ----------

export function saveChat(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;

  // Title = first user message, trimmed to 80 chars.
  const firstUser = messages.find(m => m.role === "user");
  const rawTitle  = firstUser ? firstUser.content : "Untitled chat";
  const title     = rawTitle.length > 80 ? rawTitle.slice(0, 77) + "…" : rawTitle;

  const id      = String(Date.now());
  const savedAt = Date.now();

  const chat = { id, title, savedAt, messages };

  let chats = loadSavedChats();

  // Replace an existing chat with the same first-message fingerprint so
  // re-saving a continued chat just updates it rather than creating a duplicate.
  const fingerprint = (messages[0]?.content || "").slice(0, 40);
  const dupIdx = chats.findIndex(c =>
    c.messages?.[0]?.content?.slice(0, 40) === fingerprint
  );
  if (dupIdx !== -1) {
    chats[dupIdx] = chat; // update in place
  } else {
    chats.unshift(chat); // newest first
    if (chats.length > MAX_CHATS) {
      chats = chats.slice(0, MAX_CHATS);
    }
  }

  persistChats(chats);
  return chat;
}

// ---------- delete a chat ----------

export function deleteChat(id) {
  const chats = loadSavedChats().filter(c => c.id !== id);
  persistChats(chats);
}

// ---------- helpers ----------

// Returns a human-readable relative time string (e.g. "2 hours ago").
export function relativeTime(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60)        return "just now";
  const m = Math.floor(s / 60);
  if (m < 60)        return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)        return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)         return `${d}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
