/**
 * UI Controller & Accessibility Orchestrator for Minimal Pomodoro.
 */

import {
  createPomodoroStore,
  STORAGE_KEY,
  formatLocalDateKey,
} from './storage.js';
import {
  PHASES,
  PHASE_META,
  calculateRemainingMs,
  calculateProgressRatio,
  calculateProportionalBreaks,
  startTimer,
  pauseTimer,
  resetTimer,
  switchPhase,
  advanceToNextPhase,
  formatCountdown,
} from './timer-engine.js';
import {
  SOUND_PROFILES,
  SOUND_PROFILE_LABELS,
  playPhaseChime,
  playTactileClick,
} from './sound.js';
import {
  isNativeMacApp,
  requestNotificationPermission,
  sendPhaseNotification,
  syncMacMenuBarTimer,
} from './notifications.js';

const TICK_INTERVAL_MS = 200;

let supportsDisplayTransition;
function canTransitionDisplay() {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  supportsDisplayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return supportsDisplayTransition;
}

function supportsTopLayerExit() {
  return Boolean(window.CSS?.supports?.('overlay', 'auto')) && canTransitionDisplay();
}

async function closeTopLayer(dialogEl, returnValue = '') {
  if (!dialogEl.open) return;
  if (!supportsTopLayerExit()) {
    dialogEl.setAttribute('data-closing', '');
    const animations = dialogEl.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((resolve) => setTimeout(resolve, 400)),
      ]);
    }
    if (!dialogEl.hasAttribute('data-closing')) return;
    dialogEl.removeAttribute('data-closing');
  }
  dialogEl.close(returnValue);
}

function getSystemScheme(darkQuery) {
  return darkQuery.matches ? 'dark' : 'light';
}

function getStoredScheme() {
  try {
    const val = localStorage.getItem('color-scheme');
    return val === 'light' || val === 'dark' ? val : null;
  } catch (err) {
    console.warn('[getStoredScheme] Failed to read color-scheme from localStorage:', err);
    return null;
  }
}

function applyColorSchemeChoice(choice, darkQuery, metaEl) {
  const sys = getSystemScheme(darkQuery);
  try {
    if (choice === 'system' || choice === null) {
      localStorage.removeItem('color-scheme');
      metaEl.content = 'light dark';
    } else if (choice === 'light' || choice === 'dark') {
      localStorage.setItem('color-scheme', choice);
      metaEl.content = choice;
    }
  } catch (err) {
    console.warn(`[applyColorSchemeChoice] Failed to persist color-scheme "${String(choice)}":`, err);
    metaEl.content = choice === 'light' || choice === 'dark' ? choice : 'light dark';
  }
  return sys;
}

function toggleTwoStateScheme(darkQuery, metaEl) {
  const stored = getStoredScheme();
  const sys = getSystemScheme(darkQuery);
  const currentlyRendered = stored ?? sys;
  const target = currentlyRendered === 'dark' ? 'light' : 'dark';

  try {
    if (target !== sys) {
      localStorage.setItem('color-scheme', target);
      metaEl.content = target;
    } else {
      localStorage.removeItem('color-scheme');
      metaEl.content = 'light dark';
    }
  } catch (err) {
    console.warn('[toggleTwoStateScheme] Failed to update color-scheme in localStorage:', err);
    metaEl.content = target;
  }
  return target;
}

function getLast7DaysKeys(referenceDate = new Date()) {
  const days = [];
  const shortDayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'narrow' });
  for (let offset = 6; offset >= 0; offset--) {
    const d = new Date(referenceDate);
    d.setDate(referenceDate.getDate() - offset);
    days.push({
      dateKey: formatLocalDateKey(d),
      dayLabel: shortDayFormatter.format(d),
      isToday: offset === 0,
    });
  }
  return days;
}

function initApp() {
  if (isNativeMacApp()) {
    document.documentElement.dataset.macApp = 'true';
  }
  const announcerEl = document.getElementById('live-announcer');
  const settingsDialog = document.getElementById('settings-dialog');
  const confirmTimerDialog = document.getElementById('confirm-timer-dialog');
  const confirmTimerTitle = document.getElementById('confirm-timer-title');
  const confirmTimerMessage = document.getElementById('confirm-timer-message');
  const confirmTimerCancelBtn = document.getElementById('confirm-timer-cancel-btn');
  const confirmTimerAcceptBtn = document.getElementById('confirm-timer-accept-btn');
  const metaColorScheme = document.querySelector('meta[name="color-scheme"]');
  const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function announcePolite(message) {
    if (!announcerEl || settingsDialog?.open || confirmTimerDialog?.open) return;
    announcerEl.textContent = '';
    setTimeout(() => {
      if (!settingsDialog?.open && !confirmTimerDialog?.open) {
        announcerEl.textContent = message;
      }
    }, 40);
  }

  const store = createPomodoroStore({
    onStorageError(err) {
      const errBanner = document.getElementById('task-form-error');
      if (errBanner) {
        errBanner.textContent = err.message;
        errBanner.hidden = false;
      }
    },
  });

  // DOM References
  const siteHeader = document.querySelector('.site-header');
  const dialWrapper = document.getElementById('dial-wrapper');
  const timerDisplay = document.getElementById('timer-display');
  const phaseSubtitle = document.getElementById('phase-status-label');
  const cycleIndicators = document.getElementById('cycle-indicators');
  const activeIntentKicker = document.getElementById('active-intent-kicker');
  const activeIntentTitle = document.getElementById('active-intent-title');
  const toggleTimerBtn = document.getElementById('toggle-timer-btn');
  const toggleTimerText = document.getElementById('toggle-timer-text');
  const resetTimerBtn = document.getElementById('reset-timer-btn');
  const skipPhaseBtn = document.getElementById('skip-phase-btn');
  const decreaseTimeBtn = document.getElementById('decrease-time-btn');
  const customDurationInput = document.getElementById('custom-duration-input');
  const extendTimeBtn = document.getElementById('extend-time-btn');
  const phaseButtons = Array.from(document.querySelectorAll('[data-phase-select]'));
  const focusTabLabel = document.querySelector('[data-phase-label="focus"]');
  const shortTabLabel = document.querySelector('[data-phase-label="shortBreak"]');
  const longTabLabel = document.querySelector('[data-phase-label="longBreak"]');

  const addTaskForm = document.getElementById('add-task-form');
  const taskTitleInput = document.getElementById('task-title-input');
  const taskEstInput = document.getElementById('task-est-input');
  const taskFormError = document.getElementById('task-form-error');
  const taskListEl = document.getElementById('task-list');
  const tasksSummaryCaption = document.getElementById('tasks-summary-caption');
  const clearCompletedBtn = document.getElementById('clear-completed-btn');

  const statTodayMinutes = document.getElementById('stat-today-minutes');
  const statTodaySessions = document.getElementById('stat-today-sessions');
  const statWeekMinutes = document.getElementById('stat-week-minutes');
  const statWeekSessions = document.getElementById('stat-week-sessions');
  const weekBarsEl = document.getElementById('week-bars');
  const storageBytesLabel = document.getElementById('storage-bytes-label');
  const streakBadge = document.getElementById('streak-badge');

  const themeQuickBtn = document.getElementById('theme-quick-btn');
  const openSettingsBtn = document.getElementById('open-settings-btn');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const cancelSettingsBtn = document.getElementById('cancel-settings-btn');
  const settingsForm = document.getElementById('settings-form');
  const settingsError = document.getElementById('settings-error');
  const themeSystemLabel = document.getElementById('theme-system-label');
  const testNotificationBtn = document.getElementById('test-notification-btn');
  const setFocusMinInput = document.getElementById('set-focus-min');
  const setShortMinInput = document.getElementById('set-short-min');
  const setLongMinInput = document.getElementById('set-long-min');
  const setProportionalCheckbox = document.getElementById('set-proportional');
  const setSoundProfileSelect = document.getElementById('set-sound-profile');
  const previewSoundBtn = document.getElementById('preview-sound-btn');

  // Native macOS window dragging when dragging the header or non-interactive background
  siteHeader?.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('button, input, a, label, select, textarea')) return;
    window.webkit?.messageHandlers?.pomodoroNative?.postMessage({ type: 'startWindowDrag' });
  });

  let tickTimerId = null;

  function syncTickLoop() {
    const { timer } = store.getState();
    if (timer.isRunning && tickTimerId === null) {
      tickTimerId = window.setInterval(handleTimerTick, TICK_INTERVAL_MS);
    } else if (!timer.isRunning && tickTimerId !== null) {
      window.clearInterval(tickTimerId);
      tickTimerId = null;
    }
  }

  function handlePhaseCompletion(completedPhase, nowMs = Date.now()) {
    const currentState = store.getState();
    if (completedPhase === PHASES.FOCUS) {
      store.recordCompletedSession({
        phase: PHASES.FOCUS,
        durationMinutes: currentState.settings.focusMinutes,
      });
    }

    const latest = store.getState();
    const activeTask = store.getActiveTask();
    const nextTimer = advanceToNextPhase(latest.timer, latest.settings, nowMs);
    store.saveTimerState(nextTimer);

    playPhaseChime(completedPhase, {
      enabled: latest.settings.soundEnabled,
      soundProfile: latest.settings.soundProfile,
    });
    sendPhaseNotification({
      completedPhase,
      nextPhase: nextTimer.phase,
      nextDurationMinutes: Math.round(nextTimer.totalDurationMs / 60000),
      activeTaskTitle: activeTask?.title ?? null,
      enabled: latest.settings.notificationsEnabled,
      silent: !latest.settings.soundEnabled || latest.settings.soundProfile === SOUND_PROFILES.NONE,
    });

    const nextMeta = PHASE_META[nextTimer.phase];
    announcePolite(
      `${PHASE_META[completedPhase].label} complete. Switched to ${nextMeta.label} (${formatCountdown(nextTimer.remainingMs)}).`
    );

    renderAll();
    syncTickLoop();
  }

  function handleTimerTick() {
    const state = store.getState();
    if (!state.timer.isRunning) {
      syncTickLoop();
      return;
    }
    const nowMs = Date.now();
    const remainingMs = calculateRemainingMs(state.timer, nowMs);

    if (remainingMs <= 0) {
      handlePhaseCompletion(state.timer.phase, nowMs);
      return;
    }

    renderTimerReadout(state, remainingMs);
  }

  function renderTimerReadout(state, remainingMsOverride = null) {
    const nowMs = Date.now();
    const remainingMs =
      remainingMsOverride !== null
        ? remainingMsOverride
        : calculateRemainingMs(state.timer, nowMs);

    const formatted = formatCountdown(remainingMs);
    const ratio = calculateProgressRatio(remainingMs, state.timer.totalDurationMs);
    const meta = PHASE_META[state.timer.phase];

    document.body.dataset.phase = state.timer.phase;
    timerDisplay.textContent = formatted;
    phaseSubtitle.textContent = meta.subtitle;
    dialWrapper.style.setProperty('--progress', ratio.toFixed(4));

    if (focusTabLabel) focusTabLabel.textContent = `Focus · ${state.settings.focusMinutes}m`;
    if (shortTabLabel) shortTabLabel.textContent = `Short · ${state.settings.shortBreakMinutes}m`;
    if (longTabLabel) longTabLabel.textContent = `Long · ${state.settings.longBreakMinutes}m`;

    if (customDurationInput && document.activeElement !== customDurationInput) {
      const phaseMinutes =
        state.timer.phase === PHASES.FOCUS
          ? state.settings.focusMinutes
          : state.timer.phase === PHASES.SHORT_BREAK
            ? state.settings.shortBreakMinutes
            : state.settings.longBreakMinutes;
      customDurationInput.value = String(phaseMinutes);
    }

    const runningPrefix = state.timer.isRunning ? '' : 'Paused · ';
    document.title = `${formatted} — ${runningPrefix}${meta.shortLabel} | Minimal Pomodoro`;

    syncMacMenuBarTimer({
      formattedTime: formatted,
      phaseLabel: meta.shortLabel,
      isRunning: state.timer.isRunning,
    });

    toggleTimerText.textContent = state.timer.isRunning ? 'Pause' : 'Start';
    toggleTimerBtn.setAttribute(
      'aria-label',
      `${state.timer.isRunning ? 'Pause' : 'Start'} ${meta.label} timer (Shortcut: Space)`
    );

    for (const btn of phaseButtons) {
      const isSelected = btn.dataset.phaseSelect === state.timer.phase;
      btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    }
  }

  function renderCyclePips(state) {
    const interval = state.settings.longBreakInterval;
    const completedInCycle = state.timer.completedFocusCount % interval;
    cycleIndicators.innerHTML = '';

    for (let i = 0; i < interval; i++) {
      const pip = document.createElement('span');
      pip.className = 'cycle-pip';
      const isDone = i < completedInCycle;
      pip.dataset.completed = isDone ? 'true' : 'false';
      cycleIndicators.appendChild(pip);
    }
    cycleIndicators.setAttribute(
      'aria-label',
      `${completedInCycle} of ${interval} focus sessions completed before long break`
    );
  }

  function renderTasks(state) {
    const activeTask = store.getActiveTask();
    if (state.timer.phase === PHASES.FOCUS) {
      if (activeIntentKicker) activeIntentKicker.textContent = 'Current Intent';
      activeIntentTitle.textContent = activeTask
        ? `${activeTask.title} (${activeTask.completedPomodoros}/${activeTask.estimatedPomodoros} pomos)`
        : 'Single-task focus session';
    } else {
      if (activeIntentKicker) activeIntentKicker.textContent = 'Break Detachment';
      activeIntentTitle.textContent = activeTask
        ? `Detach from "${activeTask.title}" — rest your mind`
        : 'Step away from work — rest your mind';
    }

    const incompleteCount = state.tasks.filter((t) => !t.completed).length;
    const totalEst = state.tasks
      .filter((t) => !t.completed)
      .reduce((sum, t) => sum + Math.max(0, t.estimatedPomodoros - t.completedPomodoros), 0);
    const completedCount = state.tasks.length - incompleteCount;

    tasksSummaryCaption.textContent = `${incompleteCount} active · ${totalEst} remaining pomo${totalEst === 1 ? '' : 's'}`;
    clearCompletedBtn.hidden = completedCount === 0;

    taskListEl.innerHTML = '';

    if (state.tasks.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'task-empty';
      emptyLi.textContent = 'No tasks in queue. Add an intention above or start focusing directly.';
      taskListEl.appendChild(emptyLi);
      return;
    }

    for (const task of state.tasks) {
      const li = document.createElement('li');
      li.className = 'task-item';
      li.dataset.active = task.id === state.activeTaskId ? 'true' : 'false';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'task-checkbox';
      checkbox.checked = task.completed;
      checkbox.setAttribute('aria-label', `Mark "${task.title}" as ${task.completed ? 'incomplete' : 'completed'}`);
      checkbox.addEventListener('change', () => {
        store.toggleTaskCompleted(task.id);
        announcePolite(`Task "${task.title}" marked ${checkbox.checked ? 'completed' : 'active'}.`);
        renderAll();
      });

      const titleBtn = document.createElement('button');
      titleBtn.type = 'button';
      titleBtn.className = 'task-title-btn';
      titleBtn.textContent = task.title;
      titleBtn.setAttribute('aria-label', `Select "${task.title}" as active focus task`);
      if (task.estimatedPomodoros > 7) {
        const splitBadge = document.createElement('span');
        splitBadge.className = 'task-split-badge';
        splitBadge.textContent = 'Split (>7)';
        splitBadge.setAttribute('aria-label', 'Cirillo Rule of 5-7: consider splitting tasks over 7 pomodoros');
        titleBtn.appendChild(splitBadge);
      }
      titleBtn.addEventListener('click', () => {
        store.setActiveTask(task.id);
        announcePolite(`Selected active task: ${task.title}`);
        renderAll();
      });

      const pomoGroup = document.createElement('div');
      pomoGroup.className = 'task-pomo-group';

      const decEstBtn = document.createElement('button');
      decEstBtn.type = 'button';
      decEstBtn.className = 'task-step-btn';
      decEstBtn.textContent = '−';
      decEstBtn.setAttribute('aria-label', `Decrease estimated pomodoros for "${task.title}"`);
      decEstBtn.addEventListener('click', () => {
        store.updateTaskEstimate(task.id, -1);
        renderAll();
      });

      const pill = document.createElement('span');
      pill.className = 'task-pomo-pill';
      pill.textContent = `${task.completedPomodoros}/${task.estimatedPomodoros}`;
      pill.setAttribute(
        'aria-label',
        `${task.completedPomodoros} of ${task.estimatedPomodoros} pomodoros completed`
      );

      const incEstBtn = document.createElement('button');
      incEstBtn.type = 'button';
      incEstBtn.className = 'task-step-btn';
      incEstBtn.textContent = '+';
      incEstBtn.setAttribute('aria-label', `Increase estimated pomodoros for "${task.title}"`);
      incEstBtn.addEventListener('click', () => {
        store.updateTaskEstimate(task.id, 1);
        renderAll();
      });

      pomoGroup.append(decEstBtn, pill, incEstBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'task-delete-btn';
      deleteBtn.setAttribute('aria-label', `Delete task "${task.title}"`);
      deleteBtn.innerHTML = `
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M18 6 6 18M6 6l12 12"></path>
        </svg>
      `;
      deleteBtn.addEventListener('click', () => {
        store.deleteTask(task.id);
        announcePolite(`Deleted task "${task.title}".`);
        renderAll();
      });

      li.append(checkbox, titleBtn, pomoGroup, deleteBtn);
      taskListEl.appendChild(li);
    }
  }

  function renderInsights(state) {
    const todayKey = formatLocalDateKey();
    const todayStat = store.getDailyStats(todayKey);

    statTodayMinutes.textContent = `${todayStat.minutes}m`;
    statTodaySessions.textContent = `${todayStat.sessions} session${todayStat.sessions === 1 ? '' : 's'}`;

    const last7Days = getLast7DaysKeys();
    let weekMinutes = 0;
    let weekSessions = 0;
    let maxDayMinutes = 25;

    const dailyRecords = last7Days.map((day) => {
      const stat = state.history[day.dateKey] || { sessions: 0, minutes: 0 };
      weekMinutes += stat.minutes;
      weekSessions += stat.sessions;
      if (stat.minutes > maxDayMinutes) {
        maxDayMinutes = stat.minutes;
      }
      return { ...day, ...stat };
    });

    statWeekMinutes.textContent = `${weekMinutes}m`;
    statWeekSessions.textContent = `${weekSessions} session${weekSessions === 1 ? '' : 's'}`;

    weekBarsEl.innerHTML = '';
    for (const rec of dailyRecords) {
      const col = document.createElement('div');
      col.className = 'day-col';

      const track = document.createElement('div');
      track.className = 'day-bar-track';

      const fill = document.createElement('div');
      fill.className = 'day-bar-fill';
      const pct = rec.minutes > 0 ? Math.max(8, Math.round((rec.minutes / maxDayMinutes) * 100)) : 0;
      fill.style.setProperty('--bar-pct', `${pct}%`);
      track.appendChild(fill);

      const label = document.createElement('span');
      label.className = 'day-label';
      label.dataset.today = rec.isToday ? 'true' : 'false';
      label.textContent = rec.dayLabel;

      col.append(track, label);
      weekBarsEl.appendChild(col);
    }

    const bytes = store.getStorageUsageBytes();
    storageBytesLabel.textContent = `${bytes} B`;

    if (streakBadge) {
      const streak = store.getStreakDays();
      streakBadge.textContent = `${streak}-day streak`;
    }
  }

  function updateSystemThemeLabel() {
    if (!themeSystemLabel) return;
    const sys = getSystemScheme(darkMediaQuery);
    themeSystemLabel.textContent = `System (${sys})`;
  }

  function renderAll() {
    const state = store.getState();
    renderTimerReadout(state);
    renderCyclePips(state);
    renderTasks(state);
    renderInsights(state);
    updateSystemThemeLabel();
  }

  // Reconcile running timer on initial load
  const bootState = store.getState();
  if (bootState.timer.isRunning) {
    const remainingOnBoot = calculateRemainingMs(bootState.timer, Date.now());
    if (remainingOnBoot <= 0) {
      handlePhaseCompletion(bootState.timer.phase, Date.now());
    } else {
      syncTickLoop();
    }
  }
  renderAll();

  // Event Listeners: Timer Controls
  function handleToggleTimer() {
    const current = store.getState();
    const nowMs = Date.now();
    const nextTimer = current.timer.isRunning
      ? pauseTimer(current.timer, nowMs)
      : startTimer(current.timer, nowMs);

    store.saveTimerState(nextTimer);
    playTactileClick({
      enabled: current.settings.soundEnabled,
      soundProfile: current.settings.soundProfile,
    });
    if (nextTimer.isRunning && current.settings.notificationsEnabled) {
      requestNotificationPermission();
    }
    announcePolite(
      `${PHASE_META[nextTimer.phase].label} timer ${nextTimer.isRunning ? 'started' : 'paused'} at ${formatCountdown(nextTimer.remainingMs)}.`
    );
    renderAll();
    syncTickLoop();
  }

  function getSavedPhaseMinutes(state) {
    return state.timer.phase === PHASES.FOCUS
      ? state.settings.focusMinutes
      : state.timer.phase === PHASES.SHORT_BREAK
        ? state.settings.shortBreakMinutes
        : state.settings.longBreakMinutes;
  }

  function isTimerInProgress(state) {
    const remainingMs = calculateRemainingMs(state.timer, Date.now());
    return state.timer.isRunning || remainingMs < state.timer.totalDurationMs;
  }

  let pendingConfirmAction = null;
  let pendingCancelAction = null;

  function requestTimerChangeConfirmation({
    title = 'Restart Active Timer?',
    message,
    confirmLabel = 'Confirm & Restart',
    onConfirm,
    onCancel = null,
  }) {
    if (!confirmTimerDialog) {
      onConfirm();
      return;
    }
    pendingConfirmAction = onConfirm;
    pendingCancelAction = onCancel;
    if (confirmTimerTitle) confirmTimerTitle.textContent = title;
    if (confirmTimerMessage) confirmTimerMessage.textContent = message;
    if (confirmTimerAcceptBtn) confirmTimerAcceptBtn.textContent = confirmLabel;
    if (!confirmTimerDialog.open) {
      confirmTimerDialog.showModal();
    }
  }

  confirmTimerAcceptBtn?.addEventListener('click', () => {
    const action = pendingConfirmAction;
    pendingConfirmAction = null;
    pendingCancelAction = null;
    closeTopLayer(confirmTimerDialog, 'confirm');
    if (typeof action === 'function') {
      action();
    }
  });

  confirmTimerCancelBtn?.addEventListener('click', () => {
    const cancel = pendingCancelAction;
    pendingConfirmAction = null;
    pendingCancelAction = null;
    closeTopLayer(confirmTimerDialog, 'cancel');
    if (typeof cancel === 'function') {
      cancel();
    }
  });

  confirmTimerDialog?.addEventListener('close', () => {
    if (pendingCancelAction) {
      const cancel = pendingCancelAction;
      pendingConfirmAction = null;
      pendingCancelAction = null;
      cancel();
    }
  });

  function executeResetTimer() {
    const current = store.getState();
    const nextTimer = resetTimer(current.timer, current.settings);
    store.saveTimerState(nextTimer);
    announcePolite(`${PHASE_META[nextTimer.phase].label} timer reset to ${formatCountdown(nextTimer.remainingMs)}.`);
    renderAll();
    syncTickLoop();
  }

  function handleResetTimer() {
    const current = store.getState();
    if (!isTimerInProgress(current)) {
      executeResetTimer();
      return;
    }
    const remainingFormatted = formatCountdown(calculateRemainingMs(current.timer, Date.now()));
    const targetMinutes = getSavedPhaseMinutes(current);
    requestTimerChangeConfirmation({
      title: 'Reset Active Timer?',
      message: `Your ${PHASE_META[current.timer.phase].label} timer is currently at ${remainingFormatted}. Resetting will restart the countdown from ${targetMinutes}:00.`,
      confirmLabel: 'Confirm & Reset',
      onConfirm: () => executeResetTimer(),
    });
  }

  function handleSkipPhase() {
    const current = store.getState();
    handlePhaseCompletion(current.timer.phase, Date.now());
  }

  function clampPhaseMinutes(phase, rawMinutes) {
    if (phase === PHASES.FOCUS) {
      return Math.min(180, Math.max(1, Math.round(rawMinutes)));
    }
    if (phase === PHASES.SHORT_BREAK) {
      return Math.min(60, Math.max(1, Math.round(rawMinutes)));
    }
    return Math.min(90, Math.max(3, Math.round(rawMinutes)));
  }

  function applyCustomPhaseMinutes(rawMinutes, { announce = true, forceRestart = false } = {}) {
    const current = store.getState();
    const clamped = clampPhaseMinutes(current.timer.phase, rawMinutes);
    if (current.timer.phase === PHASES.FOCUS) {
      const updated = store.setFocusDuration(clamped, { nowMs: Date.now(), forceRestart });
      if (announce) {
        announcePolite(
          `Set Focus to ${updated.settings.focusMinutes}m (Short Break: ${updated.settings.shortBreakMinutes}m, Long Break: ${updated.settings.longBreakMinutes}m).`
        );
      }
    } else if (current.timer.phase === PHASES.SHORT_BREAK) {
      const updated = store.updateSettings({ shortBreakMinutes: clamped });
      if (forceRestart) {
        const restarted = {
          ...updated.timer,
          totalDurationMs: clamped * 60 * 1000,
          remainingMs: clamped * 60 * 1000,
          targetEndTimeMs: updated.timer.isRunning ? Date.now() + clamped * 60 * 1000 : null,
        };
        store.saveTimerState(restarted);
      }
      if (announce) announcePolite(`Set Short Break to ${clamped}m.`);
    } else {
      const updated = store.updateSettings({ longBreakMinutes: clamped });
      if (forceRestart) {
        const restarted = {
          ...updated.timer,
          totalDurationMs: clamped * 60 * 1000,
          remainingMs: clamped * 60 * 1000,
          targetEndTimeMs: updated.timer.isRunning ? Date.now() + clamped * 60 * 1000 : null,
        };
        store.saveTimerState(restarted);
      }
      if (announce) announcePolite(`Set Long Break to ${clamped}m.`);
    }
    renderAll();
    syncTickLoop();
  }

  function syncDurationInputToStore() {
    if (!customDurationInput) return;
    const latest = store.getState();
    customDurationInput.value = String(getSavedPhaseMinutes(latest));
    renderTimerReadout(latest);
  }

  function handleAdjustPhaseMinutes(deltaMinutes) {
    const current = store.getState();
    const baseMinutes = getSavedPhaseMinutes(current);
    const minAllowed = current.timer.phase === PHASES.FOCUS ? 5 : 1;
    const targetMinutes = clampPhaseMinutes(
      current.timer.phase,
      Math.max(minAllowed, baseMinutes + deltaMinutes)
    );

    if (isTimerInProgress(current)) {
      const remainingFormatted = formatCountdown(calculateRemainingMs(current.timer, Date.now()));
      requestTimerChangeConfirmation({
        title: 'Restart Active Timer?',
        message: `Your ${PHASE_META[current.timer.phase].label} timer is currently at ${remainingFormatted}. Changing the duration to ${targetMinutes} min will restart the countdown from ${targetMinutes}:00.`,
        confirmLabel: 'Confirm & Restart',
        onConfirm: () => {
          applyCustomPhaseMinutes(targetMinutes, { announce: true, forceRestart: true });
          syncDurationInputToStore();
        },
        onCancel: () => syncDurationInputToStore(),
      });
      return;
    }

    applyCustomPhaseMinutes(targetMinutes, { announce: true });
    syncDurationInputToStore();
  }

  toggleTimerBtn.addEventListener('click', handleToggleTimer);
  resetTimerBtn.addEventListener('click', handleResetTimer);
  skipPhaseBtn.addEventListener('click', handleSkipPhase);
  decreaseTimeBtn?.addEventListener('click', () => handleAdjustPhaseMinutes(-5));
  extendTimeBtn?.addEventListener('click', () => handleAdjustPhaseMinutes(5));

  let selectAllOnMouseUp = false;
  let durationInputDirty = false;

  function focusAndSelectDurationInput() {
    if (!customDurationInput) return;
    customDurationInput.focus();
    selectAllOnMouseUp = false;
    customDurationInput.select();
    if (typeof customDurationInput.setSelectionRange === 'function') {
      customDurationInput.setSelectionRange(0, customDurationInput.value.length);
    }
  }

  dialWrapper?.addEventListener('click', () => {
    focusAndSelectDurationInput();
  });

  customDurationInput?.addEventListener('focus', () => {
    selectAllOnMouseUp = true;
    durationInputDirty = false;
    customDurationInput.select();
    if (typeof customDurationInput.setSelectionRange === 'function') {
      customDurationInput.setSelectionRange(0, customDurationInput.value.length);
    }
  });

  customDurationInput?.addEventListener('mouseup', (event) => {
    if (selectAllOnMouseUp) {
      event.preventDefault();
      customDurationInput.select();
      if (typeof customDurationInput.setSelectionRange === 'function') {
        customDurationInput.setSelectionRange(0, customDurationInput.value.length);
      }
      selectAllOnMouseUp = false;
    }
  });

  customDurationInput?.addEventListener('input', () => {
    durationInputDirty = true;
    const digitsOnly = customDurationInput.value.replace(/\D+/g, '');
    if (customDurationInput.value !== digitsOnly) {
      customDurationInput.value = digitsOnly;
    }
    const current = store.getState();
    if (isTimerInProgress(current)) {
      // Do not mutate or reset an active/running timer while typing; confirm on blur/Enter instead.
      return;
    }
    if (digitsOnly === '') {
      timerDisplay.textContent = '00:00';
      return;
    }
    const parsed = Number.parseInt(digitsOnly, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 180) {
      applyCustomPhaseMinutes(parsed, { announce: false });
    }
  });

  customDurationInput?.addEventListener('blur', () => {
    selectAllOnMouseUp = false;
    const wasDirty = durationInputDirty;
    durationInputDirty = false;

    const current = store.getState();
    const savedMinutes = getSavedPhaseMinutes(current);

    // If the user simply clicked the middle input/ring and clicked outside without editing,
    // never restart or touch the running timer.
    if (!wasDirty) {
      customDurationInput.value = String(savedMinutes);
      renderTimerReadout(current);
      return;
    }

    const raw = customDurationInput.value.trim();
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      customDurationInput.value = String(savedMinutes);
      renderTimerReadout(current);
      return;
    }

    const targetMinutes = clampPhaseMinutes(current.timer.phase, parsed);

    if (isTimerInProgress(current)) {
      const remainingFormatted = formatCountdown(calculateRemainingMs(current.timer, Date.now()));
      requestTimerChangeConfirmation({
        title: 'Restart Active Timer?',
        message: `Your ${PHASE_META[current.timer.phase].label} timer is currently at ${remainingFormatted}. Applying ${targetMinutes} min will restart the countdown from ${targetMinutes}:00.`,
        confirmLabel: 'Confirm & Restart',
        onConfirm: () => {
          applyCustomPhaseMinutes(targetMinutes, { announce: true, forceRestart: true });
          syncDurationInputToStore();
        },
        onCancel: () => syncDurationInputToStore(),
      });
      return;
    }

    applyCustomPhaseMinutes(targetMinutes, { announce: true });
    syncDurationInputToStore();
  });

  customDurationInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      customDurationInput.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      durationInputDirty = false;
      syncDurationInputToStore();
      customDurationInput.blur();
    }
  });

  for (const btn of phaseButtons) {
    btn.addEventListener('click', () => {
      const targetPhase = btn.dataset.phaseSelect;
      const current = store.getState();
      if (current.timer.phase === targetPhase) return;

      const executeSwitch = () => {
        const latest = store.getState();
        const nextTimer = switchPhase(latest.timer, targetPhase, latest.settings);
        store.saveTimerState(nextTimer);
        announcePolite(
          `Switched mode to ${PHASE_META[targetPhase].label} (${formatCountdown(nextTimer.remainingMs)}).`
        );
        renderAll();
        syncTickLoop();
      };

      if (isTimerInProgress(current)) {
        const remainingFormatted = formatCountdown(calculateRemainingMs(current.timer, Date.now()));
        requestTimerChangeConfirmation({
          title: 'Switch Mode & Reset Timer?',
          message: `Your ${PHASE_META[current.timer.phase].label} timer is currently at ${remainingFormatted}. Switching to ${PHASE_META[targetPhase].label} will reset the active countdown.`,
          confirmLabel: 'Confirm & Switch',
          onConfirm: executeSwitch,
        });
        return;
      }

      executeSwitch();
    });
  }

  // Event Listeners: Task Queue
  addTaskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    taskFormError.hidden = true;
    const title = taskTitleInput.value.trim();
    const est = Number.parseInt(taskEstInput.value, 10);

    if (!title) {
      taskFormError.textContent = 'Please enter a task description before adding.';
      taskFormError.hidden = false;
      taskTitleInput.focus();
      return;
    }

    try {
      const created = store.createTask({
        title,
        estimatedPomodoros: Number.isFinite(est) ? Math.min(20, Math.max(1, est)) : 1,
      });
      taskTitleInput.value = '';
      taskEstInput.value = '1';
      announcePolite(`Added task "${created.title}".`);
      renderAll();
    } catch (err) {
      taskFormError.textContent = err.message;
      taskFormError.hidden = false;
    }
  });

  clearCompletedBtn.addEventListener('click', () => {
    store.clearCompletedTasks();
    announcePolite('Cleared completed tasks.');
    renderAll();
  });

  // Event Listeners: Theme & Settings Modal
  themeQuickBtn.addEventListener('click', () => {
    const applied = toggleTwoStateScheme(darkMediaQuery, metaColorScheme);
    announcePolite(`Switched to ${applied} color theme.`);
    updateSystemThemeLabel();
  });

  darkMediaQuery.addEventListener('change', () => {
    updateSystemThemeLabel();
  });

  // Live proportional break calculation inside Settings modal
  function syncProportionalBreakInputs() {
    if (!setProportionalCheckbox?.checked) return;
    const val = Number.parseInt(setFocusMinInput.value, 10);
    if (Number.isFinite(val) && val >= 1 && val <= 180) {
      const scaled = calculateProportionalBreaks(val);
      setShortMinInput.value = String(scaled.shortBreakMinutes);
      setLongMinInput.value = String(scaled.longBreakMinutes);
    }
  }

  setFocusMinInput?.addEventListener('input', syncProportionalBreakInputs);
  setProportionalCheckbox?.addEventListener('change', syncProportionalBreakInputs);

  function populateSettingsDialog() {
    const { settings } = store.getState();
    setFocusMinInput.value = String(settings.focusMinutes);
    setShortMinInput.value = String(settings.shortBreakMinutes);
    setLongMinInput.value = String(settings.longBreakMinutes);
    if (setProportionalCheckbox) {
      setProportionalCheckbox.checked = Boolean(settings.proportionalBreaks);
    }
    document.getElementById('set-interval').value = String(settings.longBreakInterval);
    document.getElementById('set-auto-breaks').checked = Boolean(settings.autoStartBreaks);
    document.getElementById('set-auto-focus').checked = Boolean(settings.autoStartFocus);
    if (setSoundProfileSelect) {
      setSoundProfileSelect.value = settings.soundProfile || SOUND_PROFILES.SINGING_BOWL;
    }
    document.getElementById('set-notifications').checked = Boolean(settings.notificationsEnabled);

    const storedScheme = getStoredScheme() ?? 'system';
    const radio = settingsForm.querySelector(`input[name="theme-choice"][value="${storedScheme}"]`);
    if (radio) radio.checked = true;
    updateSystemThemeLabel();
    settingsError.hidden = true;
  }

  openSettingsBtn.addEventListener('click', () => {
    populateSettingsDialog();
    settingsDialog.showModal();
  });

  closeSettingsBtn.addEventListener('click', () => {
    closeTopLayer(settingsDialog, 'cancel');
  });

  cancelSettingsBtn.addEventListener('click', () => {
    closeTopLayer(settingsDialog, 'cancel');
  });

  settingsDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeTopLayer(settingsDialog, 'cancel');
  });

  settingsDialog.addEventListener('close', () => {
    settingsDialog.returnValue = '';
  });

  if (!('closedBy' in HTMLDialogElement.prototype)) {
    settingsDialog.addEventListener('click', (event) => {
      if (event.target !== settingsDialog) return;
      const rect = settingsDialog.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (isDialogContent) return;
      closeTopLayer(settingsDialog, 'cancel');
    });
  }

  settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    settingsError.hidden = true;

    const focusMinutes = Number.parseInt(setFocusMinInput.value, 10);
    const shortBreakMinutes = Number.parseInt(setShortMinInput.value, 10);
    const longBreakMinutes = Number.parseInt(setLongMinInput.value, 10);
    const proportionalBreaks = setProportionalCheckbox ? setProportionalCheckbox.checked : true;
    const longBreakInterval = Number.parseInt(document.getElementById('set-interval').value, 10);
    const autoStartBreaks = document.getElementById('set-auto-breaks').checked;
    const autoStartFocus = document.getElementById('set-auto-focus').checked;
    const soundProfile = setSoundProfileSelect ? setSoundProfileSelect.value : SOUND_PROFILES.SINGING_BOWL;
    const soundEnabled = soundProfile !== SOUND_PROFILES.NONE;
    const notificationsEnabled = document.getElementById('set-notifications').checked;
    const selectedTheme =
      settingsForm.querySelector('input[name="theme-choice"]:checked')?.value ?? 'system';

    try {
      store.updateSettings({
        focusMinutes,
        shortBreakMinutes,
        longBreakMinutes,
        proportionalBreaks,
        longBreakInterval,
        autoStartBreaks,
        autoStartFocus,
        soundEnabled,
        soundProfile,
        notificationsEnabled,
      });
      if (notificationsEnabled) {
        requestNotificationPermission();
      }
      applyColorSchemeChoice(selectedTheme, darkMediaQuery, metaColorScheme);
      renderAll();
      closeTopLayer(settingsDialog, 'save');
      announcePolite('Settings saved.');
    } catch (err) {
      settingsError.textContent = err.message;
      settingsError.hidden = false;
    }
  });

  function handlePreviewSelectedSound() {
    const selectedProfile = setSoundProfileSelect?.value ?? SOUND_PROFILES.SINGING_BOWL;
    if (selectedProfile === SOUND_PROFILES.NONE) {
      announcePolite('Silent mode selected — no sound will play when time is up.');
      return;
    }
    playPhaseChime(PHASES.FOCUS, {
      enabled: true,
      soundProfile: selectedProfile,
    });
    announcePolite(`Playing ${SOUND_PROFILE_LABELS[selectedProfile] || selectedProfile} preview.`);
  }

  previewSoundBtn?.addEventListener('click', handlePreviewSelectedSound);
  setSoundProfileSelect?.addEventListener('change', handlePreviewSelectedSound);

  testNotificationBtn?.addEventListener('click', async () => {
    const activeTask = store.getActiveTask();
    const selectedProfile = setSoundProfileSelect?.value ?? store.getState().settings.soundProfile;
    const isSilent = selectedProfile === SOUND_PROFILES.NONE;
    if (!isSilent) {
      playPhaseChime(PHASES.FOCUS, {
        enabled: true,
        soundProfile: selectedProfile,
      });
    }
    const res = await sendPhaseNotification({
      completedPhase: PHASES.FOCUS,
      nextPhase: PHASES.SHORT_BREAK,
      nextDurationMinutes: store.getState().settings.shortBreakMinutes,
      activeTaskTitle: activeTask?.title ?? 'Deep work session',
      enabled: true,
      silent: isSilent,
    });
    if (!res.sent) {
      settingsError.textContent = `Notification not sent (${res.reason}). Enable notifications in macOS System Settings.`;
      settingsError.hidden = false;
    }
  });

  // Cross-tab synchronization
  window.addEventListener('storage', (event) => {
    if (event.key === 'color-scheme') {
      metaColorScheme.content = event.newValue === 'light' || event.newValue === 'dark'
        ? event.newValue
        : 'light dark';
      updateSystemThemeLabel();
    } else if (event.key === STORAGE_KEY) {
      store.reloadFromStorage();
      renderAll();
      syncTickLoop();
    }
  });

  // Global Keyboard Shortcuts (ignored when typing in inputs or when modal is open)
  window.addEventListener('keydown', (event) => {
    if (settingsDialog.open || confirmTimerDialog?.open) return;
    const targetTag = event.target?.tagName;
    if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || event.target?.isContentEditable) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const key = event.key.toLowerCase();
    if (event.code === 'Space') {
      event.preventDefault();
      handleToggleTimer();
    } else if (key === 'r') {
      event.preventDefault();
      handleResetTimer();
    } else if (key === 's') {
      event.preventDefault();
      handleSkipPhase();
    } else if (key === '1') {
      event.preventDefault();
      phaseButtons[0]?.click();
    } else if (key === '2') {
      event.preventDefault();
      phaseButtons[1]?.click();
    } else if (key === '3') {
      event.preventDefault();
      phaseButtons[2]?.click();
    } else if (key === 'n') {
      event.preventDefault();
      taskTitleInput.focus();
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      handleAdjustPhaseMinutes(5);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      handleAdjustPhaseMinutes(-5);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
