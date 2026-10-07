/**
 * The in-game screen, laid out like a visual novel over the full-screen quest scene: the
 * player's wizard big on the left, the player's hero on the right, the three spoken choices
 * plus "something else" as a 2×2 grid top right, and a dark dialogue box along the bottom that
 * covers the characters' lower halves. It only displays what the server sent.
 */
import type { GameState, Phase } from '../game/machine';
import type { Strings } from '../i18n';
import type { Hero, LanguageCode, Mood, Wizard } from '../protocol/messages';
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
  /** The wizard the player picked; it narrates every quest. */
  wizard: Wizard;
  onQuit(): void;
  onUnmute(): void;
}

const STATUS_ICON: Partial<Record<Phase, SpriteName>> = {
  speaking: 'speaker',
  listening: 'mic',
  checking: 'dots',
};

const MOODS: readonly Mood[] = ['ask', 'happy', 'sad', 'cheer'];

/** Loose comparison for highlighting the right choice: case, spacing and Unicode form. */
const same = (a: string, b: string): boolean =>
  a.normalize('NFC').trim().toLocaleLowerCase() === b.normalize('NFC').trim().toLocaleLowerCase();

export function contentLang(language: LanguageCode): string {
  return language === 'hi-en' ? 'hi' : language === 'te-en' ? 'te' : language === 'en-IN' ? 'en' : language;
}

/**
 * The name on the dialogue box: the quest's own wizard name when the player's wizard is the
 * one the quest was written for, otherwise the picked wizard's title.
 */
export function speakerName(t: Strings, wizard: Wizard, state: GameState): string {
  if (state.story && state.story.sprite === wizard) return state.story.wizard;
  return t.wizardNames[wizard];
}

export function gameScreen(o: GameScreenOptions): GameScreen {
  const { t, wizard: wizardId } = o;
  const lang = contentLang(o.language);

  // --- HUD ---------------------------------------------------------------------------
  const score = h('span', { class: 'hud-value pixel', text: '0' });
  const streak = h('span', { class: 'hud-value pixel', text: '0' });
  const progress = h('span', { class: 'hud-value pixel', text: '' });
  const progressLabel = h('span', { class: 'sr-only' });
  const unmute = h('button', {
    class: 'btn btn-small sound-chip',
    text: t.soundOff,
    attrs: { type: 'button', hidden: true },
    on: { click: () => o.onUnmute() },
  });

  const questName = h('span', { class: 'quest-name' });
  const questCount = h('span', { class: 'quest-count pixel' });
  const questFill = h('div', { class: 'quest-fill' });
  const quest = h(
    'div',
    { class: 'quest', attrs: { hidden: true } },
    h('div', { class: 'quest-head' }, questName, questCount),
    h('div', { class: 'quest-bar', attrs: { 'aria-hidden': 'true' } }, questFill),
  );

  const timerFill = h('div', { class: 'timer-fill' });
  const timerText = h('span', { class: 'sr-only' });
  const timer = h(
    'div',
    { class: 'timer', attrs: { role: 'timer', 'aria-live': 'off', hidden: true } },
    timerFill,
    timerText,
  );

  // --- characters and choices ---------------------------------------------------------
  const wizard = artImage(wizardUrl(wizardId, 'ask'), 'stage-wizard');
  const hero = artImage(heroUrl('arjun'), 'stage-hero');
  const heroLabel = h('span', { class: 'sr-only' });
  preload(MOODS.map((mood) => wizardUrl(wizardId, mood)));

  const choiceItems = [0, 1, 2].map((i) =>
    h(
      'li',
      { class: 'choice' },
      h('span', { class: 'choice-key pixel', text: String(i + 1) }),
      h('span', { class: 'choice-text', attrs: { lang } }),
    ),
  );
  const otherItem = h(
    'li',
    { class: 'choice choice-other' },
    h('span', { class: 'choice-key pixel', text: '?' }),
    h('span', { class: 'choice-text', text: t.otherAnswer }),
  );
  const choices = h(
    'ol',
    { class: 'choices', attrs: { 'aria-label': t.optionsHint, hidden: true } },
    ...choiceItems,
    otherItem,
  );
  const play = h('div', { class: 'play' }, wizard, hero, heroLabel, choices);

  // --- dialogue box --------------------------------------------------------------------
  const speaker = h('p', { class: 'dialogue-name pixel' });
  const line = h('p', { class: 'dialogue-text', attrs: { 'aria-live': 'polite', lang } });
  const icon = h('div', { class: 'status-icon' });
  const statusText = h('p', { class: 'status-text', attrs: { role: 'status', 'aria-live': 'assertive' } });
  const meterFill = h('div', { class: 'meter-fill' });
  const meter = h('div', { class: 'meter', attrs: { 'aria-hidden': 'true' } }, meterFill);
  const micState = h('span', { class: 'sr-only', attrs: { role: 'status' } });
  const verdict = h('div', { class: 'verdict', attrs: { 'aria-live': 'polite', hidden: true } });
  const status = h('div', { class: 'dialogue-status' }, icon, statusText, meter, micState);
  const dialogue = h('div', { class: 'dialogue' }, speaker, line, status, verdict);

  const prompt = h('h1', { class: 'sr-only', attrs: { tabindex: -1, lang } });

  const el = h(
    'section',
    { class: 'screen game' },
    h(
      'header',
      { class: 'hud' },
      h('div', { class: 'hud-item' }, h('span', { class: 'hud-label', text: t.score }), score),
      h('div', { class: 'hud-item' }, h('span', { class: 'hud-label', text: t.streak }), streak),
      h('div', { class: 'hud-item' }, progress, progressLabel),
      button(t.quit, o.onQuit, { class: 'btn-small hud-quit' }),
    ),
    unmute,
    quest,
    timer,
    prompt,
    play,
    dialogue,
  );

  let shownIcon: SpriteName | null = null;
  let shownResult: unknown = null;
  let shownOptions: string[] | null | undefined;
  let setUp = false;

  const showIcon = (name: SpriteName): void => {
    if (shownIcon === name) return;
    shownIcon = name;
    icon.replaceChildren(sprite(name, 'sprite-status'));
  };

  const setSrc = (img: HTMLImageElement, src: string): void => {
    if (img.getAttribute('src') !== src) img.src = src;
  };

  const setUpGame = (state: GameState): void => {
    setSrc(hero, heroUrl(state.hero as Hero));
    setText(heroLabel, `${t.yourHero}: ${heroName(state.hero)}`);
    setText(speaker, speakerName(t, wizardId, state));
    quest.hidden = state.story === null;
    setUp = true;
  };

  const showChoices = (state: GameState): void => {
    if (state.options === shownOptions) return;
    shownOptions = state.options;
    choices.hidden = state.options === null;
    state.options?.forEach((option, i) => {
      const item = choiceItems[i];
      if (!item) return;
      setText(item.querySelector('.choice-text')!, option);
    });
  };

  /** After the verdict, light up the right choice so a wrong guess still teaches something. */
  const markChoices = (state: GameState): void => {
    const result = state.phase === 'result' ? state.result : null;
    const options = state.options ?? [];
    choiceItems.forEach((item, i) => {
      const option = options[i];
      const right = Boolean(result && !result.skipped && option && same(option, result.answer));
      item.classList.toggle('right', right);
      item.classList.toggle('dim', Boolean(result && !result.skipped && !right));
    });
    otherItem.classList.toggle('dim', Boolean(result && !result.skipped));
  };

  const showVerdict = (state: GameState): void => {
    const result = state.phase === 'result' ? state.result : null;
    if (result === shownResult) return;
    shownResult = result;
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
          h('span', { text: result.heard, attrs: { lang } }),
        ),
      );
    }
  };

  return {
    el,
    focus: prompt,
    update(state) {
      if (!setUp) setUpGame(state);
      setText(score, String(state.score));
      setText(streak, `x${state.streak}`);
      streak.classList.toggle('hot', state.streak >= 2);
      if (state.index >= 0) {
        setText(progress, `${state.index + 1}/${state.total}`);
        setText(progressLabel, t.questionOf(state.index + 1, state.total));
      }
      setText(prompt, state.index >= 0 ? state.prompt : t.getReady);

      if (state.story) {
        const done = Math.min(state.chaptersDone, state.story.chapters);
        setText(questName, speakerName(t, wizardId, state));
        setText(questCount, t.questProgress(done, state.story.chapters));
        questFill.style.transform = `scaleX(${(state.story.chapters ? done / state.story.chapters : 0).toFixed(3)})`;
      }

      setSrc(wizard, wizardUrl(wizardId, state.mood));
      el.dataset.mood = state.mood;
      el.dataset.phase = state.phase;
      play.classList.toggle('has-choices', state.options !== null);

      showChoices(state);
      markChoices(state);

      // While the player answers, the question stays up; otherwise show the latest spoken line.
      const asking = state.phase === 'listening' || state.phase === 'checking';
      setText(line, asking || !state.caption ? state.prompt || t.getReady : state.caption);

      const listening = state.phase === 'listening';
      setText(micState, listening ? t.micOn : t.micOff);
      meter.classList.toggle('live', listening);
      showIcon(STATUS_ICON[state.phase] ?? 'speaker');
      setText(
        statusText,
        listening
          ? state.heardNothing > 0
            ? t.heardNothing
            : t.speakNow
          : state.phase === 'checking'
            ? t.checking
            : state.phase === 'speaking'
              ? t.listenUp
              : '',
      );
      showVerdict(state);
    },
    setLevel(level) {
      meterFill.style.transform = `scaleX(${level.toFixed(2)})`;
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
  };
}
