/**
 * Cloudflare Turnstile, explicitly rendered with `action: "start"` (PROTOCOL §1). Its script is
 * the only thing this app loads from another origin, and the nginx CSP allows nothing else.
 */

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** Cloudflare's always-pass test key; the production key is set at build time. */
const DEV_SITE_KEY = '1x00000000000000000000AA';
const SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY || DEV_SITE_KEY;

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: 'dark';
      size: 'flexible';
      'refresh-expired': 'manual';
      callback(token: string): void;
      'error-callback'(code?: string): boolean;
      'expired-callback'(): void;
      'timeout-callback'(): void;
    },
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export class TurnstileError extends Error {
  constructor(readonly reason: 'load' | 'challenge') {
    super(`turnstile ${reason}`);
  }
}

let loading: Promise<TurnstileApi> | null = null;

function load(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new TurnstileError('load'));
    };
    script.onerror = () => reject(new TurnstileError('load'));
    document.head.append(script);
  }).catch((err: unknown) => {
    loading = null; // let a later attempt retry the download
    throw err;
  });
  return loading;
}

/** Shows the widget in `container` and resolves with a token for `POST /api/session`. */
export async function runTurnstile(container: HTMLElement): Promise<string> {
  const api = await load();
  return new Promise<string>((resolve, reject) => {
    let widgetId = '';
    const finish = (settle: () => void): void => {
      try {
        api.remove(widgetId);
      } catch {
        // widget already gone
      }
      settle();
    };
    const fail = (): void => finish(() => reject(new TurnstileError('challenge')));
    widgetId = api.render(container, {
      sitekey: SITE_KEY,
      action: 'start',
      theme: 'dark',
      size: 'flexible',
      'refresh-expired': 'manual',
      callback: (token) => finish(() => resolve(token)),
      'error-callback': () => {
        fail();
        return true;
      },
      'expired-callback': fail,
      'timeout-callback': fail,
    });
  });
}
