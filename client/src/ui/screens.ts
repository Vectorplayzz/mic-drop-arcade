/** The menu screens. Each builder returns its root element plus a few targeted updaters. */
import type { Strings } from '../i18n';
import type { Language, LeaderboardEntry, Period } from '../net/api';
import type { GameOverMsg, LanguageCode, PackSummary } from '../protocol/messages';
import { button, clear, h, setText } from './dom';
import { sprite, type SpriteName } from './sprites';

export interface Screen {
  el: HTMLElement;
  /** Element to focus when the screen appears, so screen readers announce it. */
  focus?: HTMLElement;
  destroy?(): void;
}

function heading(text: string, className = 'screen-title'): HTMLHeadingElement {
  return h('h1', { class: className, text, attrs: { tabindex: -1 } });
}

function languagePicker(
  t: Strings,
  languages: Language[],
  current: LanguageCode,
  onPick: (code: LanguageCode) => void,
): HTMLElement {
  return h(
    'div',
    { class: 'segmented', attrs: { role: 'group', 'aria-label': t.chooseLanguage } },
    ...languages.map((language) =>
      h('button', {
        class: 'segment',
        text: language.label,
        attrs: {
          type: 'button',
          lang: language.code === 'hi-en' ? 'en' : language.code,
          'aria-pressed': String(language.code === current),
        },
        on: { click: () => onPick(language.code) },
      }),
    ),
  );
}

// ---------------------------------------------------------------- title --------------
export interface TitleOptions {
  t: Strings;
  languages: Language[];
  language: LanguageCode;
  onLanguage(code: LanguageCode): void;
  onStart(): void;
  onBoard(): void;
  onCreator(): void;
  onSettings(): void;
  onPrivacy(): void;
}

export function titleScreen(o: TitleOptions): Screen {
  const { t } = o;
  const logo = h(
    'h1',
    { class: 'logo', attrs: { 'aria-label': 'Maata Arcade', tabindex: -1, lang: 'en' } },
    h('span', { class: 'logo-top', text: 'MAATA', attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'logo-bottom', text: 'ARCADE', attrs: { 'aria-hidden': 'true' } }),
  );
  const el = h(
    'section',
    { class: 'screen title' },
    logo,
    h('p', { class: 'tagline', text: t.tagline }),
    h('h2', { class: 'label', text: t.chooseLanguage }),
    languagePicker(t, o.languages, o.language, o.onLanguage),
    h(
      'ol',
      { class: 'how', attrs: { 'aria-label': t.howTitle } },
      h('li', {}, sprite('speaker'), h('span', { text: t.howSteps[0] })),
      h('li', {}, sprite('mic'), h('span', { text: t.howSteps[1] })),
      h('li', {}, sprite('clock'), h('span', { text: t.howSteps[2] })),
    ),
    button(t.start, o.onStart, { class: 'btn-primary btn-big' }),
    h(
      'nav',
      { class: 'menu' },
      button(t.leaderboard, o.onBoard),
      button(t.creator, o.onCreator),
      button(t.settings, o.onSettings),
    ),
    h(
      'footer',
      { class: 'disclosure' },
      h('p', { text: t.disclosure }),
      button(t.privacyLink, o.onPrivacy, { class: 'btn-link' }),
    ),
  );
  return { el, focus: logo };
}

// ---------------------------------------------------------------- gate ---------------
export interface GateScreen extends Screen {
  /** Where the Turnstile widget is rendered. */
  widget: HTMLElement;
  setConnecting(): void;
}

export function gateScreen(t: Strings, onCancel: () => void): GateScreen {
  const title = heading(t.botCheckTitle);
  const body = h('p', { class: 'lead', text: t.botCheckBody, attrs: { role: 'status' } });
  const widget = h('div', { class: 'turnstile' });
  const el = h(
    'section',
    { class: 'screen gate' },
    sprite('dots', 'sprite-big blink'),
    title,
    body,
    widget,
    button(t.back, onCancel),
  );
  return {
    el,
    widget,
    focus: title,
    setConnecting() {
      clear(widget);
      setText(body, t.connecting);
    },
  };
}

// ---------------------------------------------------------------- lobby --------------
export interface LobbyScreen extends Screen {
  setPacks(packs: PackSummary[]): void;
  setNotice(text: string): void;
  setBusy(busy: boolean): void;
}

export function lobbyScreen(
  t: Strings,
  gamesLeft: number,
  onPick: (pack: PackSummary) => void,
  onBack: () => void,
): LobbyScreen {
  const title = heading(t.choosePack);
  const list = h('ul', { class: 'packs' }, h('li', { class: 'muted', text: t.loading }));
  const notice = h('p', { class: 'notice', attrs: { role: 'alert' } });
  const el = h(
    'section',
    { class: 'screen lobby' },
    title,
    notice,
    list,
    h('p', { class: 'muted', text: t.gamesLeft(gamesLeft) }),
    button(t.back, onBack),
  );
  return {
    el,
    focus: title,
    setPacks(packs) {
      clear(list);
      if (packs.length === 0) {
        list.append(h('li', { class: 'muted', text: t.noPacks }));
        return;
      }
      for (const pack of packs) {
        list.append(
          h(
            'li',
            {},
            h(
              'button',
              { class: 'pack', attrs: { type: 'button' }, on: { click: () => onPick(pack) } },
              h('span', { class: 'pack-title', text: pack.title }),
              h('span', { class: 'pack-meta', text: `${pack.topic} · ${t.questions(pack.questions)}` }),
            ),
          ),
        );
      }
    },
    setNotice(text) {
      setText(notice, text);
    },
    setBusy(busy) {
      for (const item of list.querySelectorAll('button')) item.disabled = busy;
    },
  };
}

// ---------------------------------------------------------------- game over ----------
export interface OverScreen extends Screen {
  setSubmitState(state: 'idle' | 'sending' | 'done' | 'locked', message?: string): void;
  setShareStatus(text: string): void;
  /** The socket is gone: swap "play again" for a pointer back to the home screen. */
  endPlayAgain(): void;
}

export interface OverOptions {
  t: Strings;
  final: GameOverMsg;
  canPlayAgain: boolean;
  onSubmit(nickname: string): void;
  onShare(): void;
  onPlayAgain(): void;
  onBoard(): void;
  onHome(): void;
}

export function overScreen(o: OverOptions): OverScreen {
  const { t, final } = o;
  const title = heading(t.gameOver, 'screen-title pixel');
  const input = h('input', {
    class: 'input',
    attrs: {
      id: 'nickname',
      type: 'text',
      name: 'nickname',
      maxlength: 16,
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      enterkeyhint: 'send',
      'aria-describedby': 'nickname-hint nickname-status',
    },
  });
  const submit = h('button', {
    class: 'btn btn-primary',
    text: t.submitScore,
    attrs: { type: 'submit' },
  });
  const status = h('p', {
    class: 'notice',
    attrs: { id: 'nickname-status', role: 'status', 'aria-live': 'polite' },
  });
  const form = h(
    'form',
    {
      class: 'nick-form',
      attrs: { novalidate: true },
      on: {
        submit: (event) => {
          event.preventDefault();
          o.onSubmit(input.value);
        },
      },
    },
    h('label', { class: 'label', text: t.nickname, attrs: { for: 'nickname' } }),
    input,
    h('p', { class: 'muted', text: t.nicknameHint, attrs: { id: 'nickname-hint' } }),
    submit,
    status,
  );
  const shareStatus = h('p', { class: 'muted', attrs: { role: 'status' } });
  const noMoreGames = (): HTMLElement => h('p', { class: 'muted', text: t.noGamesLeft });
  const again = h(
    'div',
    { class: 'again' },
    o.canPlayAgain ? button(t.playAgain, o.onPlayAgain, { class: 'btn-primary' }) : noMoreGames(),
  );
  const el = h(
    'section',
    { class: 'screen over' },
    sprite('trophy', 'sprite-big'),
    title,
    h('p', { class: 'label', text: t.finalScore }),
    h('p', { class: 'final-score pixel', text: String(final.score) }),
    h('p', { class: 'lead', text: t.correctOf(final.correct, final.questions) }),
    form,
    button(t.share, o.onShare),
    shareStatus,
    again,
    h('nav', { class: 'menu' }, button(t.leaderboard, o.onBoard), button(t.home, o.onHome)),
  );
  return {
    el,
    focus: title,
    setSubmitState(state, message = '') {
      const locked = state === 'done' || state === 'locked';
      input.disabled = state !== 'idle';
      submit.disabled = state !== 'idle';
      submit.hidden = locked;
      setText(submit, state === 'sending' ? t.submitting : t.submitScore);
      setText(status, message);
      status.classList.toggle('good', state === 'done');
    },
    setShareStatus(text) {
      setText(shareStatus, text);
    },
    endPlayAgain() {
      if (again.querySelector('button')) again.replaceChildren(noMoreGames());
    },
  };
}

// ---------------------------------------------------------------- leaderboard --------
export interface BoardScreen extends Screen {
  setEntries(entries: LeaderboardEntry[] | 'loading' | 'failed'): void;
}

export interface BoardOptions {
  t: Strings;
  languages: Language[];
  language: LanguageCode;
  period: Period;
  onChange(language: LanguageCode, period: Period): void;
  onBack(): void;
}

export function boardScreen(o: BoardOptions): BoardScreen {
  const { t } = o;
  const title = heading(t.leaderboard);
  const body = h('div', { class: 'board-body', attrs: { 'aria-live': 'polite' } });
  const periods: Array<[Period, string]> = [
    ['today', t.today],
    ['all', t.allTime],
  ];
  const el = h(
    'section',
    { class: 'screen board' },
    title,
    languagePicker(t, o.languages, o.language, (code) => o.onChange(code, o.period)),
    h(
      'div',
      { class: 'segmented', attrs: { role: 'group', 'aria-label': t.leaderboard } },
      ...periods.map(([period, label]) =>
        h('button', {
          class: 'segment',
          text: label,
          attrs: { type: 'button', 'aria-pressed': String(period === o.period) },
          on: { click: () => o.onChange(o.language, period) },
        }),
      ),
    ),
    body,
    button(t.back, o.onBack),
  );
  return {
    el,
    focus: title,
    setEntries(entries) {
      clear(body);
      if (entries === 'loading' || entries === 'failed' || entries.length === 0) {
        const text =
          entries === 'loading' ? t.loading : entries === 'failed' ? t.boardFailed : t.boardEmpty;
        body.append(h('p', { class: 'muted', text }));
        return;
      }
      body.append(
        h(
          'table',
          { class: 'board-table' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { text: t.rank, attrs: { scope: 'col' } }),
              h('th', { text: t.player, attrs: { scope: 'col' } }),
              h('th', { text: t.score, attrs: { scope: 'col' } }),
            ),
          ),
          h(
            'tbody',
            {},
            ...entries.map((entry) =>
              h(
                'tr',
                { class: entry.rank <= 3 ? `top top-${entry.rank}` : '' },
                h('td', { class: 'pixel', text: String(entry.rank) }),
                h(
                  'td',
                  {},
                  h('span', { class: 'nick', text: entry.nickname }),
                  h('span', { class: 'muted', text: ` ${entry.correct}/${entry.questions}` }),
                ),
                h('td', { class: 'pixel', text: String(entry.score) }),
              ),
            ),
          ),
        ),
      );
    },
  };
}

// ---------------------------------------------------------------- problems -----------
export interface ProblemOptions {
  icon: SpriteName;
  title: string;
  body: string;
  /** The server's own wording, shown small under ours. */
  detail?: string;
  actions: Array<{ label: string; primary?: boolean; run(): void }>;
}

export interface ProblemScreen extends Screen {
  setDetail(text: string): void;
}

export function problemScreen(o: ProblemOptions): ProblemScreen {
  const title = heading(o.title);
  const detail = h('p', { class: 'muted', text: o.detail ?? '', attrs: { role: 'status' } });
  const el = h(
    'section',
    { class: 'screen problem', attrs: { role: 'alert' } },
    sprite(o.icon, 'sprite-big'),
    title,
    h('p', { class: 'lead', text: o.body }),
    detail,
    h(
      'nav',
      { class: 'menu' },
      ...o.actions.map((action) =>
        button(action.label, action.run, { class: action.primary ? 'btn-primary' : '' }),
      ),
    ),
  );
  return {
    el,
    focus: title,
    setDetail(text) {
      setText(detail, text);
    },
  };
}

export function loadingScreen(text: string): Screen {
  return {
    el: h(
      'section',
      { class: 'screen gate', attrs: { role: 'status' } },
      sprite('dots', 'sprite-big blink'),
      h('p', { class: 'lead', text }),
    ),
  };
}
