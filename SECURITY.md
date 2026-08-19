# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 1.0.x | ✅ Yes |
| < 1.0.0 | ❌ No (pre-release) |

Security fixes are applied to the current stable release only. Pre-release versions are not supported.

---

## Reporting a Vulnerability

**Do not open a public GitHub issue to report a security vulnerability.**

Use [GitHub's private vulnerability reporting feature](https://github.com/NuclearVenom/Pebble/security/advisories/new) to submit a security advisory confidentially. This keeps the details private until a fix is available and allows coordinated disclosure.

If you are unsure whether an issue qualifies as a security vulnerability, err on the side of caution and report it privately.

---

## What to Include in a Report

A useful report contains as much of the following as possible:

- **Description** — what the vulnerability is and what effect it has
- **Component** — which part of the codebase is affected (e.g., `updater.js`, `main.rs`, a specific renderer)
- **Reproduction steps** — a minimal, clear sequence of steps that demonstrates the issue
- **Environment** — OS, Pebble version, and any other relevant context
- **Impact assessment** — what an attacker could accomplish by exploiting this
- **Proof of concept** — if you have one, a code snippet or recording that demonstrates the issue

---

## Disclosure Expectations

- Pebble will acknowledge your report promptly and keep you informed of progress.
- Please allow reasonable time for a fix to be developed and released before disclosing publicly.
- Coordinated disclosure is strongly preferred — once a patched release is available, we are happy to credit your report in the release notes if you wish.
- Please do not publish exploit details, proof-of-concept code, or reproduction steps publicly until a fix has been released.

---

## Scope

In-scope vulnerabilities include, but are not limited to:

- Arbitrary code execution through Pebble's renderer system (SVG injection, script execution via Mermaid or other renderers)
- Bypass of the `open_url` http/https restriction
- Privilege escalation via the Tauri capabilities system
- Update mechanism abuse (e.g., bypassing the minisign signature check)
- Unintended access to the filesystem or OS environment beyond what is documented
- Leakage of API key material from the application

Out of scope:

- Vulnerabilities in third-party libraries (Tauri, Groq API, KaTeX, Chart.js, etc.) that are not caused or enabled by Pebble's own code — please report those to the respective upstream projects
- Issues that require the attacker to already have local administrator access on the user's machine
- Self-inflicted issues from editing configuration files or the source code directly

---

## Security Considerations (Informational)

The following are known security characteristics of the current release:

- **CSP:** Content Security Policy is currently set to `null` in `tauri.conf.json`. Pebble loads `marked`, `KaTeX`, and other scripts from jsDelivr CDN at runtime. A stricter CSP is on the roadmap for a future release.
- **API keys:** Groq API keys are read from the OS environment at startup and are never written to disk by Pebble. Key values are masked in the dashboard UI. They are transmitted only to `api.groq.com` over HTTPS.
- **`open_url`:** The Tauri command that opens links in the system browser is restricted to `http://` and `https://` schemes only.
- **SVG renderer:** SVG content is sanitised through DOMPurify before DOM insertion. The sanitiser blocks `<script>`, `<foreignObject>`, `<iframe>`, `<embed>`, `<object>`, all `on*` event handler attributes, and `javascript:` hrefs.
- **Mermaid:** Initialised with `securityLevel: "strict"`, which disables raw HTML labels and script execution within diagrams.
- **Plot expressions:** Evaluated by a hand-written recursive-descent parser — not `eval()` or `new Function()` — with no access to JS globals or the DOM.
- **Tauri capabilities:** Permissions are explicitly declared in `capabilities/default.json`; no blanket access is granted.
