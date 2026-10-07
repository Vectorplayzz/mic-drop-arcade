/**
 * Player preferences kept across visits. Only harmless settings live in localStorage; the
 * session token never does (it stays in memory, PROTOCOL §1).
 */
import { isLanguageCode, type LanguageCode } from './protocol/messages';

export interface Prefs {
  language: LanguageCode | null;
  /** 0..1 */
  voiceVolume: number;
  sfx: boolean;
  music: boolean;
}

const KEY = 'maata.prefs.v1';
const DEFAULTS: Prefs = { language: null, voiceVolume: 1, sfx: true, music: true };

export function loadPrefs(): Prefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const saved = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const volume = saved.voiceVolume;
    return {
      language: isLanguageCode(saved.language) ? saved.language : null,
      voiceVolume:
        typeof volume === 'number' && volume >= 0 && volume <= 1 ? volume : DEFAULTS.voiceVolume,
      sfx: typeof saved.sfx === 'boolean' ? saved.sfx : DEFAULTS.sfx,
      music: typeof saved.music === 'boolean' ? saved.music : DEFAULTS.music,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private browsing or a full disk: the choice just won't be remembered.
  }
}
