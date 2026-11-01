/**
 * On-screen text for adventures (PROTOCOL §10), in the five game languages. Kept apart from
 * i18n.ts so the quiz strings and the adventure strings can be reviewed separately. Hinglish
 * and Tenglish are written in Latin script, the way students type them.
 */
import type { Genre, LanguageCode, Rank, Wizard } from './protocol/messages';

export interface AdvStrings {
  letWizardChoose: string;
  letWizardChooseBody: string;
  orPick: string;
  endingsFound: (found: number, total: number) => string;
  best: (score: number, time: string) => string;
  genres: Record<Genre, string>;
  wizardBlurbs: Record<Wizard, string>;
  makeTitle: string;
  makeBody: string;
  comingSoon: string;

  sayChoice: string;
  sayAnswer: string;
  unclear: string;
  triesLeft: (n: number) => string;
  wizardPicked: string;
  riddle: string;
  got: (item: string) => string;
  bag: string;
  step: (n: number) => string;
  meterAria: (label: string, n: number, max: number) => string;

  endingReached: string;
  ranks: Record<Rank, string>;
  time: string;
  yourPath: string;
  newBest: string;
  placed: (rank: number) => string;
  moreEndings: (found: number, total: number) => string;
  playAgain: string;
  newAdventure: string;
  shareLine: (adventure: string, ending: string, score: number, time: string) => string;
  cardReached: string;
  cardChallenge: string;
  boardTime: string;
  boardEnding: string;
  allAdventures: string;
}

const english: AdvStrings = {
  letWizardChoose: 'Let the wizard choose',
  letWizardChooseBody: 'Answer two questions and the wizard opens the right door for you.',
  orPick: 'Or pick an adventure',
  endingsFound: (f, t) => `Endings ${f}/${t}`,
  best: (s, time) => `Best ${s} in ${time}`,
  genres: {
    prologue: "Wizard's pick",
    action: 'Action',
    romance: 'Romance',
    mystery: 'Mystery',
    scifi: 'Sci-fi',
    horror: 'Spooky',
    fantasy: 'Fantasy',
    riddle: 'Riddles',
    comedy: 'Comedy',
    thriller: 'Thriller',
  },
  wizardBlurbs: {
    sorceress: 'Warm and kind',
    sage: 'Old and wise',
    owl: 'Smart and nerdy',
    enchantress: 'Charming and flirty',
    trickster: 'Sly and tricky',
  },
  makeTitle: 'Make your own adventure',
  makeBody: 'Describe a story and the wizard writes it for you, live.',
  comingSoon: 'Coming soon',

  sayChoice: 'Say the number or the words on a card',
  sayAnswer: 'Say your answer',
  unclear: "Didn't catch that",
  triesLeft: (n) => (n === 1 ? 'One more try' : `${n} more tries`),
  wizardPicked: 'The wizard chose for you',
  riddle: 'Riddle',
  got: (item) => `Got: ${item}`,
  bag: 'Bag',
  step: (n) => `Step ${n}`,
  meterAria: (label, n, max) => `${label}: ${n} of ${max}`,

  endingReached: 'Ending reached',
  ranks: { gold: 'Gold ending', silver: 'Silver ending', bronze: 'Bronze ending' },
  time: 'Time',
  yourPath: 'Your path',
  newBest: 'New personal best!',
  placed: (r) => `You're #${r} on the leaderboard!`,
  moreEndings: (f, t) => `${f} of ${t} endings found. Play again for a different one!`,
  playAgain: 'Play again',
  newAdventure: 'New adventure',
  shareLine: (adv, end, s, time) =>
    `I reached "${end}" in ${adv} on Mic Drop Arcade: ${s} points in ${time}. Beat me!`,
  cardReached: 'ENDING REACHED',
  cardChallenge: 'Can you beat me?',
  boardTime: 'Time',
  boardEnding: 'Ending',
  allAdventures: 'All adventures',
};

const hinglish: AdvStrings = {
  letWizardChoose: 'Wizard ko choose karne do',
  letWizardChooseBody: 'Do sawaal ka jawab do, wizard tumhare liye sahi darwaza kholega.',
  orPick: 'Ya khud adventure chuno',
  endingsFound: (f, t) => `Endings ${f}/${t}`,
  best: (s, time) => `Best ${s}, ${time} mein`,
  genres: {
    prologue: 'Wizard ki choice',
    action: 'Action',
    romance: 'Romance',
    mystery: 'Mystery',
    scifi: 'Sci-fi',
    horror: 'Darawna',
    fantasy: 'Fantasy',
    riddle: 'Paheliyan',
    comedy: 'Comedy',
    thriller: 'Thriller',
  },
  wizardBlurbs: {
    sorceress: 'Pyaari aur caring',
    sage: 'Buzurg aur samajhdaar',
    owl: 'Smart aur nerdy',
    enchantress: 'Charming aur flirty',
    trickster: 'Chalaak aur shararti',
  },
  makeTitle: 'Apna adventure banao',
  makeBody: 'Story batao, wizard live likh dega.',
  comingSoon: 'Jaldi aa raha hai',

  sayChoice: 'Card ka number ya uske words bolo',
  sayAnswer: 'Apna jawab bolo',
  unclear: 'Samajh nahi aaya',
  triesLeft: (n) => (n === 1 ? 'Ek aur try' : `${n} aur try`),
  wizardPicked: 'Wizard ne tumhare liye chuna',
  riddle: 'Paheli',
  got: (item) => `Mila: ${item}`,
  bag: 'Bag',
  step: (n) => `Step ${n}`,
  meterAria: (label, n, max) => `${label}: ${max} mein se ${n}`,

  endingReached: 'Ending mil gayi',
  ranks: { gold: 'Gold ending', silver: 'Silver ending', bronze: 'Bronze ending' },
  time: 'Time',
  yourPath: 'Tumhara raasta',
  newBest: 'Naya personal best!',
  placed: (r) => `Leaderboard pe #${r}!`,
  moreEndings: (f, t) => `${t} mein se ${f} endings mili. Dobara khelo, nayi ending dhoondo!`,
  playAgain: 'Dobara khelo',
  newAdventure: 'Naya adventure',
  shareLine: (adv, end, s, time) =>
    `Maine Mic Drop Arcade pe ${adv} mein "${end}" ending paayi: ${s} points, ${time} mein. Harao mujhe!`,
  cardReached: 'ENDING MIL GAYI',
  cardChallenge: 'Mujhe hara sakte ho?',
  boardTime: 'Time',
  boardEnding: 'Ending',
  allAdventures: 'Saare adventures',
};

// Filled in below from the reviewed translations (hi-IN, te-IN, te-en).
// TRANSLATIONS-START
const hindi: AdvStrings = {
  letWizardChoose: 'विज़ार्ड को चुनने दो',
  letWizardChooseBody: 'दो सवालों के जवाब दो, विज़ार्ड तुम्हारे लिए सही दरवाज़ा खोल देगा।',
  orPick: 'या खुद एडवेंचर चुनो',
  endingsFound: (f, t) => `एंडिंग ${f}/${t}`,
  best: (s, time) => `बेस्ट ${s}, ${time} में`,
  genres: {
    prologue: 'विज़ार्ड की पसंद',
    action: 'एक्शन',
    romance: 'रोमांस',
    mystery: 'मिस्ट्री',
    scifi: 'साइ-फ़ाई',
    horror: 'डरावना',
    fantasy: 'फ़ैंटेसी',
    riddle: 'पहेलियाँ',
    comedy: 'कॉमेडी',
    thriller: 'थ्रिलर',
  },
  wizardBlurbs: {
    sorceress: 'प्यारी और केयरिंग',
    sage: 'बुज़ुर्ग और समझदार',
    owl: 'स्मार्ट और नर्डी',
    enchantress: 'चार्मिंग और फ़्लर्टी',
    trickster: 'चालाक और शरारती',
  },
  makeTitle: 'अपना एडवेंचर बनाओ',
  makeBody: 'कहानी बताओ, विज़ार्ड लाइव लिख देगा।',
  comingSoon: 'जल्द आ रहा है',

  sayChoice: 'कार्ड का नंबर या उस पर लिखे शब्द बोलो',
  sayAnswer: 'अपना जवाब बोलो',
  unclear: 'समझ नहीं आया',
  triesLeft: (n) => (n === 1 ? 'एक और कोशिश' : `${n} और कोशिशें`),
  wizardPicked: 'विज़ार्ड ने तुम्हारे लिए चुना',
  riddle: 'पहेली',
  got: (item) => `मिला: ${item}`,
  bag: 'बैग',
  step: (n) => `स्टेप ${n}`,
  meterAria: (label, n, max) => `${label}: ${max} में से ${n}`,

  endingReached: 'एंडिंग मिल गई',
  ranks: { gold: 'गोल्ड एंडिंग', silver: 'सिल्वर एंडिंग', bronze: 'ब्रॉन्ज़ एंडिंग' },
  time: 'समय',
  yourPath: 'तुम्हारा रास्ता',
  newBest: 'नया पर्सनल बेस्ट!',
  placed: (r) => `लीडरबोर्ड पर #${r}!`,
  moreEndings: (f, t) => `${t} में से ${f} एंडिंग मिलीं। दोबारा खेलो, नई एंडिंग ढूँढो!`,
  playAgain: 'दोबारा खेलो',
  newAdventure: 'नया एडवेंचर',
  shareLine: (adv, end, s, time) =>
    `Mic Drop Arcade पर ${adv} में "${end}" एंडिंग मिली: ${s} पॉइंट, ${time} में। हराओ मुझे!`,
  cardReached: 'ENDING MIL GAYI',
  cardChallenge: 'Mujhe hara sakte ho?',
  boardTime: 'समय',
  boardEnding: 'एंडिंग',
  allAdventures: 'सारे एडवेंचर',
};

const telugu: AdvStrings = {
  letWizardChoose: 'విజార్డ్ ఎంచుకోనివ్వు',
  letWizardChooseBody: 'రెండు ప్రశ్నలకు జవాబు చెప్పు, విజార్డ్ నీకు సరైన తలుపు తెరుస్తాడు.',
  orPick: 'లేదా నువ్వే అడ్వెంచర్ ఎంచుకో',
  endingsFound: (f, t) => `ఎండింగ్స్ ${f}/${t}`,
  best: (s, time) => `బెస్ట్ ${s}, ${time}లో`,
  genres: {
    prologue: 'విజార్డ్ ఎంపిక',
    action: 'యాక్షన్',
    romance: 'రొమాన్స్',
    mystery: 'మిస్టరీ',
    scifi: 'సైన్స్ ఫిక్షన్',
    horror: 'భయానకం',
    fantasy: 'ఫాంటసీ',
    riddle: 'పొడుపు కథలు',
    comedy: 'కామెడీ',
    thriller: 'థ్రిల్లర్',
  },
  wizardBlurbs: {
    sorceress: 'ప్రేమగా, కేరింగ్ గా',
    sage: 'పెద్దాయన, జ్ఞాని',
    owl: 'స్మార్ట్, నెర్డీ',
    enchantress: 'చార్మింగ్, ఫ్లర్టీ',
    trickster: 'జిత్తులమారి, అల్లరి',
  },
  makeTitle: 'నీ సొంత అడ్వెంచర్ చేసుకో',
  makeBody: 'కథ చెప్పు, విజార్డ్ లైవ్ గా రాసేస్తాడు.',
  comingSoon: 'త్వరలో వస్తోంది',

  sayChoice: 'కార్డ్ మీద నంబర్ లేదా పదాలు చెప్పు',
  sayAnswer: 'నీ జవాబు చెప్పు',
  unclear: 'అర్థం కాలేదు',
  triesLeft: (n) => (n === 1 ? 'ఇంకో ప్రయత్నం' : `ఇంకా ${n} ప్రయత్నాలు`),
  wizardPicked: 'విజార్డ్ నీ కోసం ఎంచుకున్నాడు',
  riddle: 'పొడుపు కథ',
  got: (item) => `దొరికింది: ${item}`,
  bag: 'బ్యాగ్',
  step: (n) => `స్టెప్ ${n}`,
  meterAria: (label, n, max) => `${label}: ${max}లో ${n}`,

  endingReached: 'ఎండింగ్ దొరికింది',
  ranks: { gold: 'గోల్డ్ ఎండింగ్', silver: 'సిల్వర్ ఎండింగ్', bronze: 'బ్రాంజ్ ఎండింగ్' },
  time: 'సమయం',
  yourPath: 'నీ దారి',
  newBest: 'కొత్త పర్సనల్ బెస్ట్!',
  placed: (r) => `లీడర్ బోర్డ్ లో #${r}!`,
  moreEndings: (f, t) => `${t}లో ${f} ఎండింగ్స్ దొరికాయి. మళ్ళీ ఆడి కొత్తది వెతుకు!`,
  playAgain: 'మళ్ళీ ఆడు',
  newAdventure: 'కొత్త అడ్వెంచర్',
  shareLine: (adv, end, s, time) =>
    `Mic Drop Arcade లో ${adv}లో "${end}" ఎండింగ్ దొరికింది: ${s} పాయింట్లు, ${time}లో. నన్ను ఓడించు!`,
  cardReached: 'ENDING DORIKINDI',
  cardChallenge: 'Nannu odinchagalava?',
  boardTime: 'సమయం',
  boardEnding: 'ఎండింగ్',
  allAdventures: 'అన్ని అడ్వెంచర్లు',
};

const tenglish: AdvStrings = {
  letWizardChoose: 'Wizard ni choose cheyyanivvu',
  letWizardChooseBody: 'Rendu questions ki answer ivvu, wizard nee kosam sariyaina door open chestadu.',
  orPick: 'Leda nuvvu adventure pick chesko',
  endingsFound: (f, t) => `Endings ${f}/${t}`,
  best: (s, time) => `Best ${s}, ${time} lo`,
  genres: {
    prologue: 'Wizard pick',
    action: 'Action',
    romance: 'Romance',
    mystery: 'Mystery',
    scifi: 'Sci-fi',
    horror: 'Bhayam',
    fantasy: 'Fantasy',
    riddle: 'Riddles',
    comedy: 'Comedy',
    thriller: 'Thriller',
  },
  wizardBlurbs: {
    sorceress: 'Preminchey, caring',
    sage: 'Pedda, telivaina',
    owl: 'Smart and nerdy',
    enchantress: 'Charming and flirty',
    trickster: 'Jittulamari, allari',
  },
  makeTitle: 'Nee own adventure create chesuko',
  makeBody: 'Story cheppu, wizard live lo rasestadu.',
  comingSoon: 'Tvaralo vastundi',

  sayChoice: 'Card meeda number leda words cheppu',
  sayAnswer: 'Nee answer cheppu',
  unclear: 'Artham kaaledu',
  triesLeft: (n) => (n === 1 ? 'Inko try' : `Inka ${n} tries`),
  wizardPicked: 'Wizard nee kosam choose chesadu',
  riddle: 'Podupu katha',
  got: (item) => `Dorikindi: ${item}`,
  bag: 'Bag',
  step: (n) => `Step ${n}`,
  meterAria: (label, n, max) => `${label}: ${max} lo ${n}`,

  endingReached: 'Ending dorikindi',
  ranks: { gold: 'Gold ending', silver: 'Silver ending', bronze: 'Bronze ending' },
  time: 'Time',
  yourPath: 'Nee daari',
  newBest: 'Kotha personal best!',
  placed: (r) => `Leaderboard lo #${r}!`,
  moreEndings: (f, t) => `${t} lo ${f} endings dorikayi. Malli aadi kothadi vetuku!`,
  playAgain: 'Malli aadu',
  newAdventure: 'Kotha adventure',
  shareLine: (adv, end, s, time) =>
    `Mic Drop Arcade lo ${adv} lo "${end}" ending dorikindi: ${s} points, ${time} lo. Nannu odinchu!`,
  cardReached: 'ENDING DORIKINDI',
  cardChallenge: 'Nannu odinchagalava?',
  boardTime: 'Time',
  boardEnding: 'Ending',
  allAdventures: 'Anni adventures',
};
// TRANSLATIONS-END

const ADV: Record<LanguageCode, AdvStrings> = {
  'en-IN': english,
  'hi-en': hinglish,
  'hi-IN': hindi,
  'te-IN': telugu,
  'te-en': tenglish,
};

export function advStringsFor(language: LanguageCode): AdvStrings {
  return ADV[language];
}

/** "1:07" — run times on the score screen, board and card. */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
