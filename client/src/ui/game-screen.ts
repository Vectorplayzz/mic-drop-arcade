/** The in-game screen. It only displays what the server sent: score, streak, verdicts. */
import type { GameState, Phase } from '../game/machine';
import type { Strings } from '../i18n';
import type { LanguageCode } from '../protocol/messages';
import { button, clear, h, setText } from './dom';
import type { Screen } from './screens';
import { sprite, type SpriteName } from './sprites';

export interface GameScreen extends Screen {
  update(state: GameState): void;
  /** Mic loudness, 0..1. */
  setLevel(level: number): void;
  /** `fraction` of the answer time left (1 → 0); null hides the countdown. */
  setTimer(fraction: number | null, secondsLeft: number): void;
}

const STATUS_ICON: Partial<Record<Phase, SpriteName>> = {
  speaking: 'speaker',
  listening: 'mic',
  checking: 'dots',
};

export function gameScreen(t: Strings, language: LanguageCode, onQuit: () => void): GameScreen {
  const contentLang = language === 'hi-en' ? 'hi' : language;
  const score = h('span', { class: 'hud-value pixel', text: '0' });
  const streak = h('span', { class: 'hud-value pixel', text: '0' });
  const progress = h('span', { class: 'hud-value pixel', text: '' });
  const progressLabel = h('span', { class: 'sr-only' });

  const timerFill = h('div', { class: 'timer-fill' });
  const timer = h(
    'div',
    { class: 'timer', attrs: { role: 'timer', 'aria-live': 'off', hidden: true } },
    timerFill,
  );
  const timerText = h('span', { class: 'sr-only' });
  timer.append(timerText);

  const icon = h('div', { class: 'status-icon' });
  const statusText = h('p', { class: 'status-text', attrs: { role: 'status', 'aria-live': 'assertive' } });
  const meterFill = h('div', { class: 'meter-fill' });
  const meter = h('div', { class: 'meter', attrs: { 'aria-hidden': 'true' } }, meterFill);
  const micState = h('span', { class: 'sr-only', attrs: { role: 'status' } });

  const prompt = h('h1', { class: 'prompt', attrs: { tabindex: -1, lang: contentLang } });
  const verdict = h('div', { class: 'verdict', attrs: { 'aria-live': 'polite', hidden: true } });
  const caption = h('p', { class: 'caption', attrs: { 'aria-live': 'polite', lang: contentLang } });

  const el = h(
    'section',
    { class: 'screen game' },
    h(
      'header',
      { class: 'hud' },
      h('div', { class: 'hud-item' }, h('span', { class: 'hud-label', text: t.score }), score),
      h('div', { class: 'hud-item' }, h('span', { class: 'hud-label', text: t.streak }), streak),
      h('div', { class: 'hud-item' }, progress, progressLabel),
    ),
    timer,
    h('div', { class: 'status' }, icon, statusText, meter, micState),
    prompt,
    verdict,
    caption,
    button(t.quit, onQuit, { class: 'btn-small' }),
  );

  let shownIcon: SpriteName | null = null;
  let shownResult: unknown = null;

  const showIcon = (name: SpriteName): void => {
    if (shownIcon === name) return;
    shownIcon = name;
    icon.replaceChildren(sprite(name, 'sprite-status'));
  };

  const showVerdict = (state: GameState): void => {
    const result = state.result;
    if (result === shownResult) return;
    shownResult = result;
    clear(verdict);
    verdict.hidden = result === null;
    verdict.className = 'verdict';
    if (!result) return;
    if (result.skipped) {
      verdict.append(h('p', { class: 'verdict-title', text: t.skipped }));
      return;
    }
    verdict.classList.add(result.correct ? 'good' : 'bad');
    const title = result.correct ? t.correct : result.timed_out ? t.timeout : t.wrong;
    verdict.append(
      h(
        'p',
        { class: 'verdict-title' },
        h('span', { text: title }),
        result.points > 0 && h('span', { class: 'points pixel', text: ` ${t.points(result.points)}` }),
      ),
    );
    if (result.heard) {
      verdict.append(
        h(
          'p',
          { class: 'verdict-line' },
          h('span', { class: 'muted', text: `${t.youSaid}: ` }),
          h('span', { text: result.heard, attrs: { lang: contentLang } }),
        ),
      );
    }
    if (result.answer) {
      verdict.append(
        h(
          'p',
          { class: 'verdict-line' },
          h('span', { class: 'muted', text: `${t.answerIs}: ` }),
          h('strong', { text: result.answer, attrs: { lang: contentLang } }),
        ),
      );
    }
    if (result.explanation) {
      verdict.append(
        h('p', { class: 'verdict-line muted', text: result.explanation, attrs: { lang: contentLang } }),
      );
    }
  };

  return {
    el,
    focus: prompt,
    update(state) {
      setText(score, String(state.score));
      setText(streak, `x${state.streak}`);
      streak.classList.toggle('hot', state.streak >= 2);
      if (state.index >= 0) {
        setText(progress, `${state.index + 1}/${state.total}`);
        setText(progressLabel, t.questionOf(state.index + 1, state.total));
      }
      setText(prompt, state.index >= 0 ? state.prompt : t.getReady);

      el.dataset.phase = state.phase;
      const listening = state.phase === 'listening';
      setText(micState, listening ? t.micOn : t.micOff);
      meter.classList.toggle('live', listening);
      if (state.phase === 'result' && state.result && !state.result.skipped) {
        showIcon(state.result.correct ? 'check' : state.result.timed_out ? 'clock' : 'cross');
      } else {
        showIcon(STATUS_ICON[state.phase] ?? 'speaker');
      }
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
      // The question is its own caption; every other spoken line gets one here.
      setText(caption, state.caption === state.prompt && state.phase !== 'result' ? '' : state.caption);
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
  };
}
