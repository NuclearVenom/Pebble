# Contributing to Pebble

Thank you for your interest in contributing to Pebble. This document explains how to set up a development environment, what the project expects from contributions, and how the review process works.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Prerequisites](#prerequisites)
- [Getting the Code](#getting-the-code)
- [Project Structure](#project-structure)
- [Running in Development](#running-in-development)
- [Building a Release](#building-a-release)
- [How to Contribute](#how-to-contribute)
- [Commit Expectations](#commit-expectations)
- [Pull Request Expectations](#pull-request-expectations)
- [Adding a Renderer](#adding-a-renderer)
- [Code Quality](#code-quality)
- [Documentation](#documentation)
- [Security](#security)

---

## Code of Conduct

By participating in this project you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Rust + Cargo | 1.77+ (stable) | Tauri backend |
| Tauri CLI v2 | `^2.0` | Build and dev commands |
| A Groq API key | — | Running the application |

**Install Rust:** https://rustup.rs

**Install the Tauri CLI:**

```bash
cargo install tauri-cli --version "^2.0"
```

**Linux only:** You will need additional system packages for Tauri's WebKit/GTK dependencies. See [Tauri's prerequisites page](https://tauri.app/start/prerequisites/) for the exact list for your distribution.

There is **no Node.js or npm requirement**. The frontend is plain HTML/CSS/JS with no build step.

---

## Getting the Code

Fork the repository on GitHub, then clone your fork:

```bash
git clone https://github.com/<your-username>/Pebble.git
cd Pebble
```

Add the upstream remote so you can pull changes:

```bash
git remote add upstream https://github.com/NuclearVenom/Pebble.git
```

---

## Project Structure

```
pebble/
├── src/                        Frontend (HTML/CSS/JS — no bundler)
│   ├── index.html              Window markup
│   ├── style.css               All styles
│   ├── main.js                 Core logic — streaming, markdown/LaTeX, geometry, Groq
│   ├── web-search.js           Web search heuristics and citation rendering
│   ├── chat-store.js           Persistent chat history (localStorage)
│   ├── updater.js              Auto-update logic (Tauri plugin-updater)
│   ├── clipboard.js            Shared copy-button widget
│   ├── logo.png                Pre-rasterised capsule logo
│   ├── pebble-logo.svg         Vector logo source
│   └── renderers/
│       ├── blocktypes.js       Central type catalog — single source of truth
│       ├── registry.js         Lazy module loading + render cache
│       ├── catalog.js          Wires each block type to its renderer module
│       ├── shell.js            Shared block UI + viewport gating
│       ├── loader-utils.js     loadScript / loadStylesheet / escapeHtml
│       └── <name>/             One directory per renderer (index.js + any helpers)
├── src-tauri/
│   ├── src/main.rs             Rust backend — global shortcut, Tauri commands
│   ├── tauri.conf.json         Tauri configuration
│   ├── Cargo.toml              Rust package manifest
│   └── capabilities/
│       └── default.json        Tauri permission declarations
├── docs/
│   └── RENDERERS.md            Renderer documentation
├── LICENSE
├── CONTRIBUTING.md             (this file)
├── SECURITY.md
├── CODE_OF_CONDUCT.md
└── CITATION.cff
```

---

## Running in Development

Set your Groq API key (required for Pebble to make any AI requests):

```bash
# Linux / macOS
export GROQ_API_KEY=gsk_...

# Windows (PowerShell)
$env:GROQ_API_KEY = "gsk_..."
```

Then start the development build from the project root:

```bash
cargo tauri dev
```

This compiles the Rust backend, starts the Tauri runtime, and opens the Pebble window. The frontend is served directly from `src/` with no build step — changes to `src/*.js`, `src/style.css`, or `src/index.html` are reflected immediately on the next interaction (no hot-reload; just close and reopen the widget with `Alt+Space`).

> **Note:** The auto-updater always returns `null` in `cargo tauri dev`. The update bar only appears in production builds.

---

## Building a Release

```bash
cargo tauri build
```

Produces platform-native installers in `src-tauri/target/release/bundle/`. This is the same command the release pipeline uses.

---

## How to Contribute

1. **Open an issue first** for anything non-trivial (new feature, significant change, deferred renderer implementation). This lets us discuss the approach before you invest time writing code.

2. **Create a branch** from `main`:

   ```bash
   git checkout -b your-branch-name
   ```

3. **Make your changes** (see sections below for code quality, documentation, and renderer-specific guidance).

4. **Test your changes** manually by running `cargo tauri dev` and exercising the changed functionality.

5. **Open a pull request** against `main` on the upstream repository. Fill in the PR description clearly.

---

## Commit Expectations

- Write clear, descriptive commit messages.
- Prefer small, focused commits over large "everything at once" commits.
- If your commit fixes a specific issue, reference it: `Fixes #123` or `Closes #123`.
- Do not include generated files (`src-tauri/target/`, `src-tauri/gen/`) — these are already in `.gitignore`.

---

## Pull Request Expectations

- **One concern per PR.** Don't bundle unrelated fixes or features.
- **Describe what changed and why.** Include reproduction steps for bug fixes, or usage examples for new features.
- **Keep PRs focused on documented functionality.** Avoid adding functionality that isn't reflected in documentation.
- **Be responsive to review feedback.** PRs that go stale without response may be closed.

---

## Adding a Renderer

Pebble's renderer system is designed to be extended. Adding a new block type requires three small changes — nothing else needs to enumerate types by hand.

Full details, the rendering pipeline, security considerations, and the `ContentRenderer` interface are in [`docs/RENDERERS.md`](docs/RENDERERS.md). Here is the minimal summary:

### Step 1 — Add an entry to `blocktypes.js`

```js
// src/renderers/blocktypes.js
{ type: "mytype", aliases: ["alt"], label: "My Thing", status: "full", heavy: false,
  note: "What this renders and which library it uses." },
```

Set `status` to:
- `"full"` — working rendering
- `"partial"` — working with documented limitations
- `"placeholder"` — shows the source with an explanation (use for things that need a heavy runtime)

Set `heavy: true` if the renderer's library is large — this enables viewport gating via `IntersectionObserver` so the library only loads when the block is near the screen.

### Step 2 — Create the renderer module

```js
// src/renderers/mytype/index.js

export default {
  type: "mytype",

  async render(source, options) {
    // Load any library you need here — lazily, only on first call.
    // Return either:
    //   { kind: "node", node: domElement }
    //   { kind: "html", html: trustedHtmlString }
    // Throw on failure — the shell turns that into the standard error card.
  },
};
```

### Step 3 — Register it in `catalog.js`

```js
// src/renderers/catalog.js
registerLazy("mytype", () => import("./mytype/index.js"));
```

That's all. The parser, the shell, the render cache, and (once `PRIORITY_TYPES` in `main.js` is updated) the model's system prompt all pick it up automatically.

### Security checklist for new renderers

- Never use `innerHTML` or `insertAdjacentHTML` with untrusted content directly. Use `escapeHtml()` from `loader-utils.js` or build DOM nodes with `createElement`/`textContent`.
- Never use `eval()` or `new Function()` to execute content from the AI response.
- If your renderer loads HTML, run it through DOMPurify with an explicit config — do not rely on default settings alone.
- If your renderer makes network requests, document them clearly so users know what leaves the machine.

---

## Code Quality

- The frontend has no linter or formatter configured. Match the style of the file you are editing.
- The JavaScript uses ES module syntax (`import`/`export`). Do not use CommonJS (`require`).
- Avoid adding new external dependencies to the Rust side without discussion — keep the backend thin.
- For frontend libraries, prefer loading from jsDelivr CDN at the version already in use by similar renderers, or document a clear reason for a different source.
- Do not use `eval()`, `new Function()`, or `innerHTML` with AI-generated content.
- Prefer `createElement`/`textContent` over string-concatenated HTML.

---

## Documentation

- If your change adds, removes, or modifies a renderer, update `docs/RENDERERS.md`.
- If your change affects the build process, development workflow, or project structure, update `CONTRIBUTING.md`.
- If your change affects user-facing behaviour, update the relevant section of `README.md`.
- Keep documentation accurate — document what the code *actually does*, not what you intend it to do eventually.

---

## Security

- Do not commit API keys, tokens, or secrets of any kind.
- If you discover a security vulnerability while contributing, do not open a public issue. Follow the process in [SECURITY.md](SECURITY.md).
- When adding renderers, pay particular attention to the renderer security checklist above.
