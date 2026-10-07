/**
 * A stand-in for the game server, for working on the client without Redis, Postgres or a Gnani
 * key: `npm run dev:mock`. It speaks docs/PROTOCOL.md closely enough to drive every screen, but
 * it is not the server: "speech" is a synthesised tone, and since nothing here can recognise an
 * answer, any spoken reply is marked right on odd questions and wrong on even ones.
 *
 * Development only. It is never part of the production build.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Connect } from 'vite';
import { type WebSocket, WebSocketServer } from 'ws';

const PROTOCOL = 'maata.v1';
const VOICE_RATE = 24000;
const MIC_RATE = 16000;
const TIME_LIMIT_S = 12;
const GRACE_S = 1;
const MAX_GAMES = 5;
const QUESTIONS_PER_GAME = 5;

interface MockQuestion {
  prompt: string;
  answer: string;
  kind: 'text' | 'number';
  explanation?: string;
}
interface MockPack {
  id: string;
  title: string;
  language: 'te-IN' | 'hi-IN' | 'hi-en';
  topic: string;
  questions: MockQuestion[];
}

const PACKS: MockPack[] = [
  {
    id: 'te-mock-01',
    title: 'సాధారణ జ్ఞానం',
    language: 'te-IN',
    topic: 'mock pack',
    questions: [
      { prompt: 'భారతదేశ రాజధాని ఏది?', answer: 'ఢిల్లీ', kind: 'text' },
      { prompt: 'ఒక వారంలో ఎన్ని రోజులు?', answer: 'ఏడు', kind: 'number' },
      { prompt: 'సూర్యుడు ఏ దిక్కున ఉదయిస్తాడు?', answer: 'తూర్పు', kind: 'text' },
      { prompt: 'ఇంద్రధనుస్సులో ఎన్ని రంగులు?', answer: 'ఏడు', kind: 'number' },
      { prompt: 'నీటి రసాయన సూత్రం ఏమిటి?', answer: 'H₂O', kind: 'text', explanation: 'రెండు హైడ్రోజన్, ఒక ఆక్సిజన్.' },
    ],
  },
  {
    id: 'hi-mock-01',
    title: 'सामान्य ज्ञान',
    language: 'hi-IN',
    topic: 'mock pack',
    questions: [
      { prompt: 'भारत की राजधानी क्या है?', answer: 'नई दिल्ली', kind: 'text' },
      { prompt: 'एक हफ़्ते में कितने दिन होते हैं?', answer: 'सात', kind: 'number' },
      { prompt: 'सूरज किस दिशा में उगता है?', answer: 'पूर्व', kind: 'text' },
      { prompt: 'इंद्रधनुष में कितने रंग होते हैं?', answer: 'सात', kind: 'number' },
      { prompt: 'पानी का रासायनिक सूत्र क्या है?', answer: 'H₂O', kind: 'text', explanation: 'दो हाइड्रोजन, एक ऑक्सीजन।' },
    ],
  },
  {
    id: 'hinglish-mock-01',
    title: 'General Gyaan',
    language: 'hi-en',
    topic: 'mock pack',
    questions: [
      { prompt: 'India की capital क्या है?', answer: 'New Delhi', kind: 'text' },
      { prompt: 'एक week में कितने days होते हैं?', answer: 'Seven', kind: 'number' },
      { prompt: 'Sun किस direction में उगता है?', answer: 'East', kind: 'text' },
      { prompt: 'Rainbow में कितने colours होते हैं?', answer: 'Seven', kind: 'number' },
      { prompt: 'Water का chemical formula क्या है?', answer: 'H₂O', kind: 'text', explanation: 'Two hydrogen, one oxygen.' },
    ],
  },
];

const LINES = {
  intro: 'Mock server: welcome to Maata Arcade!',
  correct: 'Correct!',
  wrong: 'Wrong answer.',
  timeout: 'Time up!',
  answerWas: (answer: string) => `The answer was ${answer}.`,
  gameOver: 'Game over!',
};

interface Score {
  nickname: string;
  score: number;
  correct: number;
  questions: number;
  language: string;
}
const scores: Score[] = [
  { nickname: 'PixelPanda', score: 610, correct: 4, questions: 5, language: 'te-IN' },
  { nickname: 'చిలక_07', score: 480, correct: 3, questions: 5, language: 'te-IN' },
  { nickname: 'तोता-राजा', score: 520, correct: 4, questions: 5, language: 'hi-IN' },
  { nickname: 'QuizWizard', score: 700, correct: 5, questions: 5, language: 'hi-en' },
];
const scoreTokens = new Map<string, Omit<Score, 'nickname'>>();

const summary = (p: MockPack) => ({
  id: p.id,
  title: p.title,
  language: p.language,
  topic: p.topic,
  questions: p.questions.length,
});

function maxScore(n: number): number {
  let total = 0;
  for (let i = 1; i <= n; i++) total += 150 + Math.min(50, 10 * (i - 1));
  return total;
}

// ---------------------------------------------------------------- HTTP ---------------
function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const api: Connect.NextHandleFunction = (req, res, next) => {
  const url = new URL(req.url ?? '/', 'http://mock.local');
  if (!url.pathname.startsWith('/api/')) return next();
  const route = `${req.method} ${url.pathname}`;
  void (async () => {
    switch (route) {
      case 'GET /api/status':
        return json(res, 200, {
          open: true,
          reason: null,
          languages: [
            { code: 'te-IN', label: 'తెలుగు' },
            { code: 'hi-IN', label: 'हिन्दी' },
            { code: 'hi-en', label: 'Hinglish' },
          ],
        });
      case 'GET /api/packs': {
        const language = url.searchParams.get('language');
        return json(res, 200, {
          packs: PACKS.filter((p) => !language || p.language === language).map(summary),
        });
      }
      case 'POST /api/session': {
        const body = await readBody(req);
        if (!req.headers.origin) return json(res, 403, { detail: 'forbidden_origin' });
        if (typeof body.turnstile_token !== 'string' || !body.turnstile_token) {
          return json(res, 403, { detail: 'bot_check_failed' });
        }
        return json(res, 200, {
          token: `mock-session-${Date.now()}`,
          expires_at: Math.floor(Date.now() / 1000) + 1800,
        });
      }
      case 'POST /api/scores': {
        const body = await readBody(req);
        const token = typeof body.score_token === 'string' ? body.score_token : '';
        const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
        const claim = scoreTokens.get(token);
        if (!token.startsWith('mock-score-')) return json(res, 401, { detail: 'invalid_score_token' });
        if (!claim) return json(res, 409, { detail: 'already_submitted' });
        if ([...nickname].length < 3 || [...nickname].length > 16 || /admin|gnani/i.test(nickname)) {
          return json(res, 422, { detail: 'please choose a different nickname' });
        }
        scoreTokens.delete(token);
        scores.push({ nickname, ...claim });
        return json(res, 200, { ok: true });
      }
      case 'GET /api/leaderboard': {
        const language = url.searchParams.get('language');
        const entries = scores
          .filter((s) => s.language === language)
          .sort((a, b) => b.score - a.score)
          .slice(0, 20)
          .map((s, i) => ({
            rank: i + 1,
            nickname: s.nickname,
            score: s.score,
            correct: s.correct,
            questions: s.questions,
          }));
        return json(res, 200, { language, period: url.searchParams.get('period'), entries });
      }
      default:
        return json(res, 404, { detail: 'Not Found' });
    }
  })();
};

// ---------------------------------------------------------------- voice --------------
/** A wobbling tone about as long as the caption would take to say. */
function fakeSpeech(text: string): Buffer {
  const seconds = Math.max(0.7, Math.min(3.5, [...text].length * 0.06));
  const samples = Math.floor(seconds * VOICE_RATE);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / VOICE_RATE;
    const syllable = 0.5 - 0.5 * Math.cos(2 * Math.PI * 4 * t);
    const fade = Math.min(1, i / 400, (samples - i) / 400);
    const pitch = 190 + 40 * Math.sin(2 * Math.PI * 0.7 * t);
    const wave = Math.sin(2 * Math.PI * pitch * t) + 0.4 * Math.sin(2 * Math.PI * pitch * 2 * t);
    pcm.writeInt16LE(Math.round(wave * syllable * fade * 6000), i * 2);
  }
  return pcm;
}

function rmsDb(frame: Buffer): number {
  const n = frame.length >> 1;
  if (n === 0) return -120;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = frame.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return 10 * Math.log10(sum / n + 1e-12);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- game socket --------
class MockSession {
  private utterance = 0;
  private speaking: { utterance: number; endsAt: number; cancelled: boolean } | null = null;
  private listening = false;
  private speechMs = 0;
  private silenceMs = 0;
  private heardSpeech: (() => void) | null = null;
  private games = 0;
  private playing = false;
  private alive = true;

  constructor(private readonly ws: WebSocket) {
    ws.on('close', () => {
      this.alive = false;
      this.heardSpeech?.();
    });
    ws.once('message', (data, isBinary) => {
      let token: unknown;
      try {
        token = isBinary ? null : JSON.parse(data.toString()).token;
      } catch {
        token = null;
      }
      if (typeof token !== 'string' || !token.startsWith('mock-session-')) {
        this.fail('unauthorized', 'Session expired. Please start again.', 4401);
        return;
      }
      this.send({ type: 'ready', protocol: PROTOCOL, max_games: MAX_GAMES });
      ws.on('message', (frame, binary) => this.onMessage(frame as Buffer, binary));
    });
  }

  private send(payload: unknown): void {
    if (this.alive) this.ws.send(JSON.stringify(payload));
  }

  private fail(code: string, message: string, closeCode: number): void {
    this.send({ type: 'error', code, message, fatal: true });
    this.ws.close(closeCode);
  }

  private onMessage(data: Buffer, binary: boolean): void {
    if (binary) {
      this.onAudio(data);
      return;
    }
    let msg: { type?: string; pack_id?: string; t?: number };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === 'ping') this.send({ type: 'pong', t: msg.t ?? null });
    else if (msg.type === 'quit') this.ws.close(1000);
    else if (msg.type === 'start' && !this.playing) {
      const pack = PACKS.find((p) => p.id === msg.pack_id);
      if (!pack) {
        this.send({
          type: 'error',
          code: 'unknown_pack',
          message: 'That question pack is not available.',
          fatal: false,
        });
      } else if (++this.games > MAX_GAMES) {
        this.fail('session_limit', "That's the most games for one session.", 4429);
      } else {
        this.playing = true;
        void this.play(pack).finally(() => (this.playing = false));
      }
    }
  }

  private onAudio(frame: Buffer): void {
    if (!this.listening || frame.length % 2 || frame.length > 8192) return;
    const ms = (frame.length / 2 / MIC_RATE) * 1000;
    if (rmsDb(frame) > -38) {
      this.speechMs += ms;
      this.silenceMs = 0;
      const speaking = this.speaking;
      if (this.speechMs >= 120 && speaking && !speaking.cancelled && Date.now() < speaking.endsAt) {
        speaking.cancelled = true;
        speaking.endsAt = Date.now();
        this.send({ type: 'barge_in', utterance: speaking.utterance });
      }
    } else if (this.speechMs > 0) {
      this.silenceMs += ms;
      if (this.speechMs >= 250 && this.silenceMs >= 450) this.heardSpeech?.();
    }
  }

  /** Streams one line. Odd utterances arrive live-paced, even ones as a cached burst. */
  private async say(caption: string, wait: boolean): Promise<void> {
    const utterance = (this.utterance = (this.utterance + 1) & 0xffff);
    const pcm = fakeSpeech(caption);
    const durationMs = (pcm.length / 2 / VOICE_RATE) * 1000;
    const speaking = { utterance, endsAt: Date.now() + durationMs, cancelled: false };
    this.speaking = speaking;
    this.send({ type: 'speak_start', utterance, caption, sample_rate: VOICE_RATE });
    const burst = utterance % 2 === 0;
    const stream = async (): Promise<void> => {
      let sent = 0;
      for (let at = 0; at < pcm.length && this.alive && !speaking.cancelled; at += 9600) {
        const chunk = pcm.subarray(at, at + 9600);
        const last = burst && at + chunk.length >= pcm.length;
        const header = Buffer.from([0x41, utterance >> 8, utterance & 0xff, last ? 1 : 0]);
        this.ws.send(Buffer.concat([header, chunk]));
        sent += chunk.length;
        if (!burst) await sleep(150);
      }
      this.send({
        type: 'speak_end',
        utterance,
        duration_ms: Math.round((sent / 2 / VOICE_RATE) * 1000),
        interrupted: speaking.cancelled,
      });
    };
    if (!wait) {
      void stream();
      return;
    }
    await stream();
    const left = speaking.endsAt - Date.now();
    if (left > 0) await sleep(left);
  }

  private async play(pack: MockPack): Promise<void> {
    const questions = pack.questions.slice(0, QUESTIONS_PER_GAME);
    const total = questions.length;
    const gameId = `mock-${Date.now()}`;
    let score = 0;
    let streak = 0;
    let correctCount = 0;
    this.send({
      type: 'game_start',
      game_id: gameId,
      pack: summary(pack),
      questions: total,
      time_limit_s: TIME_LIMIT_S,
      max_score: maxScore(total),
    });
    await this.say(LINES.intro, true);

    for (const [index, q] of questions.entries()) {
      if (!this.alive) return;
      this.send({
        type: 'question',
        index,
        total,
        prompt: q.prompt,
        kind: q.kind,
        time_limit_s: TIME_LIMIT_S,
      });
      await this.say(q.prompt, false);
      const question = this.speaking;
      this.speechMs = this.silenceMs = 0;
      this.listening = true;
      this.send({ type: 'listen', index, barge_in: true });

      // Wait for speech, or for the answer window after the question audio ends.
      let spoke = false;
      let deadline = 0;
      let eosSent = false;
      while (this.alive && !spoke) {
        deadline = (question?.endsAt ?? Date.now()) + (TIME_LIMIT_S + GRACE_S) * 1000;
        if (Date.now() >= deadline) break;
        spoke = await Promise.race([
          new Promise<boolean>((resolve) => (this.heardSpeech = () => resolve(true))),
          sleep(100).then(() => false),
        ]);
        if (spoke && !eosSent) {
          eosSent = true;
          this.send({ type: 'eos' });
          await sleep(500);
        }
      }
      this.listening = false;
      this.heardSpeech = null;
      if (!this.alive) return;

      const correct = spoke && index % 2 === 0;
      streak = correct ? streak + 1 : 0;
      const remaining = Math.max(0, (deadline - Date.now()) / 1000 - GRACE_S);
      const points = correct
        ? 100 + Math.round(50 * Math.min(1, remaining / TIME_LIMIT_S)) + Math.min(50, 10 * (streak - 1))
        : 0;
      score += points;
      correctCount += Number(correct);
      this.send({
        type: 'result',
        index,
        correct,
        timed_out: !spoke,
        heard: spoke ? '(mock) something was said' : '',
        answer: q.answer,
        explanation: q.explanation ?? null,
        points,
        score,
        streak,
      });
      await this.say(correct ? LINES.correct : spoke ? LINES.wrong : LINES.timeout, true);
      if (!correct) await this.say(LINES.answerWas(q.answer), true);
    }

    void this.say(LINES.gameOver, false);
    const scoreToken = `mock-score-${gameId}`;
    scoreTokens.set(scoreToken, {
      score,
      correct: correctCount,
      questions: total,
      language: pack.language,
    });
    this.send({
      type: 'game_over',
      game_id: gameId,
      score,
      correct: correctCount,
      questions: total,
      max_score: maxScore(total),
      score_token: scoreToken,
    });
  }
}

/** The part of Vite's dev and preview servers the mock needs: any Node HTTP(S) server fits. */
interface UpgradeSource {
  on(event: 'upgrade', listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown;
}

export function attachMock(middlewares: Connect.Server, httpServer: UpgradeSource): void {
  middlewares.use(api);
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://mock.local').pathname !== '/ws/play') return;
    const offered = (req.headers['sec-websocket-protocol'] ?? '').split(',').map((p) => p.trim());
    if (!offered.includes(PROTOCOL)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => new MockSession(ws));
  });
  console.log('\n  Mock game server attached: /api/* and /ws/play are simulated.\n');
}
