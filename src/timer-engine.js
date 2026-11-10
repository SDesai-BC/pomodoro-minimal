/**
 * Drift-free wall-clock Pomodoro timer engine.
 *
 * Uses wall-clock target timestamps (`targetEndTimeMs`) while running so
 * background tab throttling or system sleep never introduces countdown drift.
 */

export const PHASES = Object.freeze({
  FOCUS: 'focus',
  SHORT_BREAK: 'shortBreak',
  LONG_BREAK: 'longBreak',
});

export const PHASE_META = Object.freeze({
  [PHASES.FOCUS]: {
    label: 'Focus',
    shortLabel: 'Focus',
    subtitle: 'Single-task deep work interval',
  },
  [PHASES.SHORT_BREAK]: {
    label: 'Short Break',
    shortLabel: 'Short Break',
    subtitle: 'Step away and rest your eyes',
  },
  [PHASES.LONG_BREAK]: {
    label: 'Long Break',
    shortLabel: 'Long Break',
    subtitle: 'Recharge before the next cycle',
  },
});

function assertValidTimestamp(nowMs, context) {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs) || nowMs < 0) {
    throw new TypeError(`[${context}] nowMs must be a non-negative finite number, got: ${String(nowMs)}`);
  }
}

function assertValidPhase(phase, context) {
  if (!Object.values(PHASES).includes(phase)) {
    throw new RangeError(`[${context}] Invalid Pomodoro phase: ${String(phase)}`);
  }
}

export function getPhaseDurationMs(phase, settings) {
  assertValidPhase(phase, 'getPhaseDurationMs');
  if (!settings || typeof settings !== 'object') {
    throw new TypeError('[getPhaseDurationMs] settings object is required');
  }
  const minutesByPhase = {
    [PHASES.FOCUS]: settings.focusMinutes,
    [PHASES.SHORT_BREAK]: settings.shortBreakMinutes,
    [PHASES.LONG_BREAK]: settings.longBreakMinutes,
  };
  const minutes = minutesByPhase[phase];
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) {
    throw new RangeError(`[getPhaseDurationMs] Invalid duration for phase "${phase}": ${String(minutes)}`);
  }
  return Math.round(minutes * 60 * 1000);
}

/**
 * Pure query: calculates proportional Short Break (1:5 / 20%) and Long Break (3:5 / 60%)
 * durations from a given Focus duration in minutes.
 * Example: 25m -> 5m short / 15m long; 50m -> 10m short / 30m long.
 */
export function calculateProportionalBreaks(focusMinutes) {
  if (typeof focusMinutes !== 'number' || !Number.isFinite(focusMinutes) || focusMinutes < 1 || focusMinutes > 180) {
    throw new RangeError(`[calculateProportionalBreaks] focusMinutes must be between 1 and 180, got: ${String(focusMinutes)}`);
  }
  const shortBreakMinutes = Math.min(60, Math.max(1, Math.round(focusMinutes / 5)));
  const longBreakMinutes = Math.min(90, Math.max(3, Math.round((focusMinutes * 3) / 5)));
  return { shortBreakMinutes, longBreakMinutes };
}

export function createInitialTimerState(settings) {
  const totalMs = getPhaseDurationMs(PHASES.FOCUS, settings);
  return {
    phase: PHASES.FOCUS,
    isRunning: false,
    remainingMs: totalMs,
    totalDurationMs: totalMs,
    targetEndTimeMs: null,
    completedFocusCount: 0,
  };
}

export function calculateRemainingMs(timerState, nowMs = Date.now()) {
  if (!timerState || typeof timerState !== 'object') {
    throw new TypeError('[calculateRemainingMs] timerState is required');
  }
  assertValidTimestamp(nowMs, 'calculateRemainingMs');

  if (!timerState.isRunning || typeof timerState.targetEndTimeMs !== 'number') {
    return Math.max(0, Math.round(timerState.remainingMs));
  }
  return Math.max(0, Math.round(timerState.targetEndTimeMs - nowMs));
}

export function calculateProgressRatio(remainingMs, totalDurationMs) {
  if (typeof remainingMs !== 'number' || !Number.isFinite(remainingMs)) {
    throw new TypeError('[calculateProgressRatio] remainingMs must be a finite number');
  }
  if (typeof totalDurationMs !== 'number' || !Number.isFinite(totalDurationMs) || totalDurationMs <= 0) {
    throw new RangeError('[calculateProgressRatio] totalDurationMs must be a positive finite number');
  }
  const clampedRemaining = Math.min(Math.max(0, remainingMs), totalDurationMs);
  return (totalDurationMs - clampedRemaining) / totalDurationMs;
}

export function formatCountdown(remainingMs) {
  if (typeof remainingMs !== 'number' || !Number.isFinite(remainingMs)) {
    throw new TypeError('[formatCountdown] remainingMs must be a finite number');
  }
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function startTimer(timerState, nowMs = Date.now()) {
  assertValidTimestamp(nowMs, 'startTimer');
  const currentRemaining = calculateRemainingMs(timerState, nowMs);
  const effectiveRemaining = currentRemaining > 0 ? currentRemaining : timerState.totalDurationMs;

  return {
    ...timerState,
    isRunning: true,
    remainingMs: effectiveRemaining,
    targetEndTimeMs: nowMs + effectiveRemaining,
  };
}

export function pauseTimer(timerState, nowMs = Date.now()) {
  assertValidTimestamp(nowMs, 'pauseTimer');
  const remainingMs = calculateRemainingMs(timerState, nowMs);

  return {
    ...timerState,
    isRunning: false,
    remainingMs,
    targetEndTimeMs: null,
  };
}

export function resetTimer(timerState, settings) {
  const durationMs = getPhaseDurationMs(timerState.phase, settings);
  return {
    ...timerState,
    isRunning: false,
    remainingMs: durationMs,
    totalDurationMs: durationMs,
    targetEndTimeMs: null,
  };
}

export function switchPhase(timerState, nextPhase, settings) {
  assertValidPhase(nextPhase, 'switchPhase');
  const durationMs = getPhaseDurationMs(nextPhase, settings);
  return {
    ...timerState,
    phase: nextPhase,
    isRunning: false,
    remainingMs: durationMs,
    totalDurationMs: durationMs,
    targetEndTimeMs: null,
  };
}

export function advanceToNextPhase(timerState, settings, nowMs = Date.now()) {
  assertValidTimestamp(nowMs, 'advanceToNextPhase');
  assertValidPhase(timerState.phase, 'advanceToNextPhase');

  let nextPhase = PHASES.FOCUS;
  let completedFocusCount = timerState.completedFocusCount;

  if (timerState.phase === PHASES.FOCUS) {
    completedFocusCount += 1;
    const isLongBreakDue = completedFocusCount % settings.longBreakInterval === 0;
    nextPhase = isLongBreakDue ? PHASES.LONG_BREAK : PHASES.SHORT_BREAK;
  } else {
    nextPhase = PHASES.FOCUS;
  }

  const nextDurationMs = getPhaseDurationMs(nextPhase, settings);
  const shouldAutoStart =
    nextPhase === PHASES.FOCUS ? Boolean(settings.autoStartFocus) : Boolean(settings.autoStartBreaks);

  return {
    phase: nextPhase,
    isRunning: shouldAutoStart,
    remainingMs: nextDurationMs,
    totalDurationMs: nextDurationMs,
    targetEndTimeMs: shouldAutoStart ? nowMs + nextDurationMs : null,
    completedFocusCount,
  };
}

export function adjustRemainingTime(timerState, deltaMs, nowMs = Date.now()) {
  if (typeof deltaMs !== 'number' || !Number.isFinite(deltaMs)) {
    throw new TypeError(`[adjustRemainingTime] deltaMs must be a finite number, got: ${String(deltaMs)}`);
  }
  assertValidTimestamp(nowMs, 'adjustRemainingTime');

  const MAX_DURATION_MS = 180 * 60 * 1000;
  const MIN_REMAINING_MS = 60 * 1000;

  const currentRemaining = calculateRemainingMs(timerState, nowMs);
  const nextRemaining = Math.min(
    MAX_DURATION_MS,
    Math.max(MIN_REMAINING_MS, Math.round(currentRemaining + deltaMs))
  );
  const appliedDelta = nextRemaining - currentRemaining;
  const nextTotal = Math.max(nextRemaining, Math.round(timerState.totalDurationMs + Math.max(0, appliedDelta)));

  return {
    ...timerState,
    remainingMs: nextRemaining,
    totalDurationMs: nextTotal,
    targetEndTimeMs: timerState.isRunning ? nowMs + nextRemaining : null,
  };
}

