# Minimal Pomodoro

A modern minimalist Pomodoro focus timer and native macOS application (`WKWebView` + menu bar countdown + native HUD notifications + Web Audio API acoustic synthesis), engineered with zero external runtime dependencies and a compact, permanent `localStorage` footprint.

## Download & Install on macOS (Apple Silicon & Intel Universal)

Download the latest release from [**GitHub Releases**](https://github.com/SDesai-BC/pomodoro-minimal/releases/latest):

1. **One-Click Installer Wizard (`Minimal-Pomodoro-1.0.0.pkg` — Recommended)**:
   - Download `Minimal-Pomodoro-1.0.0.pkg` and open it (or right-click → **Open**).
   - Follow the macOS Installer steps to install **Minimal Pomodoro** directly into `/Applications/Minimal Pomodoro.app` and clear any download quarantine attribute automatically.
2. **Drag-and-Drop Disk Image (`Minimal-Pomodoro-1.0.0.dmg`)**:
   - Download `Minimal-Pomodoro-1.0.0.dmg`, double-click to mount it, and drag **Minimal Pomodoro.app** into the **Applications** folder.
   - If macOS Gatekeeper shows an unverified developer prompt on first launch, run:
     ```sh
     xattr -cr "/Applications/Minimal Pomodoro.app"
     ```
     or go to **System Settings → Privacy & Security → Open Anyway**.

## Features

- **Cool Nordic-Azure Minimalist Palette**: Eye-soothing light and dark modes with automatic OS synchronization and manual override.
- **Drift-Free Wall-Clock Timer Engine**: Uses wall-clock target timestamps (`targetEndTimeMs`) rather than `setInterval` step accumulation so background throttling never causes countdown drift.
- **Proportional Pomodoro Break Scaling**: Automatically scales **Short Break** (`1:5` ratio) and **Long Break** (`3:5` ratio) when adjusting Focus duration (e.g., `50m` Focus → `10m` Short Break / `30m` Long Break) and remembers custom durations across phase switches and restarts.
- **Active-Timer Safety & Confirmation**: Protects running or mid-session timers against accidental resets with a confirmation modal (`<dialog>`) before applying duration changes, resets, or mode switches.
- **Multi-Profile Web Audio Synthesizer**: Real-time synthesized completion chimes (`Tibetan Singing Bowl`, `Zen Temple Bell`, `Warm Wooden Marimba`, `Crystal Wind Chime`, `Soft Double-Pulse`) plus a strict `No Sound (Silent)` mode.
- **Compact Permanent Storage (`pomodoro_minimal_v1`)**: Stores settings, timer state, tasks, and never-expiring daily focus history in `< 500 bytes` of JSON, mirrored to macOS `UserDefaults` in the native app.
- **Native macOS App & Menu Bar Integration**: Compiles into `Minimal Pomodoro.app` (Universal Binary: `arm64` + `x86_64`) with a live `NSStatusItem` menu bar countdown and a floating top-right HUD notification banner.

## Branching & Automated Release Workflow (`next` → `main`)

- **`next` (Default Branch)**: All daily development happens by creating feature/fix branches (`feat/*`, `fix/*`) from `next` and opening pull requests targeting `next`. Every PR and push runs the [`CI` workflow](.github/workflows/ci.yml) (syntax check, unit tests, Universal Binary `.dmg`/`.pkg`/`.zip` build, and signature verification).
- **`main` (Production Release Branch)**: To cut a new release, bump `"version"` in `package.json` on `next` (e.g. `npm version minor --no-git-tag-version`) and merge a PR from `next` into `main`. Pushing to `main` triggers the [`Release on Main` workflow](.github/workflows/release.yml), which automatically builds the Universal macOS `.pkg`, `.dmg`, `.zip`, and `SHA256SUMS.txt` artifacts and publishes tag `v<version>` on GitHub Releases.

## Quick Start (Development)

### Run Unit Tests
```sh
npm test
```

### Build & Install Native macOS Application Locally
```sh
npm run build:mac
npm run open:mac
```

### Build Distributable `.dmg`, `.pkg`, and `.zip` Installers
```sh
npm run package:mac
```

### Run in Browser
```sh
npm start
```

## Research & Architecture Documentation

- [Pomodoro Mechanics, Proportional Break Scaling & Storage Architecture](docs/research/pomodoro-mechanics.md)
- [Focus Timer Acoustics, Psychoacoustics & Web Audio Synthesis](docs/research/timer-acoustics.md)
- [macOS Application Packaging, Universal Binaries, Gatekeeper & Distribution](docs/research/macos-packaging.md)
- [CI/CD, `next` → `main` Release Branching & Supply-Chain Best Practices](docs/research/ci-cd-branching-release.md)
