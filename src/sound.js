/**
 * Multi-Profile Web Audio API Acoustic Synthesizer for Minimal Pomodoro.
 *
 * Implements 5 psychoacoustically tuned completion sound profiles plus a
 * strict "none" (Silent) profile. All oscillator and gain nodes are
 * guaranteed to disconnect in try/finally blocks on completion.
 */

import { PHASES } from './timer-engine.js';

export const SOUND_PROFILES = Object.freeze({
  SINGING_BOWL: 'singing-bowl',
  ZEN_BELL: 'zen-bell',
  MARIMBA: 'marimba',
  CRYSTAL_CHIME: 'crystal-chime',
  SOFT_PULSE: 'soft-pulse',
  NONE: 'none',
});

export const SOUND_PROFILE_LABELS = Object.freeze({
  [SOUND_PROFILES.SINGING_BOWL]: 'Tibetan Singing Bowl',
  [SOUND_PROFILES.ZEN_BELL]: 'Zen Temple Bell',
  [SOUND_PROFILES.MARIMBA]: 'Warm Wooden Marimba',
  [SOUND_PROFILES.CRYSTAL_CHIME]: 'Crystal Wind Chime',
  [SOUND_PROFILES.SOFT_PULSE]: 'Soft Double-Pulse',
  [SOUND_PROFILES.NONE]: 'No Sound (Silent)',
});

export function isValidSoundProfile(profile) {
  return Object.values(SOUND_PROFILES).includes(profile);
}

let sharedAudioContext = null;

function getOrCreateAudioContext() {
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) {
    return null;
  }
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new AudioCtx();
  }
  return sharedAudioContext;
}

function playTone(
  ctx,
  {
    frequency,
    startTime,
    duration,
    attack = 0.02,
    peakGain = 0.12,
    type = 'sine',
    strikeMultiplier = 1.0,
  }
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  if (strikeMultiplier !== 1.0) {
    osc.frequency.setValueAtTime(frequency * strikeMultiplier, startTime);
    osc.frequency.exponentialRampToValueAtTime(frequency, startTime + 0.045);
  } else {
    osc.frequency.setValueAtTime(frequency, startTime);
  }

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(peakGain, startTime + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.onended = () => {
    try {
      osc.disconnect();
    } finally {
      gain.disconnect();
    }
  };

  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

/**
 * Pure query: returns the note sequence specification for a given sound profile and phase.
 */
export function getProfileNotes(profile, completedPhase = PHASES.FOCUS) {
  if (!isValidSoundProfile(profile)) {
    throw new RangeError(`[getProfileNotes] Unknown sound profile: ${String(profile)}`);
  }
  if (profile === SOUND_PROFILES.NONE) {
    return [];
  }

  const isFocus = completedPhase === PHASES.FOCUS;

  switch (profile) {
    case SOUND_PROFILES.SINGING_BOWL:
      return isFocus
        ? [
            { freq: 523.25, offset: 0.0, dur: 1.1, attack: 0.025, gain: 0.11, type: 'sine' }, // C5
            { freq: 659.25, offset: 0.15, dur: 1.1, attack: 0.025, gain: 0.1, type: 'sine' }, // E5
            { freq: 783.99, offset: 0.3, dur: 1.25, attack: 0.025, gain: 0.09, type: 'sine' }, // G5
            { freq: 987.77, offset: 0.46, dur: 1.5, attack: 0.03, gain: 0.08, type: 'sine' }, // B5
          ]
        : [
            { freq: 587.33, offset: 0.0, dur: 0.9, attack: 0.025, gain: 0.1, type: 'sine' }, // D5
            { freq: 440.0, offset: 0.2, dur: 1.2, attack: 0.025, gain: 0.09, type: 'sine' }, // A4
          ];

    case SOUND_PROFILES.ZEN_BELL:
      // Fundamental + octave harmonic + 2.756x metallic rin-gong overtone
      return isFocus
        ? [
            { freq: 440.0, offset: 0.0, dur: 1.8, attack: 0.012, gain: 0.13, type: 'sine', strike: 1.015 },
            { freq: 880.0, offset: 0.0, dur: 1.1, attack: 0.01, gain: 0.05, type: 'sine', strike: 1.015 },
            { freq: 1212.6, offset: 0.0, dur: 0.65, attack: 0.008, gain: 0.035, type: 'sine', strike: 1.02 },
          ]
        : [
            { freq: 392.0, offset: 0.0, dur: 1.5, attack: 0.012, gain: 0.12, type: 'sine', strike: 1.015 },
            { freq: 784.0, offset: 0.0, dur: 0.9, attack: 0.01, gain: 0.045, type: 'sine', strike: 1.015 },
          ];

    case SOUND_PROFILES.MARIMBA:
      // Woody triangle-wave arpeggio with crisp 8ms mallet attack and short decay
      return isFocus
        ? [
            { freq: 293.66, offset: 0.0, dur: 0.32, attack: 0.008, gain: 0.15, type: 'triangle' }, // D4
            { freq: 369.99, offset: 0.11, dur: 0.32, attack: 0.008, gain: 0.14, type: 'triangle' }, // F#4
            { freq: 440.0, offset: 0.22, dur: 0.34, attack: 0.008, gain: 0.14, type: 'triangle' }, // A4
            { freq: 587.33, offset: 0.33, dur: 0.55, attack: 0.008, gain: 0.15, type: 'triangle' }, // D5
          ]
        : [
            { freq: 440.0, offset: 0.0, dur: 0.32, attack: 0.008, gain: 0.14, type: 'triangle' }, // A4
            { freq: 293.66, offset: 0.14, dur: 0.48, attack: 0.008, gain: 0.14, type: 'triangle' }, // D4
          ];

    case SOUND_PROFILES.CRYSTAL_CHIME:
      // High-register airy pentatonic cascade
      return isFocus
        ? [
            { freq: 783.99, offset: 0.0, dur: 0.85, attack: 0.015, gain: 0.08, type: 'sine' }, // G5
            { freq: 880.0, offset: 0.1, dur: 0.9, attack: 0.015, gain: 0.08, type: 'sine' }, // A5
            { freq: 1046.5, offset: 0.2, dur: 1.0, attack: 0.015, gain: 0.075, type: 'sine' }, // C6
            { freq: 1318.51, offset: 0.31, dur: 1.25, attack: 0.015, gain: 0.07, type: 'sine' }, // E6
          ]
        : [
            { freq: 1046.5, offset: 0.0, dur: 0.8, attack: 0.015, gain: 0.075, type: 'sine' }, // C6
            { freq: 783.99, offset: 0.16, dur: 1.0, attack: 0.015, gain: 0.075, type: 'sine' }, // G5
          ];

    case SOUND_PROFILES.SOFT_PULSE:
      // Minimalist two-pulse gentle tone
      return [
        { freq: 440.0, offset: 0.0, dur: 0.24, attack: 0.02, gain: 0.09, type: 'sine' },
        { freq: 554.37, offset: 0.28, dur: 0.45, attack: 0.02, gain: 0.09, type: 'sine' },
      ];

    default:
      return [];
  }
}

export async function playPhaseChime(
  completedPhase,
  {
    enabled = true,
    soundProfile = SOUND_PROFILES.SINGING_BOWL,
    onError = null,
  } = {}
) {
  if (!enabled || soundProfile === SOUND_PROFILES.NONE) {
    return { played: false, profile: SOUND_PROFILES.NONE };
  }

  const resolvedProfile = isValidSoundProfile(soundProfile)
    ? soundProfile
    : SOUND_PROFILES.SINGING_BOWL;

  try {
    const notes = getProfileNotes(resolvedProfile, completedPhase);
    if (notes.length === 0) {
      return { played: false, profile: resolvedProfile };
    }

    const ctx = getOrCreateAudioContext();
    if (!ctx) {
      return { played: false, profile: resolvedProfile };
    }

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const now = ctx.currentTime;
    for (const note of notes) {
      playTone(ctx, {
        frequency: note.freq,
        startTime: now + note.offset,
        duration: note.dur,
        attack: note.attack,
        peakGain: note.gain,
        type: note.type,
        strikeMultiplier: note.strike ?? 1.0,
      });
    }
    return { played: true, profile: resolvedProfile, noteCount: notes.length };
  } catch (err) {
    const contextualError = new Error(
      `[playPhaseChime] Failed to play profile "${resolvedProfile}" for phase "${String(completedPhase)}": ${err.message}`,
      { cause: err }
    );
    if (typeof onError === 'function') {
      onError(contextualError);
    } else {
      console.warn(contextualError);
    }
    return { played: false, profile: resolvedProfile };
  }
}

export async function playTactileClick({ enabled = true, soundProfile = SOUND_PROFILES.SINGING_BOWL, onError = null } = {}) {
  if (!enabled || soundProfile === SOUND_PROFILES.NONE) return;

  try {
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    playTone(ctx, {
      frequency: 320,
      startTime: ctx.currentTime,
      duration: 0.045,
      attack: 0.005,
      peakGain: 0.045,
      type: 'triangle',
    });
  } catch (err) {
    const contextualError = new Error(
      `[playTactileClick] Failed to play tactile click sound: ${err.message}`,
      { cause: err }
    );
    if (typeof onError === 'function') {
      onError(contextualError);
    } else {
      console.warn(contextualError);
    }
  }
}
