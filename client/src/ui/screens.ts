/** The menu screens. Each builder returns its root element plus a few targeted updaters. */
import type { TrailStep } from '../game/machine';
import type { Strings } from '../i18n';
import { type AdvStrings, formatTime } from '../i18n-adventure';
import type { Adventures, Language, LeaderboardEntry, Period } from '../net/api';
import { type FoundEnding, levelFor, type Prefs } from '../prefs';
import {
  type AdventureSummary,
  type EndingBand,
  type GameOverMsg,
  type Hero,
  HEROES,
  type LanguageCode,
  type Wizard,
  WIZARDS,
} from '../protocol/messages';
import { artImage, heroName, heroUrl, sceneUrl, wizardUrl } from './art';
import { button, clear, h, setText } from './dom';
import { contentLang } from './game-screen';
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
    { class: 'segmented langs', attrs: { role: 'group', 'aria-label': t.chooseLanguage } },
    ...languages.map((language) =>
      h('button', {
        class: 'segment',
        text: language.label,
        attrs: {
          type: 'button',
          lang: language.code === 'hi-en' || language.code === 'te-en' ? 'en' : contentLang(language.code),
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
    { class: 'logo', attrs: { 'aria-label': 'Mic Drop Arcade', tabindex: -1, lang: 'en' } },
    h('span', { class: 'logo-top', text: 'MIC DROP', attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'logo-bottom', text: 'ARCADE', attrs: { 'aria-hidden': 'true' } }),
  );
  const el = h(
    'section',
    { class: 'screen title' },
    logo,
    h(
      'div',
      { class: 'title-art', attrs: { 'aria-hidden': 'true' } },
      artImage(wizardUrl('trickster', 'happy'), 'title-wizard title-wizard-far'),
      artImage(wizardUrl('owl', 'cheer'), 'title-wizard'),
      artImage(wizardUrl('sorceress', 'happy'), 'title-wizard title-wizard-main'),
      artImage(wizardUrl('sage', 'ask'), 'title-wizard'),
      artImage(wizardUrl('enchantress', 'ask'), 'title-wizard title-wizard-far'),
    ),
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
  setAdventures(list: Adventures): void;
  setNotice(text: string): void;
  setBusy(busy: boolean): void;
}

export interface LobbyOptions {
  t: Strings;
  a: AdvStrings;
  language: LanguageCode;
  gamesLeft: number;
  hero: Hero;
  wizard: Wizard;
  prefs: Prefs;
  onHero(hero: Hero): void;
  onWizard(wizard: Wizard): void;
  /** Let the wizard's prologue pick the adventure. */
  onAuto(): void;
  onPick(adventure: AdventureSummary): void;
  onBack(): void;
}

/** Five wizards, each with a voice and a personality; the pick narrates every adventure. */
function wizardPicker(
  t: Strings,
  a: AdvStrings,
  current: Wizard,
  onWizard: (wizard: Wizard) => void,
): HTMLElement {
  const buttons = new Map<Wizard, HTMLButtonElement>();
  const select = (wizard: Wizard): void => {
    for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(id === wizard));
  };
  const row = h(
    'div',
    { class: 'wizards', attrs: { role: 'group', 'aria-label': t.chooseWizard } },
    ...WIZARDS.map((wizard) => {
      const b = h(
        'button',
        {
          class: 'wizard-pick',
          attrs: { type: 'button', 'aria-pressed': 'false' },
          on: {
            click: () => {
              select(wizard);
              onWizard(wizard);
            },
          },
        },
        artImage(wizardUrl(wizard, 'ask'), 'wizard-pick-img'),
        h('span', { class: 'wizard-pick-name', text: t.wizardNames[wizard] }),
        h('span', { class: 'wizard-pick-blurb', text: a.wizardBlurbs[wizard] }),
      );
      buttons.set(wizard, b);
      return b;
    }),
  );
  select(current);
  return h('div', { class: 'picker' }, h('h2', { class: 'label', text: t.chooseWizard }), row);
}

/** Twenty heroes; the pick is remembered and rides along with every game. The chosen hero
 * stands large beside the grid, the way it will stand in the story. */
function heroPicker(t: Strings, current: Hero, onHero: (hero: Hero) => void): HTMLElement {
  const spotlightImg = artImage(heroUrl(current), 'hero-spotlight-img');
  const spotlightName = h('p', { class: 'hero-spotlight-name pixel' });
  const picked = h('p', { class: 'sr-only', attrs: { 'aria-live': 'polite' } });
  const buttons = new Map<Hero, HTMLButtonElement>();
  const select = (hero: Hero): void => {
    for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(id === hero));
    spotlightImg.src = heroUrl(hero);
    setText(spotlightName, heroName(hero));
    setText(picked, `${t.yourHero}: ${heroName(hero)}`);
  };
  const grid = h(
    'div',
    { class: 'heroes', attrs: { role: 'group', 'aria-label': t.chooseHero } },
    ...HEROES.map((hero) => {
      const b = h(
        'button',
        {
          class: 'hero',
          attrs: { type: 'button', 'aria-label': heroName(hero), 'aria-pressed': 'false' },
          on: {
            click: () => {
              select(hero);
              onHero(hero);
            },
          },
        },
        artImage(heroUrl(hero), 'hero-img'),
        h('span', { class: 'hero-name', text: heroName(hero), attrs: { 'aria-hidden': 'true' } }),
      );
      buttons.set(hero, b);
      return b;
    }),
  );
  select(current);
  const spotlight = h(
    'figure',
    { class: 'hero-spotlight', attrs: { 'aria-hidden': 'true' } },
    spotlightImg,
    spotlightName,
  );
  return h(
    'div',
    { class: 'picker hero-picker' },
    h('h2', { class: 'label', text: t.chooseHero }),
    h('div', { class: 'hero-picker-body' }, spotlight, grid),
    picked,
  );
}

/** One medal per ending: filled when found, a "?" when still locked. */
function endingShelf(adventure: AdventureSummary, found: Record<string, FoundEnding> | undefined) {
  return h(
    'span',
    { class: 'shelf', attrs: { 'aria-hidden': 'true' } },
    ...adventure.endings.map((e) =>
      h('span', {
        class: `medal medal-${e.rank}${found?.[e.id] ? ' found' : ''}`,
        text: found?.[e.id] ? '' : '?',
      }),
    ),
  );
}

/** The player's level, from experience earned across every run (RPG-style). */
export function levelBadge(xp: number): HTMLElement {
  const { level, into, need } = levelFor(xp);
  const bar = h('span', { class: 'xp-fill' });
  bar.style.transform = `scaleX(${(need > 0 ? into / need : 0).toFixed(3)})`;
  return h(
    'div',
    { class: 'level', attrs: { 'aria-label': `Level ${level}, ${into} of ${need} XP` } },
    h('span', { class: 'level-num pixel', text: `LV ${level}` }),
    h('span', { class: 'xp-bar', attrs: { 'aria-hidden': 'true' } }, bar),
  );
}

function adventureCard(
  o: LobbyOptions,
  adventure: AdventureSummary,
  onClick: () => void,
): HTMLButtonElement {
  const { a } = o;
  const found = o.prefs.endings[adventure.id];
  const count = adventure.endings.filter((e) => found?.[e.id]).length;
  const best = o.prefs.best[adventure.id];
  const lang = contentLang(o.language);
  return h(
    'button',
    { class: `adventure-card genre-${adventure.genre}`, attrs: { type: 'button' }, on: { click: onClick } },
    artImage(sceneUrl(adventure.cover), 'adventure-cover'),
    h(
      'span',
      { class: 'adventure-info' },
      h('span', { class: 'badge pixel', text: a.genres[adventure.genre] }),
      h('span', { class: 'adventure-title', text: adventure.title, attrs: { lang } }),
      h('span', { class: 'adventure-tagline', text: adventure.tagline, attrs: { lang } }),
      h(
        'span',
        { class: 'adventure-meta' },
        endingShelf(adventure, found),
        h('span', { text: a.endingsFound(count, adventure.endings.length) }),
        best && h('span', { class: 'muted', text: a.best(best.score, formatTime(best.ms)) }),
      ),
    ),
  );
}

export function lobbyScreen(o: LobbyOptions): LobbyScreen {
  const { t, a } = o;
  const title = heading(a.orPick);
  const list = h('ul', { class: 'adventures' }, h('li', { class: 'muted', text: t.loading }));
  const notice = h('p', { class: 'notice', attrs: { role: 'alert' } });
  const auto = h(
    'button',
    { class: 'adventure-card auto-card', attrs: { type: 'button', hidden: true }, on: { click: () => o.onAuto() } },
    artImage(sceneUrl('portals'), 'adventure-cover'),
    h(
      'span',
      { class: 'adventure-info' },
      h('span', { class: 'badge pixel', text: a.genres.prologue }),
      h('span', { class: 'adventure-title', text: a.letWizardChoose }),
      h('span', { class: 'adventure-tagline', text: a.letWizardChooseBody }),
    ),
  );
  const make = h(
    'div',
    { class: 'adventure-card make-card', attrs: { 'aria-disabled': 'true' } },
    h(
      'span',
      { class: 'adventure-info' },
      h('span', { class: 'badge badge-soon pixel', text: a.comingSoon }),
      h('span', { class: 'adventure-title', text: a.makeTitle }),
      h('span', { class: 'adventure-tagline', text: a.makeBody }),
    ),
  );
  const el = h(
    'section',
    { class: 'screen lobby' },
    levelBadge(o.prefs.xp),
    wizardPicker(t, a, o.wizard, o.onWizard),
    heroPicker(t, o.hero, o.onHero),
    notice,
    auto,
    title,
    list,
    make,
    h('p', { class: 'muted', text: t.gamesLeft(o.gamesLeft) }),
    button(t.back, o.onBack),
  );
  const buttons = (): HTMLButtonElement[] => [auto, ...list.querySelectorAll('button')];
  return {
    el,
    focus: auto,
    setAdventures(data) {
      auto.hidden = !data.auto;
      clear(list);
      if (data.adventures.length === 0) {
        list.append(h('li', { class: 'muted', text: t.noPacks }));
        return;
      }
      for (const adventure of data.adventures) {
        list.append(h('li', {}, adventureCard(o, adventure, () => o.onPick(adventure))));
      }
    },
    setNotice(text) {
      setText(notice, text);
    },
    setBusy(busy) {
      for (const b of buttons()) b.disabled = busy;
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
  a: AdvStrings;
  language: LanguageCode;
  final: GameOverMsg;
  /** The adventure that was played (null for a quiz). */
  adventure: AdventureSummary | null;
  /** Endings found so far in that adventure, including this one. */
  found: Record<string, FoundEnding>;
  trail: TrailStep[];
  newBest: boolean;
  xpGained: number;
  xpTotal: number;
  levelUp: boolean;
  nickname: string;
  /** How the wizard quest ended, for quiz story packs. */
  ending: EndingBand | null;
  canPlayAgain: boolean;
  onSubmit(nickname: string): void;
  onShare(): void;
  onPlayAgain(): void;
  onNewAdventure(): void;
  onBoard(): void;
  onHome(): void;
}

export function overScreen(o: OverOptions): OverScreen {
  const { t, a, final } = o;
  const adventureRun = final.mode === 'adventure' && final.ending !== null;
  const title = heading(adventureRun ? a.endingReached : t.gameOver, 'screen-title pixel');
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
  input.value = o.nickname;
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
    o.canPlayAgain
      ? button(adventureRun ? a.playAgain : t.playAgain, o.onPlayAgain, { class: 'btn-primary' })
      : noMoreGames(),
    o.canPlayAgain && adventureRun ? button(a.newAdventure, o.onNewAdventure) : null,
  );

  const lang = contentLang(o.language);
  let summary: HTMLElement;
  if (adventureRun && final.ending) {
    const adv = o.adventure;
    const found = adv ? adv.endings.filter((e) => o.found[e.id]).length : 0;
    summary = h(
      'div',
      { class: 'run-summary' },
      adv && h('p', { class: 'run-adventure', text: adv.title, attrs: { lang } }),
      h(
        'p',
        { class: `ending-title ending-rank-${final.ending.rank}` },
        h('span', { class: `medal medal-${final.ending.rank} found`, attrs: { 'aria-hidden': 'true' } }),
        h('span', { text: final.ending.title, attrs: { lang } }),
      ),
      h('p', { class: 'muted', text: a.ranks[final.ending.rank] }),
      h(
        'dl',
        { class: 'run-stats' },
        h('div', {}, h('dt', { text: t.finalScore }), h('dd', { class: 'pixel', text: String(final.score) })),
        h(
          'div',
          {},
          h('dt', { text: a.time }),
          h('dd', { class: 'pixel', text: formatTime(final.duration_ms ?? 0) }),
        ),
        h('div', {}, h('dt', { text: 'XP' }), h('dd', { class: 'pixel xp-gain', text: `+${o.xpGained}` })),
      ),
      o.newBest && h('p', { class: 'flash good', text: a.newBest }),
      o.levelUp && h('p', { class: 'flash level-up pixel', text: `LEVEL UP! LV ${levelFor(o.xpTotal).level}` }),
      levelBadge(o.xpTotal),
      o.trail.length > 0 &&
        h(
          'div',
          { class: 'run-path' },
          h('p', { class: 'label', text: a.yourPath }),
          h(
            'ol',
            { class: 'trail big' },
            ...o.trail.map((s) =>
              h('li', {
                class:
                  s.kind === 'puzzle'
                    ? `trail-step puzzle ${s.skipped ? 'void' : s.correct ? 'good' : 'bad'}`
                    : `trail-step pick${s.auto ? ' auto' : ''}`,
                text: s.kind === 'choice' ? String(s.index + 1) : s.skipped ? '–' : s.correct ? '✓' : '✗',
              }),
            ),
            h('li', { class: `trail-step end medal-${final.ending.rank}`, text: '★' }),
          ),
        ),
      adv &&
        h(
          'div',
          { class: 'run-shelf' },
          endingShelf(adv, o.found),
          h('p', { class: 'muted', text: a.moreEndings(found, adv.endings.length) }),
        ),
    );
  } else {
    summary = h(
      'div',
      { class: 'run-summary' },
      o.ending && h('p', { class: `ending ending-${o.ending}`, text: t.endings[o.ending] }),
      h('p', { class: 'label', text: t.finalScore }),
      h('p', { class: 'final-score pixel', text: String(final.score) }),
      h('p', { class: 'lead', text: t.correctOf(final.correct, final.questions) }),
    );
  }

  const el = h(
    'section',
    { class: 'screen over' },
    h(
      'figure',
      { class: 'over-hero' },
      artImage(heroUrl(final.hero), 'over-hero-img'),
      h('figcaption', { class: 'pixel', text: heroName(final.hero) }),
    ),
    title,
    summary,
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
  a: AdvStrings;
  languages: Language[];
  language: LanguageCode;
  period: Period;
  /** Adventure filter; null shows every adventure. */
  adventure: string | null;
  adventures: AdventureSummary[];
  onChange(language: LanguageCode, period: Period, adventure: string | null): void;
  onBack(): void;
}

export function boardScreen(o: BoardOptions): BoardScreen {
  const { t, a } = o;
  const title = heading(t.leaderboard);
  const body = h('div', { class: 'board-body', attrs: { 'aria-live': 'polite' } });
  const periods: Array<[Period, string]> = [
    ['today', t.today],
    ['all', t.allTime],
  ];
  const titles = new Map(o.adventures.map((adv) => [adv.id, adv.title]));
  const filter = h(
    'select',
    {
      class: 'input board-filter',
      attrs: { 'aria-label': a.allAdventures },
      on: {
        change: (event) => {
          const value = (event.target as HTMLSelectElement).value;
          o.onChange(o.language, o.period, value || null);
        },
      },
    },
    h('option', { text: a.allAdventures, attrs: { value: '' } }),
    ...o.adventures.map((adv) =>
      h('option', { text: adv.title, attrs: { value: adv.id, selected: adv.id === o.adventure } }),
    ),
  );
  const el = h(
    'section',
    { class: 'screen board' },
    title,
    languagePicker(t, o.languages, o.language, (code) => o.onChange(code, o.period, o.adventure)),
    h(
      'div',
      { class: 'segmented', attrs: { role: 'group', 'aria-label': t.leaderboard } },
      ...periods.map(([period, label]) =>
        h('button', {
          class: 'segment',
          text: label,
          attrs: { type: 'button', 'aria-pressed': String(period === o.period) },
          on: { click: () => o.onChange(o.language, period, o.adventure) },
        }),
      ),
    ),
    o.adventures.length > 0 && filter,
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
              h('th', { text: a.boardTime, attrs: { scope: 'col' } }),
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
                  { class: 'board-player' },
                  artImage(heroUrl(entry.hero), 'board-hero', ''),
                  h(
                    'span',
                    { class: 'board-who' },
                    h('span', { class: 'nick', text: entry.nickname }),
                    entry.adventure &&
                      h('span', {
                        class: 'muted board-adv',
                        text: titles.get(entry.adventure) ?? entry.adventure,
                      }),
                  ),
                  entry.endingRank &&
                    h('span', {
                      class: `medal medal-${entry.endingRank} found`,
                      attrs: { title: a.ranks[entry.endingRank], 'aria-label': a.ranks[entry.endingRank] },
                    }),
                ),
                h('td', {
                  class: 'pixel',
                  text: entry.durationMs !== null ? formatTime(entry.durationMs) : '–',
                }),
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
