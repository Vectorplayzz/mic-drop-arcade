/**
 * The in-game screen, laid out like a visual novel over the full-screen painted scene:
 * - the player's wizard big on the left and the player's hero on the right;
 * - the spoken choice cards (or a riddle's options) top right;
 * - a dark dialogue box along the bottom.
 *
 * During an adventure the HUD shows the RPG state the server sends: score, the adventure's meter
 * (time, spark, clues, power, nerve...), the bag of items picked up, and a trail with one pip per
 * answer. It only displays what the server sent; every verdict and number comes from there.
 */
import type { GameState, Phase } from '../game/machine';
import type { Strings } from '../i18n';
import { type AdvStrings, advStringsFor } from '../i18n-adventure';
import type { Hero, LanguageCode, MeterIcon, Mood, Wizard } from '../protocol/messages';
import { artImage, heroName, heroUrl, preload, wizardUrl } from './art';
import { button, clear, h, setText } from './dom';
import type { Screen } from './screens';
import { sprite, type SpriteName } from './sprites';

export interface GameScreen extends Screen {
  update(state: GameState): void;
  /** Mic loudness, 0..1. */
  setLevel(level: number): void;
  /** `fraction` of the answer time left (1 → 0); null hides the countdown. */
  setTimer(fraction: number | null, secondsLeft: number): void;
  /** The browser is holding the sound back: show a tap-to-unmute chip. */
  setSoundBlocked(blocked: boolean): void;
}

export interface GameScreenOptions {
  t: Strings;
  language: LanguageCode;
  /** The wizard the player picked; it narrates. */
  wizard: Wizard;
  onQuit(): void;
  onUnmute(): void;
}

const STATUS_ICON: Partial<Record<Phase, SpriteName>> = {
  speaking: 'speaker',
  listening: 'mic',
  checking: 'dots',
};

const METER_SPRITE: Record<MeterIcon, SpriteName> = {
  clock: 'clock',
  heart: 'heart',
  search: 'search',
  bolt: 'bolt',
  nerve: 'nerve',
  flame: 'flame',
  star: 'star',
};

const MOODS: readonly Mood[] = ['ask', 'happy', 'sad', 'cheer'];
const TOAST_MS = 2600;

/** Loose comparison for highlighting the right choice: case, spacing and Unicode form. */
const same = (a: string, b: string): boolean =>
  a.normalize('NFC').trim().toLocaleLowerCase() === b.normalize('NFC').trim().toLocaleLowerCase();

/** The `lang` attribute for text in a game language (Hinglish and Tenglish are Latin script). */
export function contentLang(language: LanguageCode): string {
  switch (language) {
    case 'hi-en':
      return 'hi-Latn';
    case 'te-en':
      return 'te-Latn';
    case 'en-IN':
      return 'en';
    default:
      return language;
  }
}

/**
 * The name on the dialogue box: the quest's own wizard name when the player's wizard is the
 * one a quiz pack was written for, otherwise the picked wizard's title.
 */
export function speakerName(t: Strings, wizard: Wizard, state: GameState): string {
  if (state.mode === 'quiz' && state.story && state.story.sprite === wizard) return state.story.wizard;
  return t.wizardNames[state.wizard ?? wizard];
}

export function gameScreen(o: GameScreenOptions): GameScreen {
  const { t } = o;
  const a: AdvStrings = advStringsFor(o.language);
  const lang = contentLang(o.language);
  let wizardId: Wizard = o.wizard;

  // --- HUD ---------------------------------------------------------------------------
  const score = h('span', { class: 'hud-value pixel', text: '0' });
  const meterLabel = h('span', { class: 'sr-only' });
  const meterPips = h('span', { class: 'meter-pips', attrs: { 'aria-hidden': 'true' } });
  const meter = h(
    'div',
    { class: 'hud-item hud-meter', attrs: { hidden: true } },
    meterPips,
    meterLabel,
  );
  const trail = h('ol', { class: 'trail', attrs: { 'aria-label': a.yourPath } });
  const unmute = h('button', {
    class: 'btn btn-small sound-chip',
    text: t.soundOff,
    attrs: { type: 'button', hidden: true },
    on: { click: () => o.onUnmute() },
  });

  const bagList = h('ul', { class: 'bag-items' });
  const bag = h(
    'div',
    { class: 'bag', attrs: { hidden: true, 'aria-label': a.bag, role: 'group' } },
    sprite('bag', 'sprite-bag'),
    bagList,
  );
  const toast = h('p', { class: 'toast', attrs: { role: 'status', hidden: true } });

  const timerFill = h('div', { class: 'timer-fill' });
  const timerText = h('span', { class: 'sr-only' });
  const timer = h(
    'div',
    { class: 'timer', attrs: { role: 'timer', 'aria-live': 'off', hidden: true } },
    timerFill,
    timerText,
  );

  // --- characters and cards -----------------------------------------------------------
  const wizard = artImage(wizardUrl(wizardId, 'ask'), 'stage-wizard');
  const hero = artImage(heroUrl('arjun'), 'stage-hero');
  const heroLabel = h('span', { class: 'sr-only' });

  const cardsTitle = h('p', { class: 'cards-title pixel' });
  const cardList = h('ol', { class: 'cards' });
  const cardsHint = h('p', { class: 'cards-hint' });
  const cards = h(
    'div',
    { class: 'card-panel', attrs: { hidden: true, 'aria-live': 'polite' } },
    cardsTitle,
    cardList,
    cardsHint,
  );
  const play = h('div', { class: 'play' }, wizard, hero, heroLabel, cards);

  // --- dialogue box --------------------------------------------------------------------
  const speaker = h('p', { class: 'dialogue-name pixel' });
  const line = h('p', { class: 'dialogue-text', attrs: { 'aria-live': 'polite', lang } });
  const icon = h('div', { class: 'status-icon' });
  const statusText = h('p', { class: 'status-text', attrs: { role: 'status', 'aria-live': 'assertive' } });
  const meterFill = h('div', { class: 'meter-fill' });
  const level = h('div', { class: 'meter', attrs: { 'aria-hidden': 'true' } }, meterFill);
  const micState = h('span', { class: 'sr-only', attrs: { role: 'status' } });
  const verdict = h('div', { class: 'verdict', attrs: { 'aria-live': 'polite', hidden: true } });
  const status = h('div', { class: 'dialogue-status' }, icon, statusText, level, micState);
  const dialogue = h('div', { class: 'dialogue' }, speaker, line, status, verdict);

  const heading = h('h1', { class: 'sr-only', attrs: { tabindex: -1, lang } });

  const el = h(
    'section',
    { class: 'screen game' },
    h(
      'header',
      { class: 'hud' },
      h('div', { class: 'hud-item' }, h('span', { class: 'hud-label', text: t.score }), score),
      meter,
      trail,
      button(t.quit, o.onQuit, { class: 'btn-small hud-quit' }),
    ),
    unmute,
    bag,
    toast,
    timer,
    heading,
    play,
    dialogue,
  );

  let shownIcon: SpriteName | null = null;
  let shownCards = '';
  let shownVerdict: unknown = null;
  let shownMeter = '';
  let shownBag = '';
  let shownTrail = -1;
  let shownHero = '';
  let toastTimer = 0;

  const showIcon = (name: SpriteName): void => {
    if (shownIcon === name) return;
    shownIcon = name;
    icon.replaceChildren(sprite(name, 'sprite-status'));
  };

  const setSrc = (img: HTMLImageElement, src: string): void => {
    if (img.getAttribute('src') !== src) img.src = src;
  };

  const showToast = (text: string): void => {
    window.clearTimeout(toastTimer);
    setText(toast, text);
    toast.hidden = false;
    toast.classList.remove('pop');
    void toast.offsetWidth; // restart the CSS animation
    toast.classList.add('pop');
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, TOAST_MS);
  };

  const setWizard = (next: Wizard): void => {
    if (next === wizardId && shownHero) return;
    wizardId = next;
    preload(MOODS.map((mood) => wizardUrl(wizardId, mood)));
  };

  // --- meter, bag, trail -----------------------------------------------------------------
  const renderMeter = (state: GameState): void => {
    const info = state.adventure?.meter;
    const key = info ? `${info.icon}:${state.meter}:${info.max}:${state.meterDelta}` : '';
    if (key === shownMeter) return;
    const prev = shownMeter;
    shownMeter = key;
    meter.hidden = !info || state.meter === null;
    if (!info || state.meter === null) return;
    const pips: HTMLElement[] = [];
    for (let i = 0; i < info.max; i++) {
      const pip = h('span', { class: `pip${i < state.meter ? ' on' : ''}` });
      pip.append(sprite(METER_SPRITE[info.icon], 'sprite-pip'));
      pips.push(pip);
    }
    meterPips.replaceChildren(h('span', { class: 'hud-label', text: info.label }), ...pips);
    setText(meterLabel, a.meterAria(info.label, state.meter, info.max));
    if (prev && state.meterDelta !== 0) {
      meter.classList.remove('up', 'down');
      void meter.offsetWidth;
      meter.classList.add(state.meterDelta > 0 ? 'up' : 'down');
    }
  };

  const renderBag = (state: GameState): void => {
    const key = state.items.map((i) => i.id).join(',');
    if (key === shownBag) return;
    const before = new Set(shownBag ? shownBag.split(',') : []);
    shownBag = key;
    bag.hidden = state.items.length === 0;
    bagList.replaceChildren(
      ...state.items.map((item) =>
        h('li', { class: `bag-item${before.has(item.id) ? '' : ' new'}`, text: item.label, attrs: { lang } }),
      ),
    );
    const fresh = state.items.filter((i) => !before.has(i.id) && state.gained.includes(i.id));
    if (fresh.length > 0) showToast(a.got(fresh.map((i) => i.label).join(', ')));
  };

  const renderTrail = (state: GameState): void => {
    if (state.trail.length === shownTrail) return;
    shownTrail = state.trail.length;
    trail.replaceChildren(
      ...state.trail.map((s) =>
        h('li', {
          class:
            s.kind === 'puzzle'
              ? `trail-step puzzle ${s.correct ? 'good' : 'bad'}`
              : `trail-step pick${s.auto ? ' auto' : ''}`,
          text: s.kind === 'choice' ? String(s.index + 1) : s.correct ? '✓' : '✗',
        }),
      ),
    );
  };

  // --- cards -----------------------------------------------------------------------------
  const renderCards = (state: GameState): void => {
    const adventure = state.mode === 'adventure';
    const options = adventure ? (state.choices ?? (state.puzzle ? state.options : null)) : state.options;
    const isPuzzle = adventure ? state.puzzle !== null && state.choices === null : true;
    const key = options ? `${isPuzzle ? 'p' : 'c'}|${options.join('|')}` : '';
    if (key !== shownCards) {
      shownCards = key;
      cards.hidden = options === null;
      play.classList.toggle('has-choices', options !== null);
      cards.classList.toggle('is-puzzle', isPuzzle);
      setText(cardsTitle, isPuzzle ? (adventure ? a.riddle : '') : '');
      cardsTitle.hidden = !isPuzzle || !adventure;
      cardList.replaceChildren(
        ...(options ?? []).map((option, i) =>
          h(
            'li',
            { class: 'card' },
            h('span', { class: 'card-key pixel', text: String(i + 1) }),
            h('span', { class: 'card-text', text: option, attrs: { lang } }),
          ),
        ),
      );
    }
    if (!options) return;
    const items = [...cardList.children];
    // Choice made: light the card the server heard, dim the rest.
    if (adventure && state.choices) {
      items.forEach((item, i) => {
        item.classList.toggle('picked', state.chosen === i);
        item.classList.toggle('dim', state.chosen !== null && state.chosen !== i);
      });
      cards.classList.toggle('shake', state.phase === 'speaking' && state.heardNothing > 0);
      setText(
        cardsHint,
        state.chosen !== null
          ? state.chosenAuto
            ? a.wizardPicked
            : ''
          : state.heardNothing > 0
            ? `${a.unclear} · ${a.triesLeft(Math.max(0, 3 - state.heardNothing))}`
            : a.sayChoice,
      );
      return;
    }
    // Riddle or quiz answer: after the verdict, light up the right one.
    const result = adventure ? state.puzzleResult : state.phase === 'result' ? state.result : null;
    items.forEach((item, i) => {
      const option = options[i];
      const right = Boolean(result && !result.skipped && option && same(option, result.answer));
      item.classList.toggle('right', right);
      item.classList.toggle('dim', Boolean(result && !result.skipped && !right));
    });
    setText(cardsHint, result ? '' : adventure ? a.sayAnswer : '');
  };

  // --- verdict ---------------------------------------------------------------------------
  const renderVerdict = (state: GameState): void => {
    const result =
      state.mode === 'adventure'
        ? state.phase === 'result'
          ? state.puzzleResult
          : null
        : state.phase === 'result'
          ? state.result
          : null;
    if (result === shownVerdict) return;
    shownVerdict = result;
    clear(verdict);
    verdict.hidden = result === null;
    status.hidden = result !== null;
    verdict.className = 'verdict';
    if (!result) return;
    if (result.skipped) {
      verdict.append(h('p', { class: 'verdict-title', text: t.skipped }));
      return;
    }
    verdict.classList.add(result.correct ? 'good' : 'bad');
    const title = result.correct ? t.correct : result.timed_out ? t.timeout : t.wrong;
    verdict.append(
      sprite(result.correct ? 'check' : result.timed_out ? 'clock' : 'cross', 'sprite-status'),
      h(
        'p',
        { class: 'verdict-title' },
        h('span', { text: title }),
        result.points > 0 && h('span', { class: 'points pixel', text: ` ${t.points(result.points)}` }),
      ),
    );
    if (result.answer && !result.correct) {
      verdict.append(
        h(
          'p',
          { class: 'verdict-line' },
          h('span', { class: 'muted', text: `${t.answerIs}: ` }),
          h('strong', { text: result.answer, attrs: { lang } }),
        ),
      );
    }
    if (result.heard) {
      verdict.append(
        h(
          'p',
          { class: 'verdict-line muted' },
          h('span', { text: `${t.youSaid}: ` }),
          h('span', { text: result.heard }),
        ),
      );
    }
  };

  return {
    el,
    focus: heading,
    update(state) {
      if (state.wizard && state.wizard !== wizardId) setWizard(state.wizard);
      if (!shownHero) setWizard(wizardId);
      if (shownHero !== state.hero) {
        shownHero = state.hero;
        setSrc(hero, heroUrl(state.hero as Hero));
        setText(heroLabel, `${t.yourHero}: ${heroName(state.hero)}`);
      }
      setText(speaker, speakerName(t, wizardId, state));
      setText(score, String(state.score));
      el.dataset.mode = state.mode;

      setText(
        heading,
        state.mode === 'adventure'
          ? (state.adventure?.title ?? t.getReady)
          : state.index >= 0
            ? state.prompt
            : t.getReady,
      );

      if (state.mode === 'adventure') {
        renderMeter(state);
        renderBag(state);
        renderTrail(state);
      }

      setSrc(wizard, wizardUrl(wizardId, state.mood));
      el.dataset.mood = state.mood;
      el.dataset.phase = state.phase;

      renderCards(state);
      renderVerdict(state);

      // While the player answers a quiz question, the question stays up; otherwise the latest
      // spoken line (the wizard's caption) is shown.
      const asking =
        state.mode === 'quiz' && (state.phase === 'listening' || state.phase === 'checking');
      setText(line, asking || !state.caption ? state.prompt || t.getReady : state.caption);

      const listening = state.phase === 'listening';
      setText(micState, listening ? t.micOn : t.micOff);
      level.classList.toggle('live', listening);
      showIcon(STATUS_ICON[state.phase] ?? 'speaker');
      setText(
        statusText,
        listening
          ? state.heardNothing > 0 && state.mode === 'quiz'
            ? t.heardNothing
            : t.speakNow
          : state.phase === 'checking'
            ? t.checking
            : state.phase === 'speaking'
              ? t.listenUp
              : '',
      );
    },
    setLevel(value) {
      meterFill.style.transform = `scaleX(${value.toFixed(2)})`;
    },
    setTimer(fraction, secondsLeft) {
      timer.hidden = fraction === null;
      if (fraction === null) return;
      timerFill.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction)).toFixed(3)})`;
      timer.classList.toggle('low', secondsLeft <= 3);
      setText(timerText, t.secondsLeft(secondsLeft));
    },
    setSoundBlocked(blocked) {
      unmute.hidden = !blocked;
    },
    destroy() {
      window.clearTimeout(toastTimer);
    },
  };
}
