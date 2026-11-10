/**
 * Compact, versioned localStorage persistence module for Minimal Pomodoro.
 *
 * Uses compact single-key JSON serialization ("pomodoro_minimal_v1") with
 * permanent, never-expiring retention mirrored to macOS UserDefaults.
 */

import {
  PHASES,
  createInitialTimerState,
  getPhaseDurationMs,
  calculateProportionalBreaks,
} from './timer-engine.js';
import {
  SOUND_PROFILES,
  isValidSoundProfile,
} from './sound.js';

export const STORAGE_KEY = 'pomodoro_minimal_v1';
export const SCHEMA_VERSION = 1;
export const MAX_STREAK_SCAN_DAYS = 3650;
export const MAX_TASKS = 50;

export const DEFAULT_SETTINGS = Object.freeze({
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  soundEnabled: true,
  soundProfile: SOUND_PROFILES.SINGING_BOWL,
  notificationsEnabled: true,
  proportionalBreaks: true,
});

function validateIntegerInRange(value, fieldName, min, max) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${fieldName} must be an integer between ${min} and ${max}, got: ${String(value)}`);
  }
}

export function formatLocalDateKey(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('[formatLocalDateKey] Valid Date instance required');
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validateSettings(partial, current) {
  const merged = { ...current, ...partial };
  validateIntegerInRange(merged.focusMinutes, 'focusMinutes', 1, 180);
  validateIntegerInRange(merged.shortBreakMinutes, 'shortBreakMinutes', 1, 60);
  validateIntegerInRange(merged.longBreakMinutes, 'longBreakMinutes', 1, 90);
  validateIntegerInRange(merged.longBreakInterval, 'longBreakInterval', 1, 12);

  const resolvedProfile =
    merged.soundProfile !== undefined
      ? merged.soundProfile
      : merged.soundEnabled === false
        ? SOUND_PROFILES.NONE
        : SOUND_PROFILES.SINGING_BOWL;

  if (!isValidSoundProfile(resolvedProfile)) {
    throw new RangeError(`soundProfile must be one of ${Object.values(SOUND_PROFILES).join(', ')}, got: ${String(resolvedProfile)}`);
  }

  const soundEnabled =
    partial.soundProfile !== undefined
      ? resolvedProfile !== SOUND_PROFILES.NONE
      : partial.soundEnabled !== undefined
        ? Boolean(partial.soundEnabled)
        : resolvedProfile !== SOUND_PROFILES.NONE;

  return {
    focusMinutes: merged.focusMinutes,
    shortBreakMinutes: merged.shortBreakMinutes,
    longBreakMinutes: merged.longBreakMinutes,
    longBreakInterval: merged.longBreakInterval,
    autoStartBreaks: Boolean(merged.autoStartBreaks),
    autoStartFocus: Boolean(merged.autoStartFocus),
    soundEnabled,
    soundProfile: soundEnabled
      ? resolvedProfile === SOUND_PROFILES.NONE
        ? SOUND_PROFILES.SINGING_BOWL
        : resolvedProfile
      : SOUND_PROFILES.NONE,
    notificationsEnabled: Boolean(merged.notificationsEnabled),
    proportionalBreaks:
      merged.proportionalBreaks === undefined ? true : Boolean(merged.proportionalBreaks),
  };
}

/**
 * Serializes full application state into a compact wire object so
 * localStorage consumption stays minimal while never expiring data.
 */
function toCompactPayload(state) {
  return {
    v: SCHEMA_VERSION,
    s: [
      state.settings.focusMinutes,
      state.settings.shortBreakMinutes,
      state.settings.longBreakMinutes,
      state.settings.longBreakInterval,
      state.settings.autoStartBreaks ? 1 : 0,
      state.settings.autoStartFocus ? 1 : 0,
      state.settings.soundEnabled ? 1 : 0,
      state.settings.notificationsEnabled ? 1 : 0,
      state.settings.proportionalBreaks ? 1 : 0,
      state.settings.soundProfile,
    ],
    tm: {
      p: state.timer.phase,
      r: state.timer.isRunning ? 1 : 0,
      rem: Math.round(state.timer.remainingMs),
      tot: Math.round(state.timer.totalDurationMs),
      end: state.timer.targetEndTimeMs,
      c: state.timer.completedFocusCount,
    },
    act: state.activeTaskId,
    tk: state.tasks.map((t) => ({
      i: t.id,
      t: t.title,
      e: t.estimatedPomodoros,
      c: t.completedPomodoros,
      d: t.completed ? 1 : 0,
    })),
    h: Object.fromEntries(
      Object.entries(state.history).map(([dateKey, stat]) => [
        dateKey,
        [stat.sessions, stat.minutes],
      ])
    ),
  };
}

function fromCompactPayload(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== SCHEMA_VERSION) {
    throw new Error('Unsupported or missing schema version');
  }
  const sArr = Array.isArray(raw.s) ? raw.s : [];
  const settings = validateSettings(
    {
      focusMinutes: sArr[0] ?? DEFAULT_SETTINGS.focusMinutes,
      shortBreakMinutes: sArr[1] ?? DEFAULT_SETTINGS.shortBreakMinutes,
      longBreakMinutes: sArr[2] ?? DEFAULT_SETTINGS.longBreakMinutes,
      longBreakInterval: sArr[3] ?? DEFAULT_SETTINGS.longBreakInterval,
      autoStartBreaks: Boolean(sArr[4]),
      autoStartFocus: Boolean(sArr[5]),
      soundEnabled: sArr[6] === undefined ? DEFAULT_SETTINGS.soundEnabled : Boolean(sArr[6]),
      notificationsEnabled:
        sArr[7] === undefined ? DEFAULT_SETTINGS.notificationsEnabled : Boolean(sArr[7]),
      proportionalBreaks:
        sArr[8] === undefined ? DEFAULT_SETTINGS.proportionalBreaks : Boolean(sArr[8]),
      soundProfile:
        typeof sArr[9] === 'string' && isValidSoundProfile(sArr[9])
          ? sArr[9]
          : sArr[6] === 0
            ? SOUND_PROFILES.NONE
            : DEFAULT_SETTINGS.soundProfile,
    },
    DEFAULT_SETTINGS
  );

  const rawTimer = raw.tm && typeof raw.tm === 'object' ? raw.tm : {};
  const phase = Object.values(PHASES).includes(rawTimer.p) ? rawTimer.p : PHASES.FOCUS;
  const fallbackTotal = getPhaseDurationMs(phase, settings);
  const timer = {
    phase,
    isRunning: Boolean(rawTimer.r),
    remainingMs:
      typeof rawTimer.rem === 'number' && rawTimer.rem >= 0 ? rawTimer.rem : fallbackTotal,
    totalDurationMs:
      typeof rawTimer.tot === 'number' && rawTimer.tot > 0 ? rawTimer.tot : fallbackTotal,
    targetEndTimeMs: typeof rawTimer.end === 'number' ? rawTimer.end : null,
    completedFocusCount:
      typeof rawTimer.c === 'number' && rawTimer.c >= 0 ? Math.floor(rawTimer.c) : 0,
  };

  const tasks = Array.isArray(raw.tk)
    ? raw.tk.slice(0, MAX_TASKS).map((item) => ({
        id: String(item.i),
        title: String(item.t || '').trim() || 'Untitled task',
        estimatedPomodoros: Math.max(1, Math.min(20, Number(item.e) || 1)),
        completedPomodoros: Math.max(0, Number(item.c) || 0),
        completed: Boolean(item.d),
      }))
    : [];

  const history = {};
  if (raw.h && typeof raw.h === 'object') {
    for (const [dateKey, tuple] of Object.entries(raw.h)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey) && Array.isArray(tuple)) {
        history[dateKey] = {
          sessions: Math.max(0, Number(tuple[0]) || 0),
          minutes: Math.max(0, Number(tuple[1]) || 0),
        };
      }
    }
  }

  const activeTaskId =
    typeof raw.act === 'string' && tasks.some((t) => t.id === raw.act) ? raw.act : null;

  return {
    settings,
    timer,
    activeTaskId,
    tasks,
    history,
  };
}

function generateShortId() {
  return Math.random().toString(36).slice(2, 9);
}

export function createPomodoroStore({
  storage = globalThis.localStorage,
  onStorageError = null,
} = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new TypeError('[createPomodoroStore] Valid Web Storage interface (getItem/setItem) is required');
  }

  const reportError = (error) => {
    if (typeof onStorageError === 'function') {
      onStorageError(error);
    } else {
      console.error(error);
    }
  };

  function createFreshDefaultState() {
    return {
      settings: { ...DEFAULT_SETTINGS },
      timer: createInitialTimerState(DEFAULT_SETTINGS),
      activeTaskId: null,
      tasks: [],
      history: {},
    };
  }

  function loadInitialState() {
    let serialized = null;
    try {
      serialized = storage.getItem(STORAGE_KEY);
    } catch (err) {
      const wrapped = new Error(
        `Failed to read Pomodoro state from localStorage key "${STORAGE_KEY}": ${err.message}`,
        { cause: err }
      );
      reportError(wrapped);
      return createFreshDefaultState();
    }

    if (!serialized) {
      return createFreshDefaultState();
    }

    try {
      const parsed = JSON.parse(serialized);
      return fromCompactPayload(parsed);
    } catch (err) {
      const wrapped = new Error(
        `Corrupted state in localStorage key "${STORAGE_KEY}" (${err.message}); resetting to defaults.`,
        { cause: err }
      );
      reportError(wrapped);
      return createFreshDefaultState();
    }
  }

  let state = loadInitialState();

  function persistState(operationContext) {
    const compact = toCompactPayload(state);
    const serialized = JSON.stringify(compact);
    try {
      storage.setItem(STORAGE_KEY, serialized);
      const nativeBridge = globalThis.webkit?.messageHandlers?.pomodoroNative;
      if (nativeBridge && typeof nativeBridge.postMessage === 'function') {
        nativeBridge.postMessage({ type: 'persistState', serialized });
      }
    } catch (err) {
      const wrapped = new Error(
        `Failed to persist Pomodoro state during "${operationContext}" (key="${STORAGE_KEY}", size=${serialized.length}B): ${err.message}`,
        { cause: err }
      );
      reportError(wrapped);
      throw wrapped;
    }
  }

  return {
    /** Pure query: returns a defensive snapshot of current state */
    getState() {
      return structuredClone(state);
    },

    /** Pure query: returns currently selected active task or null */
    getActiveTask() {
      if (!state.activeTaskId) return null;
      const found = state.tasks.find((t) => t.id === state.activeTaskId);
      return found ? { ...found } : null;
    },

    /** Pure query: returns stats for a specific YYYY-MM-DD key */
    getDailyStats(dateKey = formatLocalDateKey()) {
      if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        throw new TypeError(`[getDailyStats] dateKey must be YYYY-MM-DD, got: ${String(dateKey)}`);
      }
      const entry = state.history[dateKey];
      return entry ? { ...entry } : { sessions: 0, minutes: 0 };
    },

    /** Pure query: returns current localStorage payload size in UTF-8 bytes */
    getStorageUsageBytes() {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return 0;
      return new TextEncoder().encode(raw).byteLength;
    },

    /** Pure query: computes consecutive daily focus streak ending today or yesterday (bounded by MAX_STREAK_SCAN_DAYS) */
    getStreakDays(referenceDate = new Date()) {
      if (!(referenceDate instanceof Date) || Number.isNaN(referenceDate.getTime())) {
        throw new TypeError('[getStreakDays] Valid Date instance required');
      }
      const todayKey = formatLocalDateKey(referenceDate);
      const hasToday = (state.history[todayKey]?.sessions ?? 0) > 0;
      const startOffset = hasToday ? 0 : 1;

      let streak = 0;
      for (let offset = startOffset; offset <= MAX_STREAK_SCAN_DAYS; offset++) {
        const d = new Date(referenceDate);
        d.setDate(referenceDate.getDate() - offset);
        const key = formatLocalDateKey(d);
        if ((state.history[key]?.sessions ?? 0) > 0) {
          streak += 1;
        } else {
          break;
        }
      }
      return streak;
    },

    /** Command: updates user settings, scales breaks proportionally when enabled, and syncs timer duration */
    updateSettings(partialSettings) {
      if (!partialSettings || typeof partialSettings !== 'object') {
        throw new TypeError('[updateSettings] partialSettings object is required');
      }
      const effectivePartial = { ...partialSettings };
      const useProportional =
        effectivePartial.proportionalBreaks !== undefined
          ? Boolean(effectivePartial.proportionalBreaks)
          : Boolean(state.settings.proportionalBreaks);

      if (
        useProportional &&
        typeof effectivePartial.focusMinutes === 'number' &&
        effectivePartial.shortBreakMinutes === undefined &&
        effectivePartial.longBreakMinutes === undefined
      ) {
        validateIntegerInRange(effectivePartial.focusMinutes, 'focusMinutes', 1, 180);
        const scaled = calculateProportionalBreaks(effectivePartial.focusMinutes);
        effectivePartial.shortBreakMinutes = scaled.shortBreakMinutes;
        effectivePartial.longBreakMinutes = scaled.longBreakMinutes;
      }

      const nextSettings = validateSettings(effectivePartial, state.settings);
      const oldPhaseDuration = getPhaseDurationMs(state.timer.phase, state.settings);
      const newPhaseDuration = getPhaseDurationMs(state.timer.phase, nextSettings);
      let nextTimer = state.timer;

      if (!state.timer.isRunning) {
        const durationChanged = newPhaseDuration !== oldPhaseDuration;
        const wasAtFullDuration = state.timer.remainingMs === state.timer.totalDurationMs;
        nextTimer = {
          ...state.timer,
          totalDurationMs: newPhaseDuration,
          remainingMs:
            durationChanged || wasAtFullDuration
              ? newPhaseDuration
              : Math.min(state.timer.remainingMs, newPhaseDuration),
        };
      }

      state = {
        ...state,
        settings: nextSettings,
        timer: nextTimer,
      };
      persistState('updateSettings');
      return this.getState();
    },

    /**
     * Command: adjusts Focus duration (e.g. 25m -> 50m), proportionally scales Short Break (10m)
     * and Long Break (30m), and persists across all phases so switching tabs never loses the setting.
     */
    setFocusDuration(focusMinutes, { nowMs = Date.now(), forceRestart = false } = {}) {
      validateIntegerInRange(focusMinutes, 'focusMinutes', 1, 180);
      const isInProgress =
        state.timer.isRunning || state.timer.remainingMs < state.timer.totalDurationMs;
      if (focusMinutes === state.settings.focusMinutes && isInProgress && !forceRestart) {
        return this.getState();
      }

      const { shortBreakMinutes, longBreakMinutes } = state.settings.proportionalBreaks
        ? calculateProportionalBreaks(focusMinutes)
        : {
            shortBreakMinutes: state.settings.shortBreakMinutes,
            longBreakMinutes: state.settings.longBreakMinutes,
          };

      const nextSettings = validateSettings(
        { focusMinutes, shortBreakMinutes, longBreakMinutes },
        state.settings
      );
      const newPhaseDuration = getPhaseDurationMs(state.timer.phase, nextSettings);

      const nextTimer = {
        ...state.timer,
        totalDurationMs: newPhaseDuration,
        remainingMs: newPhaseDuration,
        targetEndTimeMs: state.timer.isRunning ? nowMs + newPhaseDuration : null,
      };

      state = {
        ...state,
        settings: nextSettings,
        timer: nextTimer,
      };
      persistState('setFocusDuration');
      return this.getState();
    },

    /** Command: saves updated timer state snapshot */
    saveTimerState(nextTimerState) {
      if (!nextTimerState || typeof nextTimerState !== 'object') {
        throw new TypeError('[saveTimerState] nextTimerState object is required');
      }
      state = {
        ...state,
        timer: { ...nextTimerState },
      };
      persistState('saveTimerState');
      return this.getState();
    },

    /** Command: creates a new task and persists */
    createTask({ title, estimatedPomodoros = 1 }) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        throw new RangeError('[createTask] Task title cannot be empty');
      }
      if (state.tasks.length >= MAX_TASKS) {
        throw new RangeError(`[createTask] Task limit reached (${MAX_TASKS}). Clear completed tasks first.`);
      }
      const est = Number(estimatedPomodoros);
      validateIntegerInRange(est, 'estimatedPomodoros', 1, 20);

      const newTask = {
        id: generateShortId(),
        title: title.trim().slice(0, 120),
        estimatedPomodoros: est,
        completedPomodoros: 0,
        completed: false,
      };

      const nextActiveId =
        state.activeTaskId && state.tasks.some((t) => t.id === state.activeTaskId && !t.completed)
          ? state.activeTaskId
          : newTask.id;

      state = {
        ...state,
        tasks: [...state.tasks, newTask],
        activeTaskId: nextActiveId,
      };
      persistState('createTask');
      return { ...newTask };
    },

    /** Command: selects active task by ID (or null) */
    setActiveTask(taskId) {
      if (taskId !== null && !state.tasks.some((t) => t.id === taskId)) {
        throw new RangeError(`[setActiveTask] Task ID "${String(taskId)}" not found`);
      }
      state = {
        ...state,
        activeTaskId: taskId,
      };
      persistState('setActiveTask');
      return this.getActiveTask();
    },

    /** Command: toggles completion status of a task */
    toggleTaskCompleted(taskId) {
      const idx = state.tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) {
        throw new RangeError(`[toggleTaskCompleted] Task ID "${String(taskId)}" not found`);
      }
      const updatedTasks = state.tasks.map((task) =>
        task.id === taskId ? { ...task, completed: !task.completed } : task
      );
      let nextActiveId = state.activeTaskId;
      if (state.activeTaskId === taskId && updatedTasks[idx].completed) {
        const nextIncomplete = updatedTasks.find((t) => !t.completed);
        nextActiveId = nextIncomplete ? nextIncomplete.id : null;
      }
      state = {
        ...state,
        tasks: updatedTasks,
        activeTaskId: nextActiveId,
      };
      persistState('toggleTaskCompleted');
      return { ...updatedTasks[idx] };
    },

    /** Command: adjusts estimated pomodoros on a task within [1, 20] */
    updateTaskEstimate(taskId, delta) {
      if (typeof delta !== 'number' || !Number.isInteger(delta)) {
        throw new TypeError(`[updateTaskEstimate] delta must be an integer, got: ${String(delta)}`);
      }
      const idx = state.tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) {
        throw new RangeError(`[updateTaskEstimate] Task ID "${String(taskId)}" not found`);
      }
      const nextEst = Math.min(20, Math.max(1, state.tasks[idx].estimatedPomodoros + delta));
      const updatedTasks = state.tasks.map((task) =>
        task.id === taskId ? { ...task, estimatedPomodoros: nextEst } : task
      );
      state = {
        ...state,
        tasks: updatedTasks,
      };
      persistState('updateTaskEstimate');
      return { ...updatedTasks[idx] };
    },

    /** Command: deletes a task by ID */
    deleteTask(taskId) {
      if (!state.tasks.some((t) => t.id === taskId)) {
        throw new RangeError(`[deleteTask] Task ID "${String(taskId)}" not found`);
      }
      const remainingTasks = state.tasks.filter((t) => t.id !== taskId);
      let nextActiveId = state.activeTaskId;
      if (state.activeTaskId === taskId) {
        const nextIncomplete = remainingTasks.find((t) => !t.completed);
        nextActiveId = nextIncomplete ? nextIncomplete.id : null;
      }
      state = {
        ...state,
        tasks: remainingTasks,
        activeTaskId: nextActiveId,
      };
      persistState('deleteTask');
    },

    /** Command: removes all completed tasks */
    clearCompletedTasks() {
      const remainingTasks = state.tasks.filter((t) => !t.completed);
      const nextActiveId = remainingTasks.some((t) => t.id === state.activeTaskId)
        ? state.activeTaskId
        : remainingTasks[0]?.id ?? null;
      state = {
        ...state,
        tasks: remainingTasks,
        activeTaskId: nextActiveId,
      };
      persistState('clearCompletedTasks');
    },

    /** Command: records a completed focus session in daily history & increments active task */
    recordCompletedSession({ phase, durationMinutes, dateKey = formatLocalDateKey() }) {
      if (phase !== PHASES.FOCUS) {
        return this.getState();
      }
      if (typeof durationMinutes !== 'number' || durationMinutes <= 0) {
        throw new RangeError(`[recordCompletedSession] durationMinutes must be > 0, got: ${String(durationMinutes)}`);
      }
      const prevDay = state.history[dateKey] || { sessions: 0, minutes: 0 };
      const updatedHistory = {
        ...state.history,
        [dateKey]: {
          sessions: prevDay.sessions + 1,
          minutes: prevDay.minutes + Math.round(durationMinutes),
        },
      };

      const updatedTasks = state.tasks.map((task) =>
        task.id === state.activeTaskId
          ? { ...task, completedPomodoros: task.completedPomodoros + 1 }
          : task
      );

      state = {
        ...state,
        tasks: updatedTasks,
        history: updatedHistory,
      };
      persistState('recordCompletedSession');
      return this.getState();
    },

    /** Command: reloads state from localStorage (e.g. on cross-tab storage event) */
    reloadFromStorage() {
      state = loadInitialState();
      return this.getState();
    },

    /** Command: resets all stored data back to factory defaults */
    resetAllData() {
      state = createFreshDefaultState();
      persistState('resetAllData');
      return this.getState();
    },
  };
}
