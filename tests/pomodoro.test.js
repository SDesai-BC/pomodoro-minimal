import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPomodoroStore,
  STORAGE_KEY,
  MAX_TASKS,
  DEFAULT_SETTINGS,
} from '../src/storage.js';
import {
  PHASES,
  calculateRemainingMs,
  calculateProgressRatio,
  calculateProportionalBreaks,
  createInitialTimerState,
  startTimer,
  pauseTimer,
  resetTimer,
  switchPhase,
  advanceToNextPhase,
  adjustRemainingTime,
  formatCountdown,
} from '../src/timer-engine.js';
import {
  sendPhaseNotification,
  syncMacMenuBarTimer,
} from '../src/notifications.js';
import {
  SOUND_PROFILES,
  getProfileNotes,
  playPhaseChime,
} from '../src/sound.js';

function createMemoryStorage(initial = {}, { throwOnSet = false } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (throwOnSet) {
        const err = new Error('QuotaExceededError: Storage limit reached');
        err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    dump() {
      return Object.fromEntries(map.entries());
    },
  };
}

describe('PomodoroStore (compact localStorage deep module)', () => {
  it('initializes with default state when storage is empty', () => {
    const storage = createMemoryStorage();
    const store = createPomodoroStore({ storage });
    const state = store.getState();

    assert.deepEqual(state.settings, DEFAULT_SETTINGS);
    assert.deepEqual(state.tasks, []);
    assert.equal(state.activeTaskId, null);
    assert.equal(state.timer.phase, PHASES.FOCUS);
    assert.equal(state.timer.isRunning, false);
    assert.equal(state.timer.remainingMs, DEFAULT_SETTINGS.focusMinutes * 60 * 1000);
  });

  it('validates settings inputs up front and rejects out-of-range values', () => {
    const storage = createMemoryStorage();
    const store = createPomodoroStore({ storage });

    assert.throws(
      () => store.updateSettings({ focusMinutes: 0 }),
      /focusMinutes must be an integer between 1 and 180/
    );
    assert.throws(
      () => store.updateSettings({ shortBreakMinutes: 999 }),
      /shortBreakMinutes must be an integer between 1 and 60/
    );
    assert.throws(
      () => store.updateSettings({ longBreakInterval: 0 }),
      /longBreakInterval must be an integer between 1 and 12/
    );
  });

  it('creates, updates, selects, and completes tasks while persisting compact JSON', () => {
    const storage = createMemoryStorage();
    const store = createPomodoroStore({ storage });

    const task1 = store.createTask({ title: '  Design deep storage module  ', estimatedPomodoros: 3 });
    assert.equal(task1.title, 'Design deep storage module');
    assert.equal(task1.estimatedPomodoros, 3);
    assert.equal(task1.completedPomodoros, 0);
    assert.equal(task1.completed, false);
    // First created task automatically becomes active if none is active
    assert.equal(store.getState().activeTaskId, task1.id);

    const task2 = store.createTask({ title: 'Write unit tests', estimatedPomodoros: 2 });
    store.setActiveTask(task2.id);
    assert.equal(store.getActiveTask().id, task2.id);

    // Record a completed focus session and verify it increments the active task's pomodoros
    store.recordCompletedSession({
      phase: PHASES.FOCUS,
      durationMinutes: 25,
      dateKey: '2026-11-10',
    });

    const updatedTask2 = store.getActiveTask();
    assert.equal(updatedTask2.completedPomodoros, 1);

    const todayStats = store.getDailyStats('2026-11-10');
    assert.deepEqual(todayStats, { sessions: 1, minutes: 25 });

    // Verify storage footprint is tiny (< 600 bytes)
    const bytes = store.getStorageUsageBytes();
    assert.ok(bytes > 50 && bytes < 600, `Expected compact storage < 600B, got ${bytes}B`);
  });

  it('retains all daily history permanently (never expires)', () => {
    const storage = createMemoryStorage();
    const store = createPomodoroStore({ storage });

    for (let i = 1; i <= 45; i++) {
      const day = String(((i - 1) % 28) + 1).padStart(2, '0');
      const month = i <= 28 ? '10' : '11';
      const dateKey = `2026-${month}-${day}`;
      store.recordCompletedSession({
        phase: PHASES.FOCUS,
        durationMinutes: 25,
        dateKey,
      });
    }

    const historyKeys = Object.keys(store.getState().history);
    assert.equal(historyKeys.length, 45, 'All 45 days of history must be retained without expiration');
  });

  it('scales short and long breaks proportionally (50m -> 10m / 30m) and remembers 50m across phase switches', () => {
    const storage = createMemoryStorage();
    const store = createPomodoroStore({ storage });

    // User sets focus duration to 50 minutes
    const afterSet50 = store.setFocusDuration(50);
    assert.equal(afterSet50.settings.focusMinutes, 50);
    assert.equal(afterSet50.settings.shortBreakMinutes, 10);
    assert.equal(afterSet50.settings.longBreakMinutes, 30);
    assert.equal(afterSet50.timer.remainingMs, 50 * 60 * 1000);

    // User switches to Short Break -> must be 10 minutes
    const shortTimer = switchPhase(afterSet50.timer, PHASES.SHORT_BREAK, afterSet50.settings);
    store.saveTimerState(shortTimer);
    assert.equal(store.getState().timer.remainingMs, 10 * 60 * 1000);

    // User switches to Long Break -> must be 30 minutes
    const longTimer = switchPhase(store.getState().timer, PHASES.LONG_BREAK, store.getState().settings);
    store.saveTimerState(longTimer);
    assert.equal(store.getState().timer.remainingMs, 30 * 60 * 1000);

    // User switches back to Focus -> must remember 50 minutes (not reset to 25!)
    const backToFocus = switchPhase(store.getState().timer, PHASES.FOCUS, store.getState().settings);
    store.saveTimerState(backToFocus);
    assert.equal(store.getState().timer.remainingMs, 50 * 60 * 1000);
    assert.deepEqual(calculateProportionalBreaks(50), { shortBreakMinutes: 10, longBreakMinutes: 30 });

    // When timer is running or in progress, calling setFocusDuration(50) without forceRestart must not reset progress
    const started = startTimer(store.getState().timer, 1000);
    const midSession = pauseTimer(started, 1000 + 5 * 60 * 1000); // 45m remaining
    store.saveTimerState(midSession);
    const unchanged = store.setFocusDuration(50);
    assert.equal(unchanged.timer.remainingMs, 45 * 60 * 1000);

    // Passing forceRestart: true explicitly restarts to full 50m
    const forced = store.setFocusDuration(50, { forceRestart: true });
    assert.equal(forced.timer.remainingMs, 50 * 60 * 1000);
  });

  it('enforces MAX_TASKS cap with explicit error', () => {
    const storage = createMemoryStorage();
    const store = createPomodoroStore({ storage });

    for (let i = 0; i < MAX_TASKS; i++) {
      store.createTask({ title: `Task ${i + 1}`, estimatedPomodoros: 1 });
    }

    assert.throws(
      () => store.createTask({ title: 'Overflow task', estimatedPomodoros: 1 }),
      /Task limit reached/
    );
  });

  it('never swallows storage write failures and reports context', () => {
    const errors = [];
    const storage = createMemoryStorage({}, { throwOnSet: true });
    const store = createPomodoroStore({
      storage,
      onStorageError: (err) => errors.push(err),
    });

    assert.throws(
      () => store.createTask({ title: 'Will fail write', estimatedPomodoros: 1 }),
      /Failed to persist Pomodoro state/
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /Failed to persist Pomodoro state/);
  });

  it('recovers gracefully from corrupted JSON in localStorage and notifies onStorageError', () => {
    const errors = [];
    const storage = createMemoryStorage({ [STORAGE_KEY]: '{corrupted-json' });
    const store = createPomodoroStore({
      storage,
      onStorageError: (err) => errors.push(err),
    });

    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /Corrupted state in localStorage key "pomodoro_minimal_v1"/);
    assert.deepEqual(store.getState().settings, DEFAULT_SETTINGS);
  });

  it('calculates consecutive daily focus streaks accurately and updates task estimates', () => {
    const storage = createMemoryStorage();
    const store = createPomodoroStore({ storage });

    const task = store.createTask({ title: 'Deep work', estimatedPomodoros: 2 });
    const updated = store.updateTaskEstimate(task.id, 2);
    assert.equal(updated.estimatedPomodoros, 4);

    // Clamp at minimum 1
    const clampedMin = store.updateTaskEstimate(task.id, -10);
    assert.equal(clampedMin.estimatedPomodoros, 1);

    // Record 3 consecutive days ending on 2026-11-10
    store.recordCompletedSession({ phase: PHASES.FOCUS, durationMinutes: 25, dateKey: '2026-11-08' });
    store.recordCompletedSession({ phase: PHASES.FOCUS, durationMinutes: 25, dateKey: '2026-11-09' });
    store.recordCompletedSession({ phase: PHASES.FOCUS, durationMinutes: 25, dateKey: '2026-11-10' });

    assert.equal(store.getStreakDays(new Date(2026, 10, 10, 12, 0, 0)), 3);
    // If today has 0 sessions so far, streak from yesterday (2026-11-10 when querying on Nov 11) is still 3
    assert.equal(store.getStreakDays(new Date(2026, 10, 11, 9, 0, 0)), 3);
    // If a full day is missed (querying on Nov 12), streak resets to 0
    assert.equal(store.getStreakDays(new Date(2026, 10, 12, 9, 0, 0)), 0);
  });
});

describe('Timer Engine (drift-free wall-clock calculations & phase transitions)', () => {
  it('computes drift-free remaining time from targetEndTimeMs', () => {
    const initial = createInitialTimerState(DEFAULT_SETTINGS);
    const started = startTimer(initial, 1_000_000);

    assert.equal(started.isRunning, true);
    assert.equal(started.targetEndTimeMs, 1_000_000 + 25 * 60 * 1000);

    // 10 minutes and 30 seconds later
    const elapsedMs = (10 * 60 + 30) * 1000;
    const remaining = calculateRemainingMs(started, 1_000_000 + elapsedMs);
    assert.equal(remaining, (14 * 60 + 30) * 1000);

    // Pausing captures exact remaining time and clears targetEndTimeMs
    const paused = pauseTimer(started, 1_000_000 + elapsedMs);
    assert.equal(paused.isRunning, false);
    assert.equal(paused.targetEndTimeMs, null);
    assert.equal(paused.remainingMs, (14 * 60 + 30) * 1000);
  });

  it('cycles through Focus -> Short Break -> Focus -> Long Break after longBreakInterval', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      focusMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakInterval: 2,
      autoStartBreaks: true,
      autoStartFocus: false,
    };

    let state = createInitialTimerState(settings);
    assert.equal(state.phase, PHASES.FOCUS);
    assert.equal(state.completedFocusCount, 0);

    // Complete 1st Focus -> Short Break (auto-started because autoStartBreaks: true)
    state = advanceToNextPhase(state, settings, 2_000_000);
    assert.equal(state.phase, PHASES.SHORT_BREAK);
    assert.equal(state.completedFocusCount, 1);
    assert.equal(state.isRunning, true);
    assert.equal(state.remainingMs, 5 * 60 * 1000);

    // Complete Short Break -> 2nd Focus (not auto-started because autoStartFocus: false)
    state = advanceToNextPhase(state, settings, 2_300_000);
    assert.equal(state.phase, PHASES.FOCUS);
    assert.equal(state.completedFocusCount, 1);
    assert.equal(state.isRunning, false);
    assert.equal(state.remainingMs, 25 * 60 * 1000);

    // Complete 2nd Focus -> Long Break (since completedFocusCount reaches 2 == longBreakInterval)
    state = advanceToNextPhase(state, settings, 4_000_000);
    assert.equal(state.phase, PHASES.LONG_BREAK);
    assert.equal(state.completedFocusCount, 2);
    assert.equal(state.isRunning, true);
    assert.equal(state.remainingMs, 15 * 60 * 1000);
  });

  it('formats countdowns and calculates progress ratios accurately', () => {
    assert.equal(formatCountdown(25 * 60 * 1000), '25:00');
    assert.equal(formatCountdown(65 * 1000), '01:05');
    assert.equal(formatCountdown(900), '00:01'); // Rounds up partial seconds while > 0
    assert.equal(formatCountdown(0), '00:00');

    const ratioHalf = calculateProgressRatio(12.5 * 60 * 1000, 25 * 60 * 1000);
    assert.equal(ratioHalf, 0.5);
  });

  it('extends remaining time with adjustRemainingTime while running or paused', () => {
    const initial = createInitialTimerState(DEFAULT_SETTINGS);
    const started = startTimer(initial, 1_000_000);
    //Add 5 minutes while running
    const extended = adjustRemainingTime(started, 5 * 60 * 1000, 1_060_000);
    assert.equal(extended.remainingMs, 29 * 60 * 1000);
    assert.equal(extended.totalDurationMs, 30 * 60 * 1000);
    assert.equal(extended.targetEndTimeMs, 1_060_000 + 29 * 60 * 1000);
  });
});

describe('macOS & Web Notifications module', () => {
  it('dispatches phase notifications to native macOS bridge when available', async () => {
    const messages = [];
    const mockBridge = {
      postMessage(payload) {
        messages.push(payload);
      },
    };

    const result = await sendPhaseNotification(
      {
        completedPhase: PHASES.FOCUS,
        nextPhase: PHASES.SHORT_BREAK,
        nextDurationMinutes: 5,
        activeTaskTitle: 'Ship macOS app',
        enabled: true,
      },
      { nativeBridge: mockBridge }
    );

    assert.equal(result.sent, true);
    assert.equal(result.channel, 'macos-native');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, 'notify');
    assert.match(messages[0].title, /Focus Session Complete/);
    assert.match(messages[0].body, /Ship macOS app/);
  });

  it('syncs countdown state to macOS menu bar bridge', () => {
    const messages = [];
    const mockBridge = {
      postMessage(payload) {
        messages.push(payload);
      },
    };

    syncMacMenuBarTimer(
      { formattedTime: '24:59', phaseLabel: 'Focus', isRunning: true },
      { nativeBridge: mockBridge }
    );

    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0], {
      type: 'timerTick',
      formattedTime: '24:59',
      phaseLabel: 'Focus',
      isRunning: true,
    });
  });

  it('supports selectable sound profiles and strict silent mode ("none")', async () => {
    const storage = createMemoryStorage();
    const store = createPomodoroStore({ storage });

    // Switch sound profile to marimba
    const afterMarimba = store.updateSettings({ soundProfile: SOUND_PROFILES.MARIMBA });
    assert.equal(afterMarimba.settings.soundProfile, SOUND_PROFILES.MARIMBA);
    assert.equal(afterMarimba.settings.soundEnabled, true);
    assert.equal(getProfileNotes(SOUND_PROFILES.MARIMBA, PHASES.FOCUS).length, 4);

    // Switch sound profile to none (Silent)
    const afterSilent = store.updateSettings({ soundProfile: SOUND_PROFILES.NONE });
    assert.equal(afterSilent.settings.soundProfile, SOUND_PROFILES.NONE);
    assert.equal(afterSilent.settings.soundEnabled, false);
    assert.deepEqual(getProfileNotes(SOUND_PROFILES.NONE, PHASES.FOCUS), []);

    const chimeResult = await playPhaseChime(PHASES.FOCUS, {
      enabled: afterSilent.settings.soundEnabled,
      soundProfile: afterSilent.settings.soundProfile,
    });
    assert.equal(chimeResult.played, false);
    assert.equal(chimeResult.profile, SOUND_PROFILES.NONE);
  });
});
