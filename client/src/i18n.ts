/**
 * On-screen text in the five game languages. The interface follows the language the player
 * picks; spoken lines and their captions come from the server.
 */
import type { EndingBand, LanguageCode, Wizard } from './protocol/messages';

export interface Strings {
  /** BCP 47 tag for the `lang` attribute. */
  htmlLang: string;
  /** How the language is named on the share card: "I scored 8/10 in ___". */
  shareLanguage: string;
  tagline: string;
  start: string;
  chooseLanguage: string;
  leaderboard: string;
  creator: string;
  settings: string;
  back: string;
  home: string;
  retry: string;
  reload: string;
  close: string;
  loading: string;

  disclosure: string;
  privacyLink: string;
  privacyTitle: string;
  privacyBody: string[];

  howTitle: string;
  howSteps: [string, string, string];

  botCheckTitle: string;
  botCheckBody: string;
  connecting: string;

  choosePack: string;
  noPacks: string;
  questions: (n: number) => string;
  gamesLeft: (n: number) => string;

  score: string;
  streak: string;
  questionOf: (n: number, total: number) => string;
  getReady: string;
  listenUp: string;
  speakNow: string;
  checking: string;
  heardNothing: string;
  correct: string;
  wrong: string;
  timeout: string;
  skipped: string;
  youSaid: string;
  answerIs: string;
  points: (n: number) => string;
  secondsLeft: (n: number) => string;
  quit: string;
  micOn: string;
  micOff: string;

  /** Who is talking in the dialogue box when the pack has no named wizard. */
  quizMaster: string;
  /** The fourth tile next to the three choices: any other answer can be spoken too. */
  otherAnswer: string;
  /** Screen-reader label for the choices: they are said aloud, not tapped. */
  optionsHint: string;
  questBadge: string;
  questProgress: (done: number, total: number) => string;
  chooseHero: string;
  yourHero: string;
  endings: Record<EndingBand, string>;
  chooseWizard: string;
  /** Titles for the three pickable wizards (a quest's own name is used when it matches). */
  wizardNames: Record<Wizard, string>;
  /** Shown when the browser is holding the game's sound back. */
  soundOff: string;
  /** The sixth card in the quest list: player-made quizzes, generated live (not built yet). */
  customQuizTitle: string;
  customQuizBody: string;
  comingSoon: string;

  gameOver: string;
  finalScore: string;
  correctOf: (correct: number, total: number) => string;
  nickname: string;
  nicknameHint: string;
  nickLength: string;
  nickCharacters: string;
  nickLetter: string;
  nickRejected: string;
  submitScore: string;
  submitting: string;
  submitted: string;
  alreadySubmitted: string;
  scoreExpired: string;
  share: string;
  shareLine: (correct: number, total: number, language: string) => string;
  shareSaved: string;
  playAgain: string;
  noGamesLeft: string;

  today: string;
  allTime: string;
  boardEmpty: string;
  boardFailed: string;
  rank: string;
  player: string;

  settingsTitle: string;
  voiceVolume: string;
  sfx: string;
  music: string;
  language: string;

  problems: Record<ProblemCode, { title: string; body: string }>;
  rateLimited: (seconds: number) => string;
}

export type ProblemCode =
  | 'offline'
  | 'connection_lost'
  | 'closed_for_today'
  | 'maintenance'
  | 'unavailable'
  | 'bot_check_failed'
  | 'bot_check_unreachable'
  | 'rate_limited'
  | 'forbidden_origin'
  | 'unauthorized'
  | 'already_connected'
  | 'session_limit'
  | 'audio_limit'
  | 'idle'
  | 'busy'
  | 'unknown_pack'
  | 'unknown_character'
  | 'unknown_adventure'
  | 'unknown_language'
  | 'protocol'
  | 'internal'
  | 'mic_denied'
  | 'mic_missing'
  | 'mic_busy'
  | 'mic_lost'
  | 'unsupported';

const hinglish: Strings = {
  htmlLang: 'hi-Latn',
  shareLanguage: 'Hinglish',
  tagline: 'Awaaz se khelne wala RPG. Raasta chuno, paheliyan suljhao, saari endings dhoondo.',
  start: 'START',
  chooseLanguage: 'Language chuno',
  leaderboard: 'Leaderboard',
  creator: 'Creator Mode',
  settings: 'Settings',
  back: 'Back',
  home: 'Home',
  retry: 'Try again',
  reload: 'Reload',
  close: 'Close',
  loading: 'Loading…',

  disclosure: 'Aapki awaaz kahin store nahi hoti. Game ki voices AI-generated hain (Gnani Timbre).',
  privacyLink: 'Privacy & AI voice',
  privacyTitle: 'Privacy & AI voice',
  privacyBody: [
    'Mic sirf tab sunta hai jab screen par "Bolo!" dikhe. Us waqt aapki awaaz hamare server se hokar Gnani ke speech recognition tak jaati hai, taaki jawab samjha ja sake.',
    'Koi audio store nahi hota: na hamare server par, na aapke phone par. Sirf jawab ka text us round ke liye use hota hai.',
    'Sawal aur feedback bolne wali voices insaan ki nahi hain. Ye AI se bani hain (Gnani Timbre).',
    'Leaderboard par sirf aapka chuna hua nickname aur score dikhta hai. Asli naam mat likhiye.',
  ],

  howTitle: 'Kaise khelein',
  howSteps: ['Wizard ki kahani suno', 'Apni choice bolkar batao', 'Saari endings collect karo'],

  botCheckTitle: 'Ek second…',
  botCheckBody: 'Check kar rahe hain ki aap robot nahi ho.',
  connecting: 'Connect ho raha hai…',

  choosePack: 'Quiz pack chuno',
  noPacks: 'Is language mein abhi koi pack nahi hai.',
  questions: (n) => `${n} sawal`,
  gamesLeft: (n) => `Is session mein ${n} game baaki`,

  score: 'SCORE',
  streak: 'STREAK',
  questionOf: (n, total) => `Sawal ${n} / ${total}`,
  getReady: 'Ready ho jao!',
  listenUp: 'Suno…',
  speakNow: 'Bolo!',
  checking: 'Check ho raha hai…',
  heardNothing: 'Sunai nahi diya. Phir se bolo!',
  correct: 'Sahi jawab!',
  wrong: 'Galat!',
  timeout: 'Time up!',
  skipped: 'Technical dikkat: ye sawal skip, koi penalty nahi.',
  youSaid: 'Aapne kaha',
  answerIs: 'Sahi jawab',
  points: (n) => `+${n}`,
  secondsLeft: (n) => `${n} second baaki`,
  quit: 'Game chhodo',
  micOn: 'Mic on hai, bolo',
  micOff: 'Mic off hai',

  quizMaster: 'Quiz Master',
  otherAnswer: 'Kuch aur? Bol do!',
  optionsHint: 'In mein se ek jawab zor se bolo',
  questBadge: 'QUEST',
  questProgress: (d, t) => `Quest ${d}/${t}`,
  chooseHero: 'Apna hero chuno',
  yourHero: 'Aapka hero',
  endings: { great: 'Legend ban gaye!', good: 'Badhiya quest!', try_again: 'Agli baar pakka!' },
  chooseWizard: 'Apna wizard chuno',
  wizardNames: {
    sorceress: 'Jaadugarni',
    sage: 'Baba Sage',
    owl: 'Professor Ullu',
    enchantress: 'Mohini',
    trickster: 'Lomdi Jaadugar',
  },
  soundOff: 'Awaaz band hai, tap karo',
  customQuizTitle: 'Apna quiz banao',
  customQuizBody: 'Koi bhi topic bolo, AI tumhare liye quiz bana dega.',
  comingSoon: 'Jald aa raha hai',

  gameOver: 'GAME OVER',
  finalScore: 'Aapka score',
  correctOf: (c, t) => `${t} mein se ${c} sahi`,
  nickname: 'Nickname',
  nicknameHint: '3 se 16 characters. Asli naam mat likhiye.',
  nickLength: 'Nickname 3 se 16 characters ka hona chahiye.',
  nickCharacters: 'Sirf letters, numbers, space, _ aur - chalenge.',
  nickLetter: 'Nickname mein kam se kam ek letter chahiye.',
  nickRejected: 'Ye nickname nahi chalega. Koi aur chuno.',
  submitScore: 'Leaderboard par daalo',
  submitting: 'Bhej rahe hain…',
  submitted: 'Score leaderboard par aa gaya!',
  alreadySubmitted: 'Ye score pehle hi submit ho chuka hai.',
  scoreExpired: 'Score submit karne ka time nikal gaya (10 minute).',
  share: 'Score card share karo',
  shareLine: (c, t, lang) => `Maine ${lang} mein ${c}/${t} score kiya. Mujhe hara ke dikhao!`,
  shareSaved: 'Score card download ho gaya.',
  playAgain: 'Phir se khelo',
  noGamesLeft: 'Is session ke games khatam. Naya session shuru karne ke liye Home par jao.',

  today: 'Aaj',
  allTime: 'All time',
  boardEmpty: 'Abhi koi score nahi. Pehle aap bano!',
  boardFailed: 'Leaderboard load nahi hua.',
  rank: '#',
  player: 'Player',

  settingsTitle: 'Settings',
  voiceVolume: 'Voice volume',
  sfx: 'Sound effects',
  music: 'Music',
  language: 'Language',

  problems: {
    offline: {
      title: 'Internet nahi hai',
      body: 'Mic Drop Arcade ko khelne ke liye internet chahiye. Connection check karke phir try karo.',
    },
    connection_lost: {
      title: 'Connection toot gaya',
      body: 'Game ke beech network chala gaya, isliye ye game khatam ho gaya. Connection aane par naya game shuru karo.',
    },
    closed_for_today: {
      title: 'Aaj ke liye band',
      body: 'Aaj ki limit poori ho gayi. Kal phir aana!',
    },
    maintenance: {
      title: 'Thodi der mein wapas',
      body: 'Arcade mein kaam chal raha hai. Thodi der baad try karo.',
    },
    unavailable: {
      title: 'Server busy hai',
      body: 'Abhi server tak nahi pahunch paaye. Thodi der mein phir try karo.',
    },
    bot_check_failed: {
      title: 'Check fail ho gaya',
      body: 'Hum confirm nahi kar paaye ki aap insaan ho. Phir se try karo.',
    },
    bot_check_unreachable: {
      title: 'Check load nahi hua',
      body: 'Security check load nahi ho paaya. Ad blocker ya network check karke phir try karo.',
    },
    rate_limited: { title: 'Thoda ruko', body: 'Bahut jaldi-jaldi try ho raha hai.' },
    forbidden_origin: {
      title: 'Galat address',
      body: 'Game ko uske official address se kholo.',
    },
    unauthorized: {
      title: 'Session khatam',
      body: 'Aapka session expire ho gaya. Phir se START dabao.',
    },
    already_connected: {
      title: 'Doosre tab mein khula hai',
      body: 'Ye game kisi aur tab mein chal raha hai. Wahan khelo, ya use band karke yahan try karo.',
    },
    session_limit: {
      title: 'Session ke games poore',
      body: 'Ek session mein itne hi games khel sakte hain. Naya session shuru karo.',
    },
    audio_limit: {
      title: 'Aaj ki play limit poori',
      body: 'Aapne aaj ke liye kaafi khel liya. Kal phir aana!',
    },
    idle: {
      title: 'So gaye kya?',
      body: 'Kaafi der tak kuch nahi hua, isliye connection band ho gaya.',
    },
    busy: {
      title: 'Abhi bahut players hain',
      body: 'Sab machines busy hain. Ek minute mein phir try karo.',
    },
    unknown_pack: {
      title: 'Pack nahi mila',
      body: 'Ye quiz pack ab available nahi hai. Koi aur chuno.',
    },
    unknown_character: { title: 'Hero nahi mila', body: 'Screen par diye heroes mein se ek chuno.' },
    unknown_adventure: { title: 'Adventure nahi mila', body: 'List mein se koi aur adventure chuno.' },
    unknown_language: { title: 'Bhasha nahi mili', body: 'Screen par di gayi bhashaon mein se ek chuno.' },
    protocol: {
      title: 'Connection band ho gaya',
      body: 'Kuch gadbad ho gayi. Page reload karke phir try karo.',
    },
    internal: {
      title: 'Kuch gadbad ho gayi',
      body: 'Hamari taraf se dikkat hai. Page reload karke phir try karo.',
    },
    mic_denied: {
      title: 'Mic ki permission chahiye',
      body: 'Ye game sirf bolkar khela jaata hai. Browser ki site settings mein microphone allow karo, phir try karo.',
    },
    mic_missing: {
      title: 'Mic nahi mila',
      body: 'Is device par koi microphone nahi mila. Mic ya headset lagakar phir try karo.',
    },
    mic_busy: {
      title: 'Mic busy hai',
      body: 'Koi aur app mic use kar raha hai. Use band karke phir try karo.',
    },
    mic_lost: {
      title: 'Mic disconnect ho gaya',
      body: 'Game ke beech mic band ho gaya. Mic check karke naya game shuru karo.',
    },
    unsupported: {
      title: 'Ye browser nahi chalega',
      body: 'Mic Drop Arcade ko naya Chrome ya Safari chahiye, HTTPS par, microphone ke saath.',
    },
  },
  rateLimited: (s) => `${s} second mein phir try karo.`,
};

const hindi: Strings = {
  htmlLang: 'hi',
  shareLanguage: 'हिन्दी',
  tagline: 'आवाज़ से खेला जाने वाला RPG. रास्ता चुनिए, पहेलियाँ सुलझाइए, हर एंडिंग खोजिए।',
  start: 'शुरू करें',
  chooseLanguage: 'भाषा चुनें',
  leaderboard: 'लीडरबोर्ड',
  creator: 'क्रिएटर मोड',
  settings: 'सेटिंग्स',
  back: 'वापस',
  home: 'होम',
  retry: 'फिर कोशिश करें',
  reload: 'रीलोड करें',
  close: 'बंद करें',
  loading: 'लोड हो रहा है…',

  disclosure: 'आपकी आवाज़ कहीं स्टोर नहीं होती। गेम की आवाज़ें AI से बनी हैं (Gnani Timbre)।',
  privacyLink: 'प्राइवेसी और AI आवाज़',
  privacyTitle: 'प्राइवेसी और AI आवाज़',
  privacyBody: [
    'माइक सिर्फ़ तब सुनता है जब स्क्रीन पर "बोलिए!" दिखे। उस समय आपकी आवाज़ हमारे सर्वर से होकर Gnani की स्पीच रिकग्निशन तक जाती है, ताकि जवाब समझा जा सके।',
    'कोई ऑडियो स्टोर नहीं होता: न हमारे सर्वर पर, न आपके फ़ोन पर। सिर्फ़ जवाब का टेक्स्ट उस राउंड के लिए इस्तेमाल होता है।',
    'सवाल और फ़ीडबैक बोलने वाली आवाज़ें इंसान की नहीं हैं। ये AI से बनी हैं (Gnani Timbre)।',
    'लीडरबोर्ड पर सिर्फ़ आपका चुना हुआ निकनेम और स्कोर दिखता है। असली नाम मत लिखिए।',
  ],

  howTitle: 'कैसे खेलें',
  howSteps: ['जादूगर की कहानी सुनिए', 'अपना फ़ैसला बोलकर बताइए', 'सारी एंडिंग्स इकट्ठा कीजिए'],

  botCheckTitle: 'एक सेकंड…',
  botCheckBody: 'जाँच रहे हैं कि आप रोबोट नहीं हैं।',
  connecting: 'कनेक्ट हो रहा है…',

  choosePack: 'क्विज़ पैक चुनें',
  noPacks: 'इस भाषा में अभी कोई पैक नहीं है।',
  questions: (n) => `${n} सवाल`,
  gamesLeft: (n) => `इस सेशन में ${n} गेम बाकी`,

  score: 'स्कोर',
  streak: 'स्ट्रीक',
  questionOf: (n, total) => `सवाल ${n} / ${total}`,
  getReady: 'तैयार हो जाइए!',
  listenUp: 'सुनिए…',
  speakNow: 'बोलिए!',
  checking: 'जाँच हो रही है…',
  heardNothing: 'सुनाई नहीं दिया। फिर से बोलिए!',
  correct: 'बिल्कुल सही!',
  wrong: 'गलत!',
  timeout: 'समय खत्म!',
  skipped: 'तकनीकी दिक्कत: यह सवाल छोड़ा गया, कोई पेनल्टी नहीं।',
  youSaid: 'आपने कहा',
  answerIs: 'सही जवाब',
  points: (n) => `+${n}`,
  secondsLeft: (n) => `${n} सेकंड बाकी`,
  quit: 'गेम छोड़ें',
  micOn: 'माइक चालू है, बोलिए',
  micOff: 'माइक बंद है',

  quizMaster: 'क्विज़ मास्टर',
  otherAnswer: 'कुछ और? बोल दीजिए!',
  optionsHint: 'इनमें से एक जवाब ज़ोर से बोलिए',
  questBadge: 'क्वेस्ट',
  questProgress: (d, t) => `क्वेस्ट ${d}/${t}`,
  chooseHero: 'अपना हीरो चुनिए',
  yourHero: 'आपका हीरो',
  endings: { great: 'आप तो लेजेंड हैं!', good: 'बढ़िया क्वेस्ट!', try_again: 'अगली बार पक्का!' },
  chooseWizard: 'अपना जादूगर चुनिए',
  wizardNames: {
    sorceress: 'जादूगरनी',
    sage: 'ऋषि बाबा',
    owl: 'प्रोफ़ेसर उल्लू',
    enchantress: 'मोहिनी',
    trickster: 'लोमड़ी जादूगर',
  },
  soundOff: 'आवाज़ बंद है, टैप कीजिए',
  customQuizTitle: 'अपना क्विज़ बनाइए',
  customQuizBody: 'कोई भी विषय बोलिए, AI आपके लिए क्विज़ बना देगा।',
  comingSoon: 'जल्द आ रहा है',

  gameOver: 'खेल खत्म',
  finalScore: 'आपका स्कोर',
  correctOf: (c, t) => `${t} में से ${c} सही`,
  nickname: 'निकनेम',
  nicknameHint: '3 से 16 अक्षर। असली नाम मत लिखिए।',
  nickLength: 'निकनेम 3 से 16 अक्षर का होना चाहिए।',
  nickCharacters: 'सिर्फ़ अक्षर, अंक, स्पेस, _ और - चलेंगे।',
  nickLetter: 'निकनेम में कम से कम एक अक्षर चाहिए।',
  nickRejected: 'यह निकनेम नहीं चलेगा। कोई और चुनिए।',
  submitScore: 'लीडरबोर्ड पर डालें',
  submitting: 'भेज रहे हैं…',
  submitted: 'स्कोर लीडरबोर्ड पर आ गया!',
  alreadySubmitted: 'यह स्कोर पहले ही भेजा जा चुका है।',
  scoreExpired: 'स्कोर भेजने का समय निकल गया (10 मिनट)।',
  share: 'स्कोर कार्ड शेयर करें',
  shareLine: (c, t, lang) => `मैंने ${lang} में ${c}/${t} स्कोर किया। मुझे हराकर दिखाओ!`,
  shareSaved: 'स्कोर कार्ड डाउनलोड हो गया।',
  playAgain: 'फिर से खेलें',
  noGamesLeft: 'इस सेशन के गेम खत्म। नया सेशन शुरू करने के लिए होम पर जाइए।',

  today: 'आज',
  allTime: 'अब तक',
  boardEmpty: 'अभी कोई स्कोर नहीं। पहले आप बनिए!',
  boardFailed: 'लीडरबोर्ड लोड नहीं हुआ।',
  rank: '#',
  player: 'खिलाड़ी',

  settingsTitle: 'सेटिंग्स',
  voiceVolume: 'आवाज़ का वॉल्यूम',
  sfx: 'साउंड इफ़ेक्ट',
  music: 'संगीत',
  language: 'भाषा',

  problems: {
    offline: {
      title: 'इंटरनेट नहीं है',
      body: 'माइक ड्रॉप आर्केड खेलने के लिए इंटरनेट चाहिए। कनेक्शन जाँचकर फिर कोशिश करें।',
    },
    connection_lost: {
      title: 'कनेक्शन टूट गया',
      body: 'गेम के बीच नेटवर्क चला गया, इसलिए यह गेम खत्म हो गया। कनेक्शन आने पर नया गेम शुरू करें।',
    },
    closed_for_today: {
      title: 'आज के लिए बंद',
      body: 'आज की सीमा पूरी हो गई। कल फिर आइए!',
    },
    maintenance: {
      title: 'थोड़ी देर में वापस',
      body: 'आर्केड में काम चल रहा है। थोड़ी देर बाद कोशिश करें।',
    },
    unavailable: {
      title: 'सर्वर व्यस्त है',
      body: 'अभी सर्वर तक नहीं पहुँच पाए। थोड़ी देर में फिर कोशिश करें।',
    },
    bot_check_failed: {
      title: 'जाँच विफल रही',
      body: 'हम पक्का नहीं कर पाए कि आप इंसान हैं। फिर से कोशिश करें।',
    },
    bot_check_unreachable: {
      title: 'जाँच लोड नहीं हुई',
      body: 'सुरक्षा जाँच लोड नहीं हो पाई। ऐड ब्लॉकर या नेटवर्क जाँचकर फिर कोशिश करें।',
    },
    rate_limited: { title: 'थोड़ा रुकिए', body: 'बहुत जल्दी-जल्दी कोशिश हो रही है।' },
    forbidden_origin: {
      title: 'गलत पता',
      body: 'गेम को उसके आधिकारिक पते से खोलिए।',
    },
    unauthorized: {
      title: 'सेशन खत्म',
      body: 'आपका सेशन खत्म हो गया। फिर से शुरू करें।',
    },
    already_connected: {
      title: 'दूसरे टैब में खुला है',
      body: 'यह गेम किसी और टैब में चल रहा है। वहाँ खेलिए, या उसे बंद करके यहाँ कोशिश करें।',
    },
    session_limit: {
      title: 'सेशन के गेम पूरे',
      body: 'एक सेशन में इतने ही गेम खेले जा सकते हैं। नया सेशन शुरू करें।',
    },
    audio_limit: {
      title: 'आज की सीमा पूरी',
      body: 'आपने आज के लिए काफ़ी खेल लिया। कल फिर आइए!',
    },
    idle: {
      title: 'सो गए क्या?',
      body: 'काफ़ी देर तक कुछ नहीं हुआ, इसलिए कनेक्शन बंद हो गया।',
    },
    busy: {
      title: 'अभी बहुत खिलाड़ी हैं',
      body: 'सारी मशीनें व्यस्त हैं। एक मिनट में फिर कोशिश करें।',
    },
    unknown_pack: {
      title: 'पैक नहीं मिला',
      body: 'यह क्विज़ पैक अब उपलब्ध नहीं है। कोई और चुनिए।',
    },
    unknown_character: { title: 'हीरो नहीं मिला', body: 'स्क्रीन पर दिए हीरो में से एक चुनिए।' },
    unknown_adventure: { title: 'एडवेंचर नहीं मिला', body: 'सूची में से कोई और एडवेंचर चुनिए।' },
    unknown_language: { title: 'भाषा नहीं मिली', body: 'स्क्रीन पर दी गई भाषाओं में से एक चुनिए।' },
    protocol: {
      title: 'कनेक्शन बंद हो गया',
      body: 'कुछ गड़बड़ हो गई। पेज रीलोड करके फिर कोशिश करें।',
    },
    internal: {
      title: 'कुछ गड़बड़ हो गई',
      body: 'हमारी तरफ़ से दिक्कत है। पेज रीलोड करके फिर कोशिश करें।',
    },
    mic_denied: {
      title: 'माइक की अनुमति चाहिए',
      body: 'यह गेम सिर्फ़ बोलकर खेला जाता है। ब्राउज़र की साइट सेटिंग्स में माइक्रोफ़ोन की अनुमति दीजिए, फिर कोशिश करें।',
    },
    mic_missing: {
      title: 'माइक नहीं मिला',
      body: 'इस डिवाइस पर कोई माइक्रोफ़ोन नहीं मिला। माइक या हेडसेट लगाकर फिर कोशिश करें।',
    },
    mic_busy: {
      title: 'माइक व्यस्त है',
      body: 'कोई और ऐप माइक इस्तेमाल कर रहा है। उसे बंद करके फिर कोशिश करें।',
    },
    mic_lost: {
      title: 'माइक डिस्कनेक्ट हो गया',
      body: 'गेम के बीच माइक बंद हो गया। माइक जाँचकर नया गेम शुरू करें।',
    },
    unsupported: {
      title: 'यह ब्राउज़र नहीं चलेगा',
      body: 'माइक ड्रॉप आर्केड को नया Chrome या Safari चाहिए, HTTPS पर, माइक्रोफ़ोन के साथ।',
    },
  },
  rateLimited: (s) => `${s} सेकंड में फिर कोशिश करें।`,
};

const telugu: Strings = {
  htmlLang: 'te',
  shareLanguage: 'తెలుగు',
  tagline: 'మీ గొంతుతో ఆడే RPG. దారి ఎంచుకోండి, పొడుపు కథలు విప్పండి, అన్ని ఎండింగ్స్ కనుక్కోండి.',
  start: 'ప్రారంభించు',
  chooseLanguage: 'భాష ఎంచుకోండి',
  leaderboard: 'లీడర్‌బోర్డ్',
  creator: 'క్రియేటర్ మోడ్',
  settings: 'సెట్టింగ్‌లు',
  back: 'వెనక్కి',
  home: 'హోమ్',
  retry: 'మళ్లీ ప్రయత్నించండి',
  reload: 'రీలోడ్ చేయండి',
  close: 'మూసివేయి',
  loading: 'లోడ్ అవుతోంది…',

  disclosure: 'మీ గొంతు ఎక్కడా నిల్వ కాదు. ఆటలోని గొంతులు AI తో తయారైనవి (Gnani Timbre).',
  privacyLink: 'గోప్యత & AI గొంతు',
  privacyTitle: 'గోప్యత & AI గొంతు',
  privacyBody: [
    'తెరపై "చెప్పండి!" కనిపించినప్పుడు మాత్రమే మైక్ వింటుంది. ఆ సమయంలో మీ మాట మా సర్వర్ ద్వారా Gnani స్పీచ్ రికగ్నిషన్‌కు వెళ్తుంది, మీ సమాధానం అర్థం చేసుకోవడానికి.',
    'ఏ ఆడియో నిల్వ కాదు: మా సర్వర్‌లో కాదు, మీ ఫోన్‌లో కాదు. సమాధానం టెక్స్ట్ ఆ రౌండ్ కోసం మాత్రమే వాడబడుతుంది.',
    'ప్రశ్నలు, ఫీడ్‌బ్యాక్ చెప్పే గొంతులు మనుషులవి కావు. అవి AI తో తయారైనవి (Gnani Timbre).',
    'లీడర్‌బోర్డ్‌లో మీరు ఎంచుకున్న నిక్‌నేమ్, స్కోరు మాత్రమే కనిపిస్తాయి. అసలు పేరు రాయకండి.',
  ],

  howTitle: 'ఎలా ఆడాలి',
  howSteps: ['విజార్డ్ కథ వినండి', 'మీ ఎంపికను గట్టిగా చెప్పండి', 'అన్ని ఎండింగ్స్ సేకరించండి'],

  botCheckTitle: 'ఒక్క క్షణం…',
  botCheckBody: 'మీరు రోబో కాదని సరిచూస్తున్నాం.',
  connecting: 'కనెక్ట్ అవుతోంది…',

  choosePack: 'క్విజ్ ప్యాక్ ఎంచుకోండి',
  noPacks: 'ఈ భాషలో ఇంకా ప్యాక్‌లు లేవు.',
  questions: (n) => `${n} ప్రశ్నలు`,
  gamesLeft: (n) => `ఈ సెషన్‌లో ఇంకా ${n} ఆటలు`,

  score: 'స్కోరు',
  streak: 'స్ట్రీక్',
  questionOf: (n, total) => `ప్రశ్న ${n} / ${total}`,
  getReady: 'సిద్ధంగా ఉండండి!',
  listenUp: 'వినండి…',
  speakNow: 'చెప్పండి!',
  checking: 'సరిచూస్తున్నాం…',
  heardNothing: 'వినిపించలేదు. మళ్లీ చెప్పండి!',
  correct: 'సరైన సమాధానం!',
  wrong: 'తప్పు!',
  timeout: 'సమయం అయిపోయింది!',
  skipped: 'సాంకేతిక సమస్య: ఈ ప్రశ్న వదిలేశాం, పెనాల్టీ లేదు.',
  youSaid: 'మీరు చెప్పింది',
  answerIs: 'సరైన సమాధానం',
  points: (n) => `+${n}`,
  secondsLeft: (n) => `ఇంకా ${n} సెకన్లు`,
  quit: 'ఆట వదిలేయి',
  micOn: 'మైక్ ఆన్‌లో ఉంది, చెప్పండి',
  micOff: 'మైక్ ఆఫ్‌లో ఉంది',

  quizMaster: 'క్విజ్ మాస్టర్',
  otherAnswer: 'ఇంకేదైనా? చెప్పేయండి!',
  optionsHint: 'వీటిలో ఒక సమాధానం గట్టిగా చెప్పండి',
  questBadge: 'క్వెస్ట్',
  questProgress: (d, t) => `క్వెస్ట్ ${d}/${t}`,
  chooseHero: 'మీ హీరోని ఎంచుకోండి',
  yourHero: 'మీ హీరో',
  endings: { great: 'మీరు లెజెండ్!', good: 'చక్కని క్వెస్ట్!', try_again: 'ఈసారి తప్పకుండా!' },
  chooseWizard: 'మీ మాంత్రికుడిని ఎంచుకోండి',
  wizardNames: {
    sorceress: 'మాంత్రికురాలు',
    sage: 'ముని బాబా',
    owl: 'గుడ్లగూబ ప్రొఫెసర్',
    enchantress: 'మోహిని',
    trickster: 'నక్క మాంత్రికుడు',
  },
  soundOff: 'సౌండ్ ఆఫ్‌లో ఉంది, ట్యాప్ చేయండి',
  customQuizTitle: 'మీ సొంత క్విజ్',
  customQuizBody: 'ఏ విషయమైనా చెప్పండి, AI మీ కోసం క్విజ్ తయారుచేస్తుంది.',
  comingSoon: 'త్వరలో వస్తోంది',

  gameOver: 'ఆట ముగిసింది',
  finalScore: 'మీ స్కోరు',
  correctOf: (c, t) => `${t} లో ${c} సరైనవి`,
  nickname: 'నిక్‌నేమ్',
  nicknameHint: '3 నుండి 16 అక్షరాలు. అసలు పేరు రాయకండి.',
  nickLength: 'నిక్‌నేమ్ 3 నుండి 16 అక్షరాలు ఉండాలి.',
  nickCharacters: 'అక్షరాలు, అంకెలు, స్పేస్, _ మరియు - మాత్రమే.',
  nickLetter: 'నిక్‌నేమ్‌లో కనీసం ఒక అక్షరం ఉండాలి.',
  nickRejected: 'ఈ నిక్‌నేమ్ కుదరదు. వేరేది ఎంచుకోండి.',
  submitScore: 'లీడర్‌బోర్డ్‌కు పంపండి',
  submitting: 'పంపుతున్నాం…',
  submitted: 'మీ స్కోరు లీడర్‌బోర్డ్‌లో చేరింది!',
  alreadySubmitted: 'ఈ స్కోరు ఇప్పటికే పంపబడింది.',
  scoreExpired: 'స్కోరు పంపే సమయం దాటిపోయింది (10 నిమిషాలు).',
  share: 'స్కోర్ కార్డ్ షేర్ చేయండి',
  shareLine: (c, t, lang) => `నేను ${lang}లో ${c}/${t} స్కోరు చేశాను. నన్ను ఓడించి చూపించండి!`,
  shareSaved: 'స్కోర్ కార్డ్ డౌన్‌లోడ్ అయింది.',
  playAgain: 'మళ్లీ ఆడండి',
  noGamesLeft: 'ఈ సెషన్ ఆటలు అయిపోయాయి. కొత్త సెషన్ కోసం హోమ్‌కు వెళ్లండి.',

  today: 'ఈరోజు',
  allTime: 'ఇప్పటివరకు',
  boardEmpty: 'ఇంకా స్కోర్లు లేవు. మొదటివారు మీరే అవ్వండి!',
  boardFailed: 'లీడర్‌బోర్డ్ లోడ్ కాలేదు.',
  rank: '#',
  player: 'ఆటగాడు',

  settingsTitle: 'సెట్టింగ్‌లు',
  voiceVolume: 'గొంతు వాల్యూమ్',
  sfx: 'సౌండ్ ఎఫెక్ట్‌లు',
  music: 'సంగీతం',
  language: 'భాష',

  problems: {
    offline: {
      title: 'ఇంటర్నెట్ లేదు',
      body: 'మైక్ డ్రాప్ ఆర్కేడ్ ఆడటానికి ఇంటర్నెట్ కావాలి. కనెక్షన్ చూసుకుని మళ్లీ ప్రయత్నించండి.',
    },
    connection_lost: {
      title: 'కనెక్షన్ తెగిపోయింది',
      body: 'ఆట మధ్యలో నెట్‌వర్క్ పోయింది, అందుకే ఈ ఆట ముగిసింది. కనెక్షన్ వచ్చాక కొత్త ఆట మొదలుపెట్టండి.',
    },
    closed_for_today: {
      title: 'ఈరోజుకు మూసివేశాం',
      body: 'ఈరోజు పరిమితి పూర్తయింది. రేపు మళ్లీ రండి!',
    },
    maintenance: {
      title: 'కాసేపట్లో తిరిగి వస్తాం',
      body: 'ఆర్కేడ్‌లో పని జరుగుతోంది. కాసేపటి తర్వాత ప్రయత్నించండి.',
    },
    unavailable: {
      title: 'సర్వర్ బిజీగా ఉంది',
      body: 'ప్రస్తుతం సర్వర్‌ను చేరుకోలేకపోయాం. కాసేపట్లో మళ్లీ ప్రయత్నించండి.',
    },
    bot_check_failed: {
      title: 'తనిఖీ విఫలమైంది',
      body: 'మీరు మనిషేనని నిర్ధారించలేకపోయాం. మళ్లీ ప్రయత్నించండి.',
    },
    bot_check_unreachable: {
      title: 'తనిఖీ లోడ్ కాలేదు',
      body: 'భద్రతా తనిఖీ లోడ్ కాలేదు. యాడ్ బ్లాకర్ లేదా నెట్‌వర్క్ చూసుకుని మళ్లీ ప్రయత్నించండి.',
    },
    rate_limited: { title: 'కాస్త ఆగండి', body: 'చాలా వేగంగా ప్రయత్నిస్తున్నారు.' },
    forbidden_origin: {
      title: 'తప్పు చిరునామా',
      body: 'ఆటను దాని అధికారిక చిరునామా నుండి తెరవండి.',
    },
    unauthorized: {
      title: 'సెషన్ ముగిసింది',
      body: 'మీ సెషన్ గడువు ముగిసింది. మళ్లీ ప్రారంభించండి.',
    },
    already_connected: {
      title: 'మరో ట్యాబ్‌లో తెరిచి ఉంది',
      body: 'ఈ ఆట మరో ట్యాబ్‌లో నడుస్తోంది. అక్కడ ఆడండి, లేదా దాన్ని మూసి ఇక్కడ ప్రయత్నించండి.',
    },
    session_limit: {
      title: 'సెషన్ ఆటలు పూర్తయ్యాయి',
      body: 'ఒక సెషన్‌లో ఇన్ని ఆటలే ఆడగలరు. కొత్త సెషన్ మొదలుపెట్టండి.',
    },
    audio_limit: {
      title: 'ఈరోజు పరిమితి పూర్తయింది',
      body: 'ఈరోజుకు మీరు చాలా ఆడారు. రేపు మళ్లీ రండి!',
    },
    idle: {
      title: 'నిద్రపోయారా?',
      body: 'చాలాసేపు ఏమీ జరగలేదు, అందుకే కనెక్షన్ మూసుకుంది.',
    },
    busy: {
      title: 'ఇప్పుడు చాలా మంది ఆడుతున్నారు',
      body: 'అన్ని మెషీన్లు బిజీగా ఉన్నాయి. ఒక నిమిషంలో మళ్లీ ప్రయత్నించండి.',
    },
    unknown_pack: {
      title: 'ప్యాక్ దొరకలేదు',
      body: 'ఈ క్విజ్ ప్యాక్ ఇప్పుడు అందుబాటులో లేదు. వేరేది ఎంచుకోండి.',
    },
    unknown_character: { title: 'హీరో దొరకలేదు', body: 'తెరపై ఉన్న హీరోలలో ఒకరిని ఎంచుకోండి.' },
    unknown_adventure: { title: 'అడ్వెంచర్ దొరకలేదు', body: 'జాబితాలో నుండి వేరే అడ్వెంచర్ ఎంచుకోండి.' },
    unknown_language: { title: 'భాష దొరకలేదు', body: 'తెరపై ఉన్న భాషలలో ఒకటి ఎంచుకోండి.' },
    protocol: {
      title: 'కనెక్షన్ మూసుకుంది',
      body: 'ఏదో పొరపాటు జరిగింది. పేజీ రీలోడ్ చేసి మళ్లీ ప్రయత్నించండి.',
    },
    internal: {
      title: 'ఏదో పొరపాటు జరిగింది',
      body: 'మా వైపు సమస్య ఉంది. పేజీ రీలోడ్ చేసి మళ్లీ ప్రయత్నించండి.',
    },
    mic_denied: {
      title: 'మైక్ అనుమతి కావాలి',
      body: 'ఈ ఆట కేవలం మాట్లాడి ఆడతారు. బ్రౌజర్ సైట్ సెట్టింగ్‌లలో మైక్రోఫోన్‌కు అనుమతి ఇచ్చి మళ్లీ ప్రయత్నించండి.',
    },
    mic_missing: {
      title: 'మైక్ దొరకలేదు',
      body: 'ఈ పరికరంలో మైక్రోఫోన్ దొరకలేదు. మైక్ లేదా హెడ్‌సెట్ పెట్టి మళ్లీ ప్రయత్నించండి.',
    },
    mic_busy: {
      title: 'మైక్ బిజీగా ఉంది',
      body: 'మరో యాప్ మైక్ వాడుతోంది. దాన్ని మూసి మళ్లీ ప్రయత్నించండి.',
    },
    mic_lost: {
      title: 'మైక్ డిస్‌కనెక్ట్ అయింది',
      body: 'ఆట మధ్యలో మైక్ ఆగిపోయింది. మైక్ చూసుకుని కొత్త ఆట మొదలుపెట్టండి.',
    },
    unsupported: {
      title: 'ఈ బ్రౌజర్ పనిచేయదు',
      body: 'మైక్ డ్రాప్ ఆర్కేడ్‌కు కొత్త Chrome లేదా Safari, HTTPS, మైక్రోఫోన్ కావాలి.',
    },
  },
  rateLimited: (s) => `${s} సెకన్లలో మళ్లీ ప్రయత్నించండి.`,
};

const english: Strings = {
  htmlLang: 'en-IN',
  shareLanguage: 'English',
  tagline: 'An RPG you play with your voice. Choose your path, crack riddles, find every ending.',
  start: 'START',
  chooseLanguage: 'Choose a language',
  leaderboard: 'Leaderboard',
  creator: 'Creator Mode',
  settings: 'Settings',
  back: 'Back',
  home: 'Home',
  retry: 'Try again',
  reload: 'Reload',
  close: 'Close',
  loading: 'Loading…',

  disclosure: 'Your voice is never stored. The voices in the game are AI-generated (Gnani Timbre).',
  privacyLink: 'Privacy & AI voice',
  privacyTitle: 'Privacy & AI voice',
  privacyBody: [
    'The mic only listens while "Speak!" is on screen. During that time your voice goes through our server to Gnani speech recognition, so your answer can be understood.',
    'No audio is stored: not on our server, not on your phone. Only the text of your answer is used, for that round.',
    'The voices that read questions and feedback are not human. They are AI-generated (Gnani Timbre).',
    'The leaderboard only shows the nickname you choose and your score. Don\'t use your real name.',
  ],

  howTitle: 'How to play',
  howSteps: ['Listen to the wizard\'s story', 'Say your choice out loud', 'Collect every ending'],

  botCheckTitle: 'One second…',
  botCheckBody: 'Checking that you are not a robot.',
  connecting: 'Connecting…',

  choosePack: 'Pick a quest',
  noPacks: 'No packs in this language yet.',
  questions: (n) => `${n} questions`,
  gamesLeft: (n) => `${n} games left in this session`,

  score: 'SCORE',
  streak: 'STREAK',
  questionOf: (n, total) => `Question ${n} of ${total}`,
  getReady: 'Get ready!',
  listenUp: 'Listen…',
  speakNow: 'Speak!',
  checking: 'Checking…',
  heardNothing: "Didn't catch that. Say it again!",
  correct: 'Correct!',
  wrong: 'Wrong!',
  timeout: "Time's up!",
  skipped: 'Technical hiccup: this question is skipped, no penalty.',
  youSaid: 'You said',
  answerIs: 'Answer',
  points: (n) => `+${n}`,
  secondsLeft: (n) => `${n} seconds left`,
  quit: 'Quit game',
  micOn: 'Mic is on, speak now',
  micOff: 'Mic is off',

  quizMaster: 'Quiz Master',
  otherAnswer: 'Something else? Say it!',
  optionsHint: 'Say one of these answers out loud',
  questBadge: 'QUEST',
  questProgress: (d, t) => `Quest ${d}/${t}`,
  chooseHero: 'Choose your hero',
  yourHero: 'Your hero',
  endings: { great: 'Legendary run!', good: 'Nice quest!', try_again: 'So close. Again?' },
  chooseWizard: 'Choose your wizard',
  wizardNames: {
    sorceress: 'The Sorceress',
    sage: 'The Sage',
    owl: 'Professor Owl',
    enchantress: 'The Enchantress',
    trickster: 'The Trickster',
  },
  soundOff: 'Sound is off. Tap to turn it on',
  customQuizTitle: 'Make your own quiz',
  customQuizBody: 'Say any topic and AI builds a quiz for you on the spot.',
  comingSoon: 'Coming soon',

  gameOver: 'GAME OVER',
  finalScore: 'Your score',
  correctOf: (c, t) => `${c} of ${t} correct`,
  nickname: 'Nickname',
  nicknameHint: '3 to 16 characters. Don\'t use your real name.',
  nickLength: 'A nickname needs 3 to 16 characters.',
  nickCharacters: 'Only letters, numbers, space, _ and - are allowed.',
  nickLetter: 'A nickname needs at least one letter.',
  nickRejected: "That nickname won't work. Pick another one.",
  submitScore: 'Post to leaderboard',
  submitting: 'Sending…',
  submitted: "You're on the leaderboard!",
  alreadySubmitted: 'This score was already posted.',
  scoreExpired: 'The time to post this score has passed (10 minutes).',
  share: 'Share score card',
  shareLine: (c, t, lang) => `I scored ${c}/${t} in ${lang}. Beat me if you can!`,
  shareSaved: 'Score card downloaded.',
  playAgain: 'Play again',
  noGamesLeft: 'No games left in this session. Go Home to start a new one.',

  today: 'Today',
  allTime: 'All time',
  boardEmpty: 'No scores yet. Be the first!',
  boardFailed: "The leaderboard didn't load.",
  rank: '#',
  player: 'Player',

  settingsTitle: 'Settings',
  voiceVolume: 'Voice volume',
  sfx: 'Sound effects',
  music: 'Music',
  language: 'Language',

  problems: {
    offline: {
      title: 'No internet',
      body: 'Mic Drop Arcade needs the internet. Check your connection and try again.',
    },
    connection_lost: {
      title: 'Connection lost',
      body: 'The network dropped mid-game, so this game ended. Start a new one when you are back online.',
    },
    closed_for_today: { title: 'Closed for today', body: "Today's limit is used up. Come back tomorrow!" },
    maintenance: { title: 'Back soon', body: 'The arcade is being worked on. Try again in a little while.' },
    unavailable: { title: 'Server is busy', body: "We couldn't reach the server. Try again in a moment." },
    bot_check_failed: { title: 'Check failed', body: "We couldn't confirm you're human. Try again." },
    bot_check_unreachable: {
      title: "Check didn't load",
      body: "The security check didn't load. Check your ad blocker or network and try again.",
    },
    rate_limited: { title: 'Slow down a bit', body: 'Too many tries too quickly.' },
    forbidden_origin: { title: 'Wrong address', body: 'Open the game from its official address.' },
    unauthorized: { title: 'Session ended', body: 'Your session expired. Press START again.' },
    already_connected: {
      title: 'Open in another tab',
      body: 'The game is running in another tab. Play there, or close it and try here.',
    },
    session_limit: {
      title: 'Session games used up',
      body: "That's the most games for one session. Start a new session.",
    },
    audio_limit: { title: "Today's play limit reached", body: "You've played a lot today. Come back tomorrow!" },
    idle: { title: 'Still there?', body: 'Nothing happened for a while, so the connection was closed.' },
    busy: { title: 'Lots of players right now', body: 'Every machine is busy. Try again in a minute.' },
    unknown_pack: { title: 'Pack not found', body: 'This quiz pack is no longer available. Pick another.' },
    unknown_character: { title: 'Hero not found', body: 'Pick one of the heroes on screen.' },
    unknown_adventure: { title: 'Adventure not found', body: 'Pick another adventure from the list.' },
    unknown_language: { title: 'Language not available', body: 'Pick one of the languages on screen.' },
    protocol: { title: 'Connection closed', body: 'Something went wrong. Reload the page and try again.' },
    internal: { title: 'Something went wrong', body: 'The problem is on our side. Reload the page and try again.' },
    mic_denied: {
      title: 'Mic permission needed',
      body: "This game is played only by speaking. Allow the microphone in your browser's site settings, then try again.",
    },
    mic_missing: { title: 'No mic found', body: 'No microphone was found on this device. Plug in a mic or headset and try again.' },
    mic_busy: { title: 'Mic is busy', body: 'Another app is using the mic. Close it and try again.' },
    mic_lost: { title: 'Mic disconnected', body: 'The mic stopped mid-game. Check it and start a new game.' },
    unsupported: {
      title: "This browser won't work",
      body: 'Mic Drop Arcade needs a recent Chrome or Safari, over HTTPS, with a microphone.',
    },
  },
  rateLimited: (s) => `Try again in ${s} seconds.`,
};

const tenglish: Strings = {
  htmlLang: 'te-Latn',
  shareLanguage: 'Tenglish',
  tagline: 'Mee voice tho aade RPG. Daari select cheyyandi, riddles solve cheyyandi, anni endings kanukkondi.',
  start: 'START',
  chooseLanguage: 'Language select cheyyandi',
  leaderboard: 'Leaderboard',
  creator: 'Creator Mode',
  settings: 'Settings',
  back: 'Back',
  home: 'Home',
  retry: 'Malli try cheyyandi',
  reload: 'Reload',
  close: 'Close',
  loading: 'Load avtundi…',

  disclosure: 'Mee voice ekkada store avvadu. Game lo voices AI-generated (Gnani Timbre).',
  privacyLink: 'Privacy & AI voice',
  privacyTitle: 'Privacy & AI voice',
  privacyBody: [
    'Screen meeda "Cheppandi!" kanipinchinappude mic vintundi. Aa time lo mee voice maa server dwara Gnani speech recognition ki veltundi, answer artham chesukovadaniki.',
    'E audio store avvadu: maa server lo kadu, mee phone lo kadu. Answer text aa round ki matrame use avtundi.',
    'Questions, feedback cheppe voices manushulavi kavu. Avi AI-generated (Gnani Timbre).',
    'Leaderboard lo mee nickname, score matrame kanipistayi. Real name pettakandi.',
  ],

  howTitle: 'Ela aadali',
  howSteps: ['Wizard katha vinandi', 'Mee choice gattiga cheppandi', 'Anni endings collect cheyyandi'],

  botCheckTitle: 'Okka second…',
  botCheckBody: 'Meeru robot kadani check chestunnam.',
  connecting: 'Connect avtundi…',

  choosePack: 'Quest select cheyyandi',
  noPacks: 'E language lo inka packs levu.',
  questions: (n) => `${n} questions`,
  gamesLeft: (n) => `E session lo inka ${n} games`,

  score: 'SCORE',
  streak: 'STREAK',
  questionOf: (n, total) => `Question ${n} / ${total}`,
  getReady: 'Ready ga undandi!',
  listenUp: 'Vinandi…',
  speakNow: 'Cheppandi!',
  checking: 'Check chestunnam…',
  heardNothing: 'Vinipinchaledu. Malli cheppandi!',
  correct: 'Correct answer!',
  wrong: 'Wrong!',
  timeout: 'Time ayipoyindi!',
  skipped: 'Technical problem: e question skip, penalty ledu.',
  youSaid: 'Meeru cheppindi',
  answerIs: 'Correct answer',
  points: (n) => `+${n}`,
  secondsLeft: (n) => `Inka ${n} seconds`,
  quit: 'Game quit',
  micOn: 'Mic on lo undi, cheppandi',
  micOff: 'Mic off lo undi',

  quizMaster: 'Quiz Master',
  otherAnswer: 'Vere answer? Cheppeyandi!',
  optionsHint: 'Veetilo oka answer gattiga cheppandi',
  questBadge: 'QUEST',
  questProgress: (d, t) => `Quest ${d}/${t}`,
  chooseHero: 'Mee hero ni select cheyyandi',
  yourHero: 'Mee hero',
  endings: { great: 'Meeru legend!', good: 'Super quest!', try_again: 'Next time pakka!' },
  chooseWizard: 'Mee wizard ni select cheyyandi',
  wizardNames: {
    sorceress: 'Sorceress',
    sage: 'Sage Baba',
    owl: 'Professor Owl',
    enchantress: 'Mohini',
    trickster: 'Nakka Mantrikudu',
  },
  soundOff: 'Sound off lo undi, tap cheyyandi',
  customQuizTitle: 'Mee own quiz',
  customQuizBody: 'E topic aina cheppandi, AI mee kosam quiz tayaru chestundi.',
  comingSoon: 'Coming soon',

  gameOver: 'GAME OVER',
  finalScore: 'Mee score',
  correctOf: (c, t) => `${t} lo ${c} correct`,
  nickname: 'Nickname',
  nicknameHint: '3 nundi 16 characters. Real name pettakandi.',
  nickLength: 'Nickname 3 nundi 16 characters undali.',
  nickCharacters: 'Letters, numbers, space, _ mariyu - matrame.',
  nickLetter: 'Nickname lo kanisam oka letter undali.',
  nickRejected: 'E nickname kudaradu. Verodi select cheyyandi.',
  submitScore: 'Leaderboard ki pampandi',
  submitting: 'Pamputunnam…',
  submitted: 'Mee score leaderboard lo vachindi!',
  alreadySubmitted: 'E score already submit ayindi.',
  scoreExpired: 'Score submit chese time ayipoyindi (10 minutes).',
  share: 'Score card share cheyyandi',
  shareLine: (c, t, lang) => `Nenu ${lang} lo ${c}/${t} score chesanu. Dammunte beat cheyyandi!`,
  shareSaved: 'Score card download ayindi.',
  playAgain: 'Malli aadandi',
  noGamesLeft: 'E session games ayipoyayi. Kotta session kosam Home ki vellandi.',

  today: 'Eroju',
  allTime: 'All time',
  boardEmpty: 'Inka scores levu. First meere avvandi!',
  boardFailed: 'Leaderboard load kaledu.',
  rank: '#',
  player: 'Player',

  settingsTitle: 'Settings',
  voiceVolume: 'Voice volume',
  sfx: 'Sound effects',
  music: 'Music',
  language: 'Language',

  problems: {
    offline: { title: 'Internet ledu', body: 'Mic Drop Arcade aadataniki internet kavali. Connection check chesi malli try cheyyandi.' },
    connection_lost: {
      title: 'Connection poyindi',
      body: 'Game madhyalo network poyindi, anduke e game ended. Connection vachaka kotta game start cheyyandi.',
    },
    closed_for_today: { title: 'Erojuki closed', body: 'Eroju limit ayipoyindi. Repu malli randi!' },
    maintenance: { title: 'Kasepatlo back', body: 'Arcade lo work jarugutundi. Kasepu aagi try cheyyandi.' },
    unavailable: { title: 'Server busy', body: 'Ippudu server reach kaledu. Kasepatlo malli try cheyyandi.' },
    bot_check_failed: { title: 'Check fail ayindi', body: 'Meeru human ani confirm cheyyalekapoyam. Malli try cheyyandi.' },
    bot_check_unreachable: {
      title: 'Check load kaledu',
      body: 'Security check load kaledu. Ad blocker leda network check chesi malli try cheyyandi.',
    },
    rate_limited: { title: 'Kasta aagandi', body: 'Chala fast ga try chestunnaru.' },
    forbidden_origin: { title: 'Wrong address', body: 'Game ni official address nundi open cheyyandi.' },
    unauthorized: { title: 'Session ayipoyindi', body: 'Mee session expire ayindi. Malli START nokkandi.' },
    already_connected: {
      title: 'Vere tab lo open ga undi',
      body: 'E game vere tab lo nadustundi. Akkada aadandi, leda daanni close chesi ikkada try cheyyandi.',
    },
    session_limit: { title: 'Session games ayipoyayi', body: 'Oka session lo inni games matrame. Kotta session start cheyyandi.' },
    audio_limit: { title: 'Eroju play limit purti', body: 'Erojuki chala aadaru. Repu malli randi!' },
    idle: { title: 'Nidrapoyara?', body: 'Chala sepu emi jaragaledu, anduke connection close ayindi.' },
    busy: { title: 'Ippudu chala mandi players', body: 'Anni machines busy. Oka minute lo malli try cheyyandi.' },
    unknown_pack: { title: 'Pack dorakaledu', body: 'E pack ippudu available ledu. Verodi select cheyyandi.' },
    unknown_character: { title: 'Hero dorakaledu', body: 'Screen meeda unna heroes lo okarini select cheyyandi.' },
    unknown_adventure: { title: 'Adventure dorakaledu', body: 'List lo nundi vere adventure select cheyyandi.' },
    unknown_language: { title: 'Language dorakaledu', body: 'Screen meeda unna languages lo okati select cheyyandi.' },
    protocol: { title: 'Connection close ayindi', body: 'Edo problem vachindi. Page reload chesi malli try cheyyandi.' },
    internal: { title: 'Edo problem vachindi', body: 'Maa side problem undi. Page reload chesi malli try cheyyandi.' },
    mic_denied: {
      title: 'Mic permission kavali',
      body: 'E game matladi matrame aadataru. Browser site settings lo microphone allow chesi malli try cheyyandi.',
    },
    mic_missing: { title: 'Mic dorakaledu', body: 'E device lo microphone dorakaledu. Mic leda headset petti malli try cheyyandi.' },
    mic_busy: { title: 'Mic busy', body: 'Vere app mic use chestondi. Daanni close chesi malli try cheyyandi.' },
    mic_lost: { title: 'Mic disconnect ayindi', body: 'Game madhyalo mic aagipoyindi. Mic check chesi kotta game start cheyyandi.' },
    unsupported: {
      title: 'E browser panicheyadu',
      body: 'Mic Drop Arcade ki latest Chrome leda Safari, HTTPS, microphone kavali.',
    },
  },
  rateLimited: (s) => `${s} seconds lo malli try cheyyandi.`,
};

const STRINGS: Record<LanguageCode, Strings> = {
  'te-IN': telugu,
  'hi-IN': hindi,
  'hi-en': hinglish,
  'te-en': tenglish,
  'en-IN': english,
};

export function stringsFor(language: LanguageCode): Strings {
  return STRINGS[language];
}
