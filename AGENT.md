# AGENT.md — Engineering & AI Agent Guidelines

This document is the authoritative operating manual for AI coding agents and human contributors working on **Minimal Pomodoro** (`AGENTS.md` symlinks here as a single source of truth). Keep this file concise, command-first, and free of fluff—every line consumes context on every turn.

---

## 1. Tech Stack & Deep-Module Architecture

Zero external runtime dependencies. Plain ES Modules (`type: "module"`), modern CSS (`@layer`, `light-dark()` / `color-scheme`, native `<dialog>`), and a native macOS Swift wrapper (`WKWebView` + `NSStatusItem` + `NSPanel` HUD + `UserNotifications`).

| Path | Deep-Module Responsibility & Hidden Internals |
| :--- | :--- |
| `src/timer-engine.js` | **Pure Functional Timer Engine.** Drift-free wall-clock countdown math (`targetEndTimeMs`), phase state machine (`focus` / `shortBreak` / `longBreak`), and canonical `1:5` / `3:5` proportional break scaling. Zero DOM, storage, or audio I/O. |
| `src/storage.js` | **Compact Permanent Persistence (`pomodoro_minimal_v1`).** Encapsulates single-key compact JSON schema (`v`, `s`, `m`, `q`, `h`), input validation, never-expiring daily history, streak calculation, and macOS `UserDefaults` mirroring. Callers never touch raw `localStorage` keys or compact tuple indices. |
| `src/sound.js` | **Web Audio API Acoustic Synthesizer.** Encapsulates oscillator/gain envelopes for 5 psychoacoustic profiles + strict `none` (silent) mode, guaranteeing node disconnection in `try/finally`. |
| `src/notifications.js` | **Notification & Menu-Bar Bridge.** Abstracts `window.webkit.messageHandlers.pomodoroNative` (macOS app) vs. Web `Notification` API fallback behind a uniform interface. |
| `src/app.js` | **UI & Accessibility Orchestrator.** Wires DOM events, keyboard shortcuts, active-timer confirmation modal (`#confirm-timer-dialog`), `aria-live` announcements, and render synchronization. |
| `macos/PomodoroApp.swift` | **Native macOS Shell.** Custom `pomodoro://` bundle scheme, native window drag handling, menu-bar `NSStatusItem` live timer, `UserDefaults` backup/restore, and top-right HUD banner. |
| `scripts/build-macos-app.sh` | Builds Universal Binary (`arm64` + `x86_64` via `swiftc` + `lipo`) and ad-hoc signs `Minimal Pomodoro.app`, reading `VERSION` from `package.json`. |
| `scripts/package-macos-release.sh` | Produces distributable `.pkg` (`BundleIsRelocatable = false`), `.dmg` (`UDZO`), `.zip` (`ditto`), and `SHA256SUMS.txt` in `dist/release/`. |

---

## 2. Essential Commands & Mandatory Verification Gates

Run these checks locally and confirm exit code `0` **before** every commit or PR:

```sh
# 1. Syntax check all ES modules
node --check src/app.js && node --check src/storage.js && node --check src/timer-engine.js && node --check src/sound.js && node --check src/notifications.js

# 2. Run unit test suite (Node built-in test runner)
npm test

# 3. Build Universal macOS app + distributable installers (.pkg, .dmg, .zip, SHA256SUMS.txt)
npm run package:mac

# 4. Verify Universal Binary slices (arm64 + x86_64), code signature & checksums
lipo -archs "dist/Minimal Pomodoro.app/Contents/MacOS/MinimalPomodoro"
codesign --verify --deep --strict "dist/Minimal Pomodoro.app"
(cd dist/release && shasum -a 256 -c SHA256SUMS.txt)
```

---

## 3. Git Branching, PR Merge & Security Rules (Non-Negotiable)

`next` is the **default integration branch**. `main` is the **production release branch**. Both branches are protected on GitHub by an active Repository Ruleset (blocking direct pushes, force-pushes, branch deletion, and merges without passing CI).

1. **NEVER work on or push directly to `next` or `main`.**
   Before making any file edit, create a scoped topic branch off an up-to-date `next`:
   ```sh
   git checkout next
   git pull origin next
   git checkout -b <feat|fix|refactor|docs|chore>/<short-kebab-slug>
   ```
2. **Merge into `next` exclusively via Pull Request for security & CI verification:**
   - Push your topic branch (`git push -u origin HEAD`) and open a PR targeting `next`:
     ```sh
     gh pr create --base next --title "<type>: <concise summary>" --body "<why, verification evidence, blast radius>"
     ```
   - Wait for the required GitHub Actions check **`Test & Build Universal macOS App`** (`.github/workflows/ci.yml`) to pass before merging (`gh pr merge --squash --delete-branch`).
3. **Release Promotion (`next` → `main`):**
   - Never commit directly to `main`.
   - Bump `"version"` in `package.json` via a PR into `next`, then open and merge a release PR from `next` into `main` (`gh pr create --base main --head next`). Merging to `main` triggers `.github/workflows/release.yml` to publish `v<version>` `.pkg`, `.dmg`, `.zip`, and `SHA256SUMS.txt` on GitHub Releases.
4. **Secret, Privacy & CI Security Hygiene:**
   - Never commit `.env*`, tokens, signing keys (`*.pem`, `*.key`, `*.p12`), `dist/` binaries, personal names/emails, or local macOS home-directory paths.
   - Run a staged-diff scan before every commit:
     ```sh
     git diff --cached | grep -niE "([/]Users/|gho[_]|ghp[_]|api[_]key|secret[s]?=|pass[w]ord|private[_]key)" && exit 1 || true
     ```
   - In `.github/workflows/*.yml`, enforce least-privilege `permissions:` (`contents: read` on CI) and pass dynamic values via `env:` variables—never interpolate `${{ ... }}` directly inside `run:` shell scripts.

---

## 4. Software Design Principles (*A Philosophy of Software Design* — Ousterhout)

AI makes emitting code cheap; **comprehension, interface simplicity, and the captured "why"** are the scarce resources. Apply design rigor to every change, even a one-line fix.

1. **Deep Modules over Shallow Proliferation:**
   - Prefer modules and functions with **small, simple interfaces** that hide substantial work inside.
   - Decompose by *genuine sub-abstraction*, never by arbitrary line count. Reject shallow pass-through wrappers and tiny conjoined helpers ("classitis") that force readers to jump across files to understand one operation.
2. **Strict Information Hiding:**
   - Never leak internal representations across seams (e.g., compact storage array slots stay inside `src/storage.js`; WebKit bridge handlers stay inside `src/notifications.js` and `src/storage.js`).
   - If one design decision appears in two places, consolidate it into a single source of truth (*The Pragmatic Programmer* — DRY of knowledge) or document why the duplication is intentional.
3. **Define Errors Out of Existence & Never Swallow Real Failures:**
   - Where domain-safe, design APIs so edge cases are handled naturally without special-case caller branches (e.g., clamping task estimates to `>= 1`, no-op when blurring an unedited duration input while a timer is running).
   - Validate external/caller inputs up front with descriptive guard clauses (`TypeError` / `RangeError`).
   - **Never swallow errors:** Every `catch` must log, surface to the UI (`onStorageError`), or re-throw with operation context. No empty `catch {}` or silent fallback to `null` / `[]`.
4. **Command–Query Separation:**
   - Functions named `get*`, `find*`, `calculate*`, or `is*` must be **pure reads**—zero mutation, zero storage writes, zero DOM/audio side effects.
   - Mutations and I/O belong exclusively in action-verb commands (`create*`, `update*`, `set*`, `save*`, `play*`, `send*`).
5. **Strategic over Tactical Programming ("Design It Twice"):**
   - For load-bearing architectural or UX choices, outline at least two distinct designs and compare their interface depth and edge cases before coding.
   - **The 30-Second Pre-Commit Pause:** Ask: *(a) Did the module I touched become deeper or shallower? (b) Did I leak internals, duplicate a decision, or walk past a stale comment? (c) Can any special-case `if` I added be designed out of existence?*
6. **Comments Capture the Non-Obvious *Why*:**
   - Do not write comments that repeat *what* the code does. Document invariants, mathematical ratios (`1:5` / `3:5` Cirillo scaling), psychoacoustic/WebKit quirks, and protocol contracts. Update or delete stale comments immediately when touching surrounding code.

---

## 5. Pragmatic & Agentic Engineering Rigor

Synthesized from *The Pragmatic Engineer* (Orosz), *The Pragmatic Programmer* (Hunt & Thomas), *Tidy First?* (Beck), and *Agentic Engineering Patterns* (Willison):

1. **Red/Green TDD for Features & Bug Fixes:**
   - Write an automated test in `tests/pomodoro.test.js` **first** and run `npm test` to watch it fail (**Red**)—proving the test exercises the bug or missing behavior—before writing the implementation to make it pass (**Green**).
2. **Tidy First — Separate Structure from Behavior:**
   - If legacy or tangled code resists a clean change, refactor it first in its own structural commit (zero behavior change), then implement the behavior change in a separate commit. Keep PRs small, cohesive, and independently revertible.
3. **Evidence Before Assertions (Measure, Don't Guess):**
   - Know where every technical fact comes from and verify primary sources (W3C specs, Apple Developer Docs, man pages) before deciding. Test the riskiest unknown first in isolation.
   - Never claim a bug is fixed or a build works without running the exact verification commands in §2 and inspecting their output.
4. **Operational & User-State Safety:**
   - **Data durability:** Never expire or silently drop user focus history or tasks in `pomodoro_minimal_v1`; maintain backward compatibility when evolving storage fields.
   - **Active-session safety:** Never allow focus/blur, duration edits, resets, or mode switches to silently discard an in-progress countdown (`isTimerInProgress`); require explicit user confirmation via `#confirm-timer-dialog`.
   - **Bounded loops & resource cleanup:** Cap every scan or collection (`MAX_TASKS`, `MAX_STREAK_SCAN_DAYS`) with explicit limit handling, and wrap every audio node, file handle, or OS resource in `try/finally`.
5. **Fresh-Eyes Adversarial Review Before Human Review:**
   - Before opening or finalizing a PR, review the complete `git diff origin/next...HEAD` (ideally via an independent read-only review agent) against every rule in this file.
