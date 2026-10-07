/**
 * The app controller: owns the session, the socket, the audio graph and the current screen, and
 * runs every server message through the game state machine.
 */
import { MicCapture, MicError, micSupported } from './audio/mic';
import { VoicePlayer } from './audio/player';
import { Sfx } from './audio/sfx';
import {
  type Effect,
  type GameEvent,
  type GameState,
  gamesLeft,
  inGame,
  initialState,
  reduce,
} from './game/machine';
import { type ProblemCode, type Strings, stringsFor } from './i18n';
import {
  ApiError,
  createSession,
  getLeaderboard,
  getPacks,
  getStatus,
  nicknameProblem,
  type Period,
  postScore,
  type Session,
  type Status,
} from './net/api';
import { GameSocket } from './net/socket';
import { runTurnstile, TurnstileError } from './net/turnstile';
import { loadPrefs, type Prefs, savePrefs } from './prefs';
import { CLOSE, type LanguageCode, type PackSummary } from './protocol/messages';
import { shareScoreCard } from './share/card';
import { creatorScreen } from './ui/creator-screen';
import { privacyDialog, settingsDialog } from './ui/dialogs';
import { type GameScreen, gameScreen } from './ui/game-screen';
import {
  boardScreen,
  gateScreen,
  loadingScreen,
  type LobbyScreen,
  lobbyScreen,
  type OverScreen,
  overScreen,
  type ProblemScreen,
  problemScreen,
  type Screen,
  titleScreen,
} from './ui/screens';
import { MENU_SCENE, setScene } from './ui/scene';
import type { SpriteName } from './ui/sprites';

/** Don't reuse a session token this close to its expiry. */
const SESSION_MARGIN_S = 60;
/** After the browser reports "offline" mid-game, wait this long before giving up on the socket. */
const OFFLINE_GRACE_MS = 5000;

const PROBLEM_ICONS: Partial<Record<ProblemCode, SpriteName>> = {
  offline: 'plug',
  connection_lost: 'plug',
  closed_for_today: 'clock',
  maintenance: 'clock',
  rate_limited: 'clock',
  idle: 'clock',
  busy: 'clock',
  mic_denied: 'mic',
  mic_missing: 'mic',
  mic_busy: 'mic',
  mic_lost: 'mic',
};

const CLOSE_PROBLEMS: Record<number, ProblemCode> = {
  [CLOSE.protocol]: 'protocol',
  [CLOSE.auth]: 'unauthorized',
  [CLOSE.origin]: 'forbidden_origin',
  [CLOSE.idle]: 'idle',
  [CLOSE.duplicate]: 'already_connected',
  [CLOSE.limit]: 'rate_limited',
  [CLOSE.closedForToday]: 'closed_for_today',
  1011: 'internal',
  1012: 'unavailable',
  1013: 'unavailable',
};

function micProblem(err: unknown): ProblemCode {
  const reason = err instanceof MicError ? err.reason : 'busy';
  return reason === 'unsupported' ? 'unsupported' : `mic_${reason}`;
}

export class App {
  private prefs: Prefs = loadPrefs();
  private status: Status | null = null;
  private language: LanguageCode = 'hi-en';
  private t: Strings = stringsFor('hi-en');

  private ctx: AudioContext | null = null;
  private player: VoicePlayer | null = null;
  private mic: MicCapture | null = null;
  private sfx: Sfx | null = null;

  private session: Session | null = null;
  private readonly socket: GameSocket;
  private game: GameState = initialState();
  /** Score token already on the leaderboard, so going back to the score screen shows that. */
  private submitted: string | null = null;

  private screen: Screen | null = null;
  private gameView: GameScreen | null = null;
  private lobbyView: LobbyScreen | null = null;
  private overView: OverScreen | null = null;
  /** Bumped whenever the flow moves on, so late async results can tell they are stale. */
  private flow = 0;

  private timerRun = 0;
  private timerRaf = 0;
  private offlineTimer = 0;
  private retryTimer = 0;

  constructor(private readonly root: HTMLElement) {
    this.socket = new GameSocket({
      onMessage: (message) => this.dispatch({ type: 'message', message }),
      onAudio: (frame) => this.player?.push(frame),
      onClose: (code) => this.dispatch({ type: 'closed', code }),
    });
    window.addEventListener('offline', () => this.onOffline());
    window.addEventListener('online', () => window.clearTimeout(this.offlineTimer));
    window.addEventListener('pagehide', () => this.socket.close());
    // Mobile browsers suspend audio when the tab is backgrounded; any tap brings it back.
    document.addEventListener('pointerdown', () => void this.ctx?.resume(), { capture: true });
  }

  // ---------------------------------------------------------------- boot and menus ---
  async boot(): Promise<void> {
    const flow = ++this.flow;
    this.setLanguage(this.prefs.language ?? 'hi-en');
    this.show(loadingScreen(this.t.loading));
    let status: Status;
    try {
      status = await getStatus();
    } catch (err) {
      if (flow === this.flow) this.showApiProblem(err, () => void this.boot());
      return;
    }
    if (flow !== this.flow) return;
    this.status = status;
    const offered = status.languages.map((l) => l.code);
    if (offered.length > 0 && !offered.includes(this.language)) this.setLanguage(offered[0]!);
    if (!status.open) {
      this.showProblem(status.reason ?? 'closed_for_today', { retry: () => void this.boot() });
      return;
    }
    this.showTitle();
  }

  private setLanguage(language: LanguageCode): void {
    this.language = language;
    this.t = stringsFor(language);
    document.documentElement.lang = this.t.htmlLang;
  }

  private chooseLanguage(language: LanguageCode): void {
    this.setLanguage(language);
    this.prefs.language = language;
    savePrefs(this.prefs);
  }

  private showTitle(): void {
    this.flow++;
    const status = this.status;
    if (!status) {
      void this.boot();
      return;
    }
    this.sfx?.startMusic();
    this.show(
      titleScreen({
        t: this.t,
        languages: status.languages,
        language: this.language,
        onLanguage: (code) => {
          this.chooseLanguage(code);
          this.ensureAudio();
          this.sfx?.play('select');
          this.showTitle();
        },
        onStart: () => void this.start(),
        onBoard: () => this.showBoard(this.language, 'today'),
        onCreator: () => this.showCreator(),
        onSettings: () => this.showSettings(),
        onPrivacy: () => privacyDialog(this.t),
      }),
    );
  }

  private showSettings(): void {
    settingsDialog({
      t: this.t,
      prefs: this.prefs,
      languages: this.status?.languages ?? [],
      language: this.language,
      onChange: (prefs, language) => {
        this.prefs = { ...prefs, language };
        savePrefs(this.prefs);
        this.player?.setVolume(prefs.voiceVolume);
        this.sfx?.configure(prefs);
        if (prefs.music) {
          this.ensureAudio();
          this.sfx?.startMusic();
        }
        if (language !== this.language) {
          this.setLanguage(language);
          this.showTitle();
        }
      },
    });
  }

  private showCreator(): void {
    this.flow++;
    this.show(
      creatorScreen({
        languages: this.status?.languages ?? [],
        language: this.language,
        backLabel: this.t.back,
        onBack: () => this.showTitle(),
      }),
    );
  }

  private showBoard(language: LanguageCode, period: Period): void {
    const flow = ++this.flow;
    const view = boardScreen({
      t: this.t,
      languages: this.status?.languages ?? [],
      language,
      period,
      onChange: (nextLanguage, nextPeriod) => this.showBoard(nextLanguage, nextPeriod),
      onBack: () => (this.game.phase === 'over' ? this.showOver() : this.showTitle()),
    });
    view.setEntries('loading');
    this.show(view);
    getLeaderboard(language, period).then(
      (entries) => flow === this.flow && view.setEntries(entries),
      () => flow === this.flow && view.setEntries('failed'),
    );
  }

  // ---------------------------------------------------------------- starting a session
  /** Runs inside the Start tap: iOS only lets audio and the mic prompt begin from a gesture. */
  private async start(): Promise<void> {
    const flow = ++this.flow;
    if (!micSupported() || typeof WebSocket !== 'function') {
      this.showProblem('unsupported', {});
      return;
    }
    const { mic, sfx } = this.ensureAudio();
    sfx.stopMusic();
    sfx.play('start');
    const gate = gateScreen(this.t, () => this.goHome());
    this.show(gate);
    try {
      await mic.open();
      if (flow !== this.flow) return;
      if (!this.sessionUsable()) {
        const token = await runTurnstile(gate.widget);
        if (flow !== this.flow) return;
        gate.setConnecting();
        this.session = await createSession(token);
        if (flow !== this.flow) return;
      }
    } catch (err) {
      if (flow !== this.flow) return;
      mic.close();
      if (err instanceof MicError) {
        this.showProblem(micProblem(err), { retry: () => void this.start() });
      } else if (err instanceof TurnstileError) {
        const code = err.reason === 'load' ? 'bot_check_unreachable' : 'bot_check_failed';
        this.showProblem(navigator.onLine ? code : 'offline', { retry: () => void this.start() });
      } else {
        this.showApiProblem(err, () => void this.start());
      }
      return;
    }
    gate.setConnecting();
    this.game = initialState();
    this.socket.connect(this.session!.token);
  }

  private soundBlocked(): boolean {
    return this.ctx !== null && this.ctx.state !== 'running';
  }

  /** Runs from a tap (or right before a line): the only moment browsers allow audio back. */
  private unmute(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.resume().then(
      () => this.gameView?.setSoundBlocked(this.soundBlocked()),
      () => this.gameView?.setSoundBlocked(true),
    );
  }

  private sessionUsable(): boolean {
    return this.session !== null && this.session.expiresAt - Date.now() / 1000 > SESSION_MARGIN_S;
  }

  private ensureAudio(): { ctx: AudioContext; mic: MicCapture; sfx: Sfx } {
    if (!this.ctx || !this.mic || !this.sfx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      ctx.addEventListener('statechange', () => this.gameView?.setSoundBlocked(this.soundBlocked()));
      this.player = new VoicePlayer(ctx, this.prefs.voiceVolume);
      this.sfx = new Sfx(ctx);
      this.sfx.configure(this.prefs);
      const mic = new MicCapture(ctx);
      mic.onFrame = (frame) => this.socket.sendAudio(frame);
      mic.onLevel = (level) => this.gameView?.setLevel(level);
      mic.onLost = () => {
        if (inGame(this.game)) this.endSession('mic_lost');
      };
      this.mic = mic;
    }
    void this.ctx.resume();
    return { ctx: this.ctx, mic: this.mic, sfx: this.sfx };
  }

  // ---------------------------------------------------------------- game loop --------
  private dispatch(event: GameEvent): void {
    const before = this.game;
    const { state, effects } = reduce(before, event);
    this.game = state;
    for (const effect of effects) this.run(effect);

    if (state.phase === 'closed') {
      if (before.phase !== 'closed') this.onClosed(before, state);
      return;
    }
    if (event.type === 'message' && event.message.type === 'ready') {
      void this.showLobby();
    } else if (state.phase === 'speaking' && !inGame(before)) {
      this.gameView = gameScreen({
        t: this.t,
        language: state.pack?.language ?? this.language,
        wizard: this.prefs.wizard,
        onQuit: () => this.goHome(),
        onUnmute: () => this.unmute(),
      });
      this.show(this.gameView);
      setScene(state.story?.scene ?? MENU_SCENE, 'game');
      this.gameView.setSoundBlocked(this.soundBlocked());
    } else if (state.phase === 'over' && before.phase !== 'over') {
      this.showOver();
    } else if (state.phase === 'lobby' && before.phase === 'starting' && state.error) {
      // A refused start (busy, unknown pack): back to the pack list with the reason.
      const notice = this.problemText(state.error.code).body;
      if (this.lobbyView && this.screen === this.lobbyView) {
        this.lobbyView.setBusy(false);
        this.lobbyView.setNotice(notice);
      } else {
        void this.showLobby().then(() => this.lobbyView?.setNotice(notice));
      }
    }
    if (inGame(state)) this.gameView?.update(state);
  }

  private run(effect: Effect): void {
    switch (effect.type) {
      case 'voice_start':
        // Browsers can suspend or interrupt audio (tab in background, a headset switching
        // to its call profile when the mic opens). Ask for it back before every line.
        if (this.soundBlocked()) this.unmute();
        this.player?.speakStart(effect.utterance, effect.sampleRate);
        break;
      case 'voice_end':
        this.player?.speakEnd(effect.utterance);
        break;
      case 'voice_cut':
        this.player?.bargeIn(effect.utterance);
        break;
      case 'voice_stop':
        this.player?.stopAll();
        break;
      case 'mic':
        this.mic?.setStreaming(effect.on);
        break;
      case 'mic_release':
        this.mic?.close();
        break;
      case 'timer_start':
        this.armTimer(effect.seconds, effect.after);
        break;
      case 'timer_stop':
        this.stopTimer();
        break;
      case 'sfx':
        this.sfx?.play(effect.name);
        break;
    }
  }

  /** The countdown is for show: the server's clock decides (PROTOCOL §6). */
  private armTimer(seconds: number, after: number | null): void {
    this.stopTimer();
    const run = this.timerRun;
    const begin = (): void => {
      if (run !== this.timerRun) return;
      const startedAt = performance.now();
      const tick = (): void => {
        if (run !== this.timerRun) return;
        const left = Math.max(0, seconds - (performance.now() - startedAt) / 1000);
        this.gameView?.setTimer(seconds > 0 ? left / seconds : 0, Math.ceil(left));
        if (left > 0) this.timerRaf = requestAnimationFrame(tick);
      };
      tick();
    };
    if (after === null || !this.player) begin();
    else this.player.afterUtterance(after, begin);
  }

  private stopTimer(): void {
    this.timerRun++;
    cancelAnimationFrame(this.timerRaf);
    this.gameView?.setTimer(null, 0);
  }

  private async showLobby(): Promise<void> {
    const flow = ++this.flow;
    const view = lobbyScreen(
      this.t,
      gamesLeft(this.game),
      this.prefs.hero,
      (hero) => {
        this.prefs.hero = hero;
        savePrefs(this.prefs);
        this.sfx?.play('select');
      },
      this.prefs.wizard,
      (wizard) => {
        this.prefs.wizard = wizard;
        savePrefs(this.prefs);
        this.sfx?.play('select');
      },
      (pack) => this.startGame(pack),
      () => this.goHome(),
    );
    this.lobbyView = view;
    this.show(view);
    try {
      const packs = await getPacks(this.language);
      if (flow === this.flow) view.setPacks(packs);
    } catch (err) {
      if (flow === this.flow) this.showApiProblem(err, () => void this.start());
    }
  }

  private startGame(pack: PackSummary): void {
    if (!this.socket.isOpen) return;
    const { mic } = this.ensureAudio();
    this.lobbyView?.setBusy(true);
    this.lobbyView?.setNotice('');
    // The mic was released at the end of the last game; permission is already granted.
    mic.open().then(
      () => {
        if (this.game.phase !== 'lobby' && this.game.phase !== 'over') return;
        this.dispatch({ type: 'start_requested' });
        this.socket.startGame(pack.id, this.prefs.hero, this.prefs.wizard);
      },
      (err: unknown) => this.endSession(micProblem(err)),
    );
  }

  // ---------------------------------------------------------------- game over --------
  private showOver(): void {
    this.flow++;
    const final = this.game.final;
    if (!final) return;
    const pack = this.game.pack;
    const view = overScreen({
      t: this.t,
      final,
      ending: this.game.ending,
      canPlayAgain: this.socket.isOpen && gamesLeft(this.game) > 0 && pack !== null,
      onSubmit: (nickname) => void this.submitScore(view, final.score_token, nickname),
      onShare: () => {
        const language =
          this.status?.languages.find((l) => l.code === pack?.language)?.label ??
          this.t.shareLanguage;
        shareScoreCard({
          correct: final.correct,
          questions: final.questions,
          score: final.score,
          maxScore: final.max_score,
          line: this.t.shareLine(final.correct, final.questions, language),
          packTitle: pack?.title ?? '',
          hero: final.hero,
          url: location.origin,
        }).then(
          (how) => view.setShareStatus(how === 'downloaded' ? this.t.shareSaved : ''),
          () => view.setShareStatus(this.t.problems.internal.title),
        );
      },
      onPlayAgain: () => {
        if (pack) this.startGame(pack);
      },
      onBoard: () => this.showBoard(pack?.language ?? this.language, 'today'),
      onHome: () => this.goHome(),
    });
    if (this.submitted === final.score_token) view.setSubmitState('done', this.t.submitted);
    this.overView = view;
    this.show(view);
  }

  private async submitScore(view: OverScreen, scoreToken: string, nickname: string): Promise<void> {
    const problem = nicknameProblem(nickname);
    if (problem) {
      const text = {
        length: this.t.nickLength,
        characters: this.t.nickCharacters,
        letter: this.t.nickLetter,
      };
      view.setSubmitState('idle', text[problem]);
      return;
    }
    view.setSubmitState('sending');
    try {
      await postScore(scoreToken, nickname.trim());
      this.submitted = scoreToken;
      view.setSubmitState('done', this.t.submitted);
    } catch (err) {
      const api = err instanceof ApiError ? err : new ApiError(0, 'offline');
      if (api.status === 409) {
        this.submitted = scoreToken;
        view.setSubmitState('locked', this.t.alreadySubmitted);
      } else if (api.status === 401) {
        view.setSubmitState('locked', this.t.scoreExpired);
      } else if (api.status === 422) {
        view.setSubmitState('idle', this.t.nickRejected);
      } else if (api.status === 429) {
        view.setSubmitState('idle', this.t.rateLimited(api.retryAfterS ?? 60));
      } else {
        const code = api.code === 'offline' ? 'offline' : 'unavailable';
        view.setSubmitState('idle', this.t.problems[code].body);
      }
    }
  }

  // ---------------------------------------------------------------- endings ----------
  /** Leave whatever is going on and return to the title screen. The session stays usable. */
  private goHome(): void {
    this.teardown();
    this.showTitle();
  }

  private endSession(code: ProblemCode): void {
    this.teardown();
    this.showProblem(code, { retry: () => void this.start() });
  }

  private teardown(): void {
    this.flow++;
    this.socket.close();
    this.stopTimer();
    this.player?.stopAll();
    this.mic?.close();
    this.game = initialState();
    this.gameView = null;
    this.lobbyView = null;
    this.overView = null;
  }

  private onClosed(before: GameState, state: GameState): void {
    window.clearTimeout(this.offlineTimer);
    const error = state.error?.fatal ? state.error : null;
    if (error?.code === 'unauthorized' || error?.code === 'session_limit') this.session = null;
    // The score screen doesn't need the socket (the server closes idle ones after two minutes):
    // the player keeps their score and nickname form, and only "play again" goes away.
    if (before.phase === 'over') {
      this.game = before;
      this.overView?.endPlayAgain();
      return;
    }
    this.gameView = null;
    this.lobbyView = null;
    let code: ProblemCode;
    if (error) code = error.code;
    else if (!navigator.onLine) code = inGame(before) ? 'connection_lost' : 'offline';
    else {
      code =
        CLOSE_PROBLEMS[state.closeCode ?? 0] ??
        (inGame(before) ? 'connection_lost' : 'unavailable');
    }
    if (code === 'unauthorized') this.session = null;
    this.game = initialState();
    const terminal = code === 'closed_for_today' || code === 'audio_limit';
    this.showProblem(code, {
      detail: error?.message,
      retry: terminal ? () => void this.boot() : () => void this.start(),
    });
  }

  private onOffline(): void {
    window.clearTimeout(this.offlineTimer);
    if (!this.socket.isOpen) return;
    // A dead mobile connection can take a minute to close the socket by itself.
    this.offlineTimer = window.setTimeout(() => {
      if (navigator.onLine || !this.socket.isOpen) return;
      this.socket.close();
      this.dispatch({ type: 'closed', code: 1006 });
    }, OFFLINE_GRACE_MS);
  }

  // ---------------------------------------------------------------- problems ---------
  private problemText(code: string): { title: string; body: string } {
    const problems: Record<string, { title: string; body: string }> = this.t.problems;
    return problems[code] ?? this.t.problems.internal;
  }

  private showProblem(
    code: ProblemCode,
    options: { detail?: string; retry?: () => void; retryAfterS?: number | null },
  ): ProblemScreen {
    this.flow++;
    window.clearInterval(this.retryTimer);
    const { title, body } = this.problemText(code);
    const actions: Array<{ label: string; primary?: boolean; run(): void }> = [];
    if (options.retry) actions.push({ label: this.t.retry, primary: true, run: options.retry });
    else actions.push({ label: this.t.reload, primary: true, run: () => location.reload() });
    if (this.status?.open) actions.push({ label: this.t.home, run: () => this.goHome() });
    const view = problemScreen({
      icon: PROBLEM_ICONS[code] ?? 'cross',
      title,
      body,
      detail: options.detail,
      actions,
    });
    if (code === 'rate_limited') {
      let left = options.retryAfterS ?? 60;
      view.setDetail(this.t.rateLimited(left));
      this.retryTimer = window.setInterval(() => {
        left = Math.max(0, left - 1);
        view.setDetail(left > 0 ? this.t.rateLimited(left) : '');
        if (left === 0) window.clearInterval(this.retryTimer);
      }, 1000);
    }
    this.show(view);
    return view;
  }

  private showApiProblem(err: unknown, retry: () => void): void {
    const api = err instanceof ApiError ? err : new ApiError(0, 'internal');
    const known: Record<string, ProblemCode> = {
      offline: navigator.onLine ? 'unavailable' : 'offline',
      bot_check_failed: 'bot_check_failed',
      forbidden_origin: 'forbidden_origin',
      rate_limited: 'rate_limited',
      closed_for_today: 'closed_for_today',
    };
    const code = known[api.code] ?? (api.status === 429 ? 'rate_limited' : 'unavailable');
    // "Closed" may really be maintenance: the status endpoint knows which.
    const again = code === 'closed_for_today' ? () => void this.boot() : retry;
    this.teardownQuietly();
    this.showProblem(code, { retry: again, retryAfterS: api.retryAfterS });
  }

  private teardownQuietly(): void {
    this.socket.close();
    this.mic?.close();
    this.player?.stopAll();
  }

  // ---------------------------------------------------------------- rendering --------
  private show(screen: Screen): void {
    if (screen !== this.gameView) setScene(MENU_SCENE, 'menu');
    this.screen?.destroy?.();
    this.screen = screen;
    this.root.replaceChildren(screen.el);
    window.scrollTo(0, 0);
    screen.focus?.focus({ preventScroll: true });
  }
}
