# Minimal Pomodoro

A modern minimalist Pomodoro focus timer and native macOS application (`WKWebView` + menu bar countdown + native HUD notifications + Web Audio API acoustic synthesis), engineered with zero external runtime dependencies and a compact, permanent `localStorage` footprint.

## Features

- **Cool Nordic-Azure Minimalist Palette**: Eye-soothing light and dark modes with automatic OS synchronization and manual override.
- **Drift-Free Wall-Clock Timer Engine**: Uses wall-clock target timestamps (`targetEndTimeMs`) rather than `setInterval` step accumulation so background throttling never causes countdown drift.
- **Proportional Pomodoro Break Scaling**: Automatically scales **Short Break** (`1:5` ratio) and **Long Break** (`3:5` ratio) when adjusting Focus duration (e.g., `50m` Focus → `10m` Short Break / `30m` Long Break) and remembers custom durations across phase switches and restarts.
- **Active-Timer Safety & Confirmation**: Protects running or mid-session timers against accidental resets with a confirmation modal (`<dialog>`) before applying duration changes, resets, or mode switches.
- **Multi-Profile Web Audio Synthesizer**: Real-time synthesized completion chimes (`Tibetan Singing Bowl`, `Zen Temple Bell`, `Warm Wooden Marimba`, `Crystal Wind Chime`, `Soft Double-Pulse`) plus a strict `No Sound (Silent)` mode.
- **Compact Permanent Storage (`pomodoro_minimal_v1`)**: Stores settings, timer state, tasks, and never-expiring daily focus history in `< 500 bytes` of JSON, mirrored to macOS `UserDefaults` in the native app.
- **Native macOS App & Menu Bar Integration**: Compiles into `Minimal Pomodoro.app` with a live `NSStatusItem` menu bar countdown and a floating top-right HUD notification banner.

## Quick Start

### Run Unit Tests
```sh
npm test
```

### Build & Install Native macOS Application
```sh
npm run build:mac
npm run open:mac
```

### Run in Browser
```sh
npm start
```

## Research & Architecture Documentation

- [Pomodoro Mechanics, Proportional Break Scaling & Storage Architecture](docs/research/pomodoro-mechanics.md)
- [Focus Timer Acoustics, Psychoacoustics & Web Audio Synthesis](docs/research/timer-acoustics.md)
