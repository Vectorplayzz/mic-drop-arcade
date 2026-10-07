/**
 * Creator Mode: write a question pack, check it against the server's rules and save it as a
 * pack file for review. The editor's own labels are in plain English for every language; the
 * pack content is written in whichever script the author chooses.
 */
import {
  type DraftPack,
  type DraftQuestion,
  emptyDraft,
  emptyQuestion,
  type Issue,
  MAX_PACK_BYTES,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  parseDraft,
  serializePack,
  slugify,
  validatePack,
} from '../creator/pack';
import type { Language } from '../net/api';
import { isLanguageCode, type LanguageCode } from '../protocol/messages';
import { button, clear, h, setText } from './dom';
import type { Screen } from './screens';

const DRAFT_KEY = 'maata.creator.draft.v1';

function loadDraft(fallback: LanguageCode): DraftPack {
  try {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) return parseDraft(saved);
  } catch {
    // No saved draft, or one that no longer parses: start fresh.
  }
  return emptyDraft(fallback);
}

function saveDraft(draft: DraftPack): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage unavailable: the draft lives until the tab closes.
  }
}

function download(name: string, contents: string): void {
  const href = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = h('a', { attrs: { href, download: name } });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export interface CreatorOptions {
  languages: Language[];
  language: LanguageCode;
  backLabel: string;
  onBack(): void;
}

export function creatorScreen(o: CreatorOptions): Screen {
  let draft = loadDraft(o.language);
  /** Problems are shown only after the author first asks for a check or a save. */
  let showIssues = false;
  let idTouched = draft.id !== '';

  const title = h('h1', { class: 'screen-title', text: 'Creator Mode', attrs: { tabindex: -1 } });
  const summary = h('p', { class: 'notice', attrs: { role: 'status', 'aria-live': 'polite' } });
  const packFields = h('div', { class: 'creator-pack' });
  const questionList = h('ol', { class: 'creator-questions' });
  const addButton = button('+ Add question', () => {
    draft.questions.push(emptyQuestion(nextNumber()));
    changed();
    renderQuestions();
    questionList.lastElementChild?.querySelector('textarea')?.focus();
  });

  const nextNumber = (): number => {
    const used = new Set(draft.questions.map((q) => q.id));
    let n = draft.questions.length + 1;
    while (used.has(`q${n}`)) n++;
    return n;
  };

  const issuesAt = (issues: Issue[], path: string): string =>
    issues
      .filter((issue) => issue.path === path)
      .map((issue) => issue.message)
      .join(' ');

  /** Refreshes the error text under every field without rebuilding inputs (focus is kept). */
  const refreshIssues = (): Issue[] => {
    const issues = validatePack(draft);
    for (const slot of el.querySelectorAll<HTMLElement>('[data-issue]')) {
      const message = showIssues ? issuesAt(issues, slot.dataset.issue ?? '') : '';
      setText(slot, message);
      const field = slot.previousElementSibling;
      if (field instanceof HTMLElement) field.setAttribute('aria-invalid', String(message !== ''));
    }
    addButton.disabled = draft.questions.length >= MAX_QUESTIONS;
    if (showIssues) {
      summary.classList.toggle('good', issues.length === 0);
      setText(
        summary,
        issues.length === 0
          ? 'This pack passes every check. Save the file and send it in for review.'
          : `${issues.length} thing${issues.length === 1 ? '' : 's'} to fix before this pack can be saved.`,
      );
    }
    return issues;
  };

  const changed = (): void => {
    saveDraft(draft);
    refreshIssues();
  };

  const field = (
    label: string,
    path: string,
    control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    hint = '',
  ): HTMLElement => {
    const id = `f-${path.replaceAll('.', '-')}`;
    control.id = id;
    control.classList.add('input');
    control.setAttribute('aria-describedby', `${id}-issue`);
    return h(
      'div',
      { class: 'field' },
      h('label', { class: 'label', text: label, attrs: { for: id } }),
      hint ? h('p', { class: 'muted', text: hint }) : null,
      control,
      h('p', { class: 'issue', attrs: { id: `${id}-issue`, 'data-issue': path } }),
    );
  };

  const textInput = (value: string, onInput: (value: string) => void, maxlength: number) => {
    const input = h('input', {
      attrs: { type: 'text', value, maxlength, autocomplete: 'off' },
      on: {
        input: () => {
          onInput(input.value);
          changed();
        },
      },
    });
    return input;
  };

  const textArea = (value: string, onInput: (value: string) => void, rows: number) => {
    const area = h('textarea', {
      attrs: { rows },
      on: {
        input: () => {
          onInput(area.value);
          changed();
        },
      },
    });
    area.value = value;
    return area;
  };

  const renderPack = (): void => {
    clear(packFields);
    const idInput = textInput(
      draft.id,
      (v) => {
        draft.id = v;
        idTouched = v !== '';
      },
      48,
    );
    const language = h(
      'select',
      {
        on: {
          change: () => {
            if (isLanguageCode(language.value)) draft.language = language.value;
            if (!idTouched) idInput.value = draft.id = slugify(draft.language, draft.title);
            changed();
          },
        },
      },
      ...o.languages.map((item) =>
        h('option', {
          text: item.label,
          attrs: { value: item.code, selected: item.code === draft.language },
        }),
      ),
    );
    packFields.append(
      field(
        'Pack title',
        'title',
        textInput(
          draft.title,
          (v) => {
            draft.title = v;
            if (!idTouched) idInput.value = draft.id = slugify(draft.language, v);
          },
          60,
        ),
      ),
      field('Language', 'language', language),
      field('Topic', 'topic', textInput(draft.topic, (v) => (draft.topic = v), 40)),
      field('Pack id', 'id', idInput, 'Lowercase letters, digits and hyphens, like te-science-01.'),
    );
  };

  const questionCard = (q: DraftQuestion, i: number): HTMLElement => {
    const at = `questions.${i}`;
    const kind = h(
      'select',
      {
        on: {
          change: () => {
            q.kind = kind.value === 'number' ? 'number' : 'text';
            changed();
          },
        },
      },
      h('option', { text: 'Words', attrs: { value: 'text', selected: q.kind === 'text' } }),
      h('option', { text: 'A number', attrs: { value: 'number', selected: q.kind === 'number' } }),
    );
    const remove = button(
      'Remove',
      () => {
        draft.questions.splice(i, 1);
        changed();
        renderQuestions();
      },
      { class: 'btn-small', ariaLabel: `Remove question ${i + 1}` },
    );
    remove.disabled = draft.questions.length <= 1;
    return h(
      'li',
      { class: 'creator-question' },
      h(
        'div',
        { class: 'creator-question-head' },
        h('h2', { class: 'label', text: `Question ${i + 1}` }),
        remove,
      ),
      field('Question, as it will be spoken', `${at}.prompt`, textArea(q.prompt, (v) => (q.prompt = v), 2)),
      field('The answer is', `${at}.kind`, kind),
      field(
        'Accepted answers',
        `${at}.answers`,
        textArea(q.answers.join('\n'), (v) => (q.answers = v.split('\n')), 3),
        'One per line: every spelling or script a player might say. Numbers in digits.',
      ),
      field(
        'Answer to show and speak',
        `${at}.display_answer`,
        textInput(q.display_answer, (v) => (q.display_answer = v), 80),
      ),
      field(
        'Explanation (optional)',
        `${at}.explanation`,
        textInput(q.explanation, (v) => (q.explanation = v), 200),
      ),
    );
  };

  const renderQuestions = (): void => {
    clear(questionList);
    draft.questions.forEach((q, i) => questionList.append(questionCard(q, i)));
    refreshIssues();
  };

  const check = (): Issue[] => {
    showIssues = true;
    const issues = refreshIssues();
    if (issues.length > 0) {
      el.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
    return issues;
  };

  const fileInput = h('input', {
    class: 'sr-only',
    attrs: { type: 'file', accept: 'application/json,.json', 'aria-label': 'Open a pack file' },
    on: {
      change: () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        if (file.size > MAX_PACK_BYTES) {
          setText(summary, 'That file is larger than 256 KB, so it is not a pack.');
          return;
        }
        void file
          .text()
          .then((text) => {
            draft = parseDraft(text);
            idTouched = draft.id !== '';
            showIssues = true;
            saveDraft(draft);
            renderPack();
            renderQuestions();
          })
          .catch(() => {
            summary.classList.remove('good');
            setText(summary, 'That file is not a Mic Drop Arcade pack.');
          });
      },
    },
  });

  const el = h(
    'section',
    { class: 'screen creator', attrs: { lang: 'en' } },
    title,
    h('p', {
      class: 'lead',
      text: `Write your own quiz: ${MIN_QUESTIONS} to ${MAX_QUESTIONS} questions that can be answered aloud in a word or two.`,
    }),
    h('p', {
      class: 'muted',
      text: 'Your draft is saved on this device only. A person reviews every pack before it can be played, so save the pack file and send it to the Mic Drop Arcade team. Use made-up examples only: no real phone numbers, IDs or personal details.',
    }),
    packFields,
    questionList,
    addButton,
    summary,
    h(
      'nav',
      { class: 'menu' },
      button('Check pack', () => void check(), { class: 'btn-primary' }),
      button('Save pack file', () => {
        if (check().length === 0) download(`${draft.id.trim()}.json`, serializePack(draft));
      }),
      button('Open pack file', () => fileInput.click()),
      button('Start over', () => {
        if (!window.confirm('Clear this draft and start over?')) return;
        draft = emptyDraft(draft.language);
        idTouched = false;
        showIssues = false;
        setText(summary, '');
        saveDraft(draft);
        renderPack();
        renderQuestions();
      }),
      button(o.backLabel, o.onBack),
    ),
    fileInput,
  );

  renderPack();
  renderQuestions();
  return { el, focus: title };
}
