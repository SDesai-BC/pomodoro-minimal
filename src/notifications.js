/**
 * Desktop & macOS Native Notification module for Minimal Pomodoro.
 *
 * Routes notifications and live menu-bar countdown updates to the native
 * macOS WKScriptMessageHandler (`window.webkit.messageHandlers.pomodoroNative`)
 * when running inside `Minimal Pomodoro.app`, or falls back to the standard
 * Web Notification API in browsers/PWAs.
 */

import { PHASES, PHASE_META } from './timer-engine.js';

function resolveNativeBridge(overrideBridge = null) {
  if (overrideBridge && typeof overrideBridge.postMessage === 'function') {
    return overrideBridge;
  }
  const handler = globalThis.webkit?.messageHandlers?.pomodoroNative;
  if (handler && typeof handler.postMessage === 'function') {
    return handler;
  }
  return null;
}

export function isNativeMacApp(overrideBridge = null) {
  return resolveNativeBridge(overrideBridge) !== null;
}

export function getNotificationPermissionState(overrideBridge = null) {
  if (isNativeMacApp(overrideBridge)) {
    return 'granted';
  }
  if (!('Notification' in globalThis)) {
    return 'unsupported';
  }
  return globalThis.Notification.permission;
}

export async function requestNotificationPermission({ nativeBridge = null, onError = null } = {}) {
  const bridge = resolveNativeBridge(nativeBridge);
  if (bridge) {
    try {
      bridge.postMessage({ type: 'requestPermission' });
      return 'granted';
    } catch (err) {
      const contextual = new Error(
        `[requestNotificationPermission] Native macOS bridge failed: ${err.message}`,
        { cause: err }
      );
      if (typeof onError === 'function') onError(contextual);
      else console.warn(contextual);
      return 'denied';
    }
  }

  if (!('Notification' in globalThis)) {
    return 'unsupported';
  }
  if (globalThis.Notification.permission === 'granted') {
    return 'granted';
  }
  try {
    return await globalThis.Notification.requestPermission();
  } catch (err) {
    const contextual = new Error(
      `[requestNotificationPermission] Web Notification permission request failed: ${err.message}`,
      { cause: err }
    );
    if (typeof onError === 'function') onError(contextual);
    else console.warn(contextual);
    return 'denied';
  }
}

export function buildPhaseNotificationCopy({
  completedPhase,
  nextPhase,
  nextDurationMinutes,
  activeTaskTitle = null,
}) {
  if (!completedPhase || !PHASE_META[completedPhase]) {
    throw new RangeError(`[buildPhaseNotificationCopy] Invalid completedPhase: ${String(completedPhase)}`);
  }
  if (!nextPhase || !PHASE_META[nextPhase]) {
    throw new RangeError(`[buildPhaseNotificationCopy] Invalid nextPhase: ${String(nextPhase)}`);
  }

  if (completedPhase === PHASES.FOCUS) {
    const nextLabel = PHASE_META[nextPhase].label.toLowerCase();
    const taskPart = activeTaskTitle ? `Completed interval on "${activeTaskTitle}". ` : '';
    return {
      title: 'Focus Session Complete',
      body: `${taskPart}Time for a ${nextDurationMinutes}m ${nextLabel}.`,
    };
  }

  return {
    title: `${PHASE_META[completedPhase].label} Finished`,
    body: activeTaskTitle
      ? `Ready to resume "${activeTaskTitle}" (${nextDurationMinutes}m focus).`
      : `Ready for your next ${nextDurationMinutes}m focus session.`,
  };
}

export async function sendPhaseNotification(
  {
    completedPhase,
    nextPhase,
    nextDurationMinutes,
    activeTaskTitle = null,
    enabled = true,
    silent = false,
  },
  { nativeBridge = null, onError = null } = {}
) {
  if (!enabled) {
    return { sent: false, reason: 'disabled' };
  }

  const { title, body } = buildPhaseNotificationCopy({
    completedPhase,
    nextPhase,
    nextDurationMinutes,
    activeTaskTitle,
  });

  const bridge = resolveNativeBridge(nativeBridge);
  if (bridge) {
    try {
      bridge.postMessage({
        type: 'notify',
        title,
        body,
        phase: completedPhase,
        silent: Boolean(silent),
      });
      return { sent: true, channel: 'macos-native', title, body };
    } catch (err) {
      const contextual = new Error(
        `[sendPhaseNotification] Failed to post notification to macOS native bridge: ${err.message}`,
        { cause: err }
      );
      if (typeof onError === 'function') onError(contextual);
      else console.warn(contextual);
      return { sent: false, reason: 'bridge-error' };
    }
  }

  if (!('Notification' in globalThis)) {
    return { sent: false, reason: 'unsupported' };
  }

  try {
    let permission = globalThis.Notification.permission;
    if (permission === 'default') {
      permission = await globalThis.Notification.requestPermission();
    }
    if (permission !== 'granted') {
      return { sent: false, reason: `permission-${permission}` };
    }

    const notification = new globalThis.Notification(title, {
      body,
      tag: 'minimal-pomodoro-phase',
      renotify: true,
      silent: Boolean(silent),
    });
    notification.onclick = () => {
      if (typeof globalThis.focus === 'function') {
        globalThis.focus();
      }
      notification.close();
    };
    return { sent: true, channel: 'web-notification', title, body };
  } catch (err) {
    const contextual = new Error(
      `[sendPhaseNotification] Failed to dispatch Web Notification: ${err.message}`,
      { cause: err }
    );
    if (typeof onError === 'function') onError(contextual);
    else console.warn(contextual);
    return { sent: false, reason: 'error' };
  }
}

export function syncMacMenuBarTimer(
  { formattedTime, phaseLabel, isRunning },
  { nativeBridge = null, onError = null } = {}
) {
  const bridge = resolveNativeBridge(nativeBridge);
  if (!bridge) return false;

  try {
    bridge.postMessage({
      type: 'timerTick',
      formattedTime: String(formattedTime),
      phaseLabel: String(phaseLabel),
      isRunning: Boolean(isRunning),
    });
    return true;
  } catch (err) {
    const contextual = new Error(
      `[syncMacMenuBarTimer] Failed to update macOS menu bar timer: ${err.message}`,
      { cause: err }
    );
    if (typeof onError === 'function') onError(contextual);
    else console.warn(contextual);
    return false;
  }
}
