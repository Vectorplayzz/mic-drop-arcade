import type { Strings } from '../i18n';
import type { Language } from '../net/api';
import type { Prefs } from '../prefs';
import type { LanguageCode } from '../protocol/messages';
import { button, h } from './dom';

function openDialog(title: string, t: Strings, ...content: HTMLElement[]): HTMLDialogElement {
  const dialog = h(
    'dialog',
    { class: 'dialog', attrs: { 'aria-labelledby': 'dialog-title' } },
    h('h2', { class: 'screen-title', text: title, attrs: { id: 'dialog-title' } }),
    ...content,
  );
  dialog.append(button(t.close, () => dialog.close(), { class: 'btn-primary' }));
  dialog.addEventListener('close', () => dialog.remove());
  // A tap on the dimmed area outside the panel closes it.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

export function privacyDialog(t: Strings): void {
  openDialog(
    t.privacyTitle,
    t,
    h('div', { class: 'prose' }, ...t.privacyBody.map((text) => h('p', { text }))),
  );
}

export interface SettingsOptions {
  t: Strings;
  prefs: Prefs;
  languages: Language[];
  language: LanguageCode;
  /** Called on every change; language changes close the dialog so the page can re-render. */
  onChange(prefs: Prefs, language: LanguageCode): void;
}

export function settingsDialog(o: SettingsOptions): void {
  const { t } = o;
  const prefs = { ...o.prefs };
  let language = o.language;
  const emit = (): void => o.onChange({ ...prefs }, language);

  const volume = h('input', {
    attrs: {
      id: 'voice-volume',
      type: 'range',
      min: 0,
      max: 100,
      step: 5,
      value: Math.round(prefs.voiceVolume * 100),
    },
    on: {
      input: () => {
        prefs.voiceVolume = Number(volume.value) / 100;
        emit();
      },
    },
  });

  const toggle = (id: string, label: string, key: 'sfx' | 'music'): HTMLElement => {
    const box = h('input', {
      attrs: { id, type: 'checkbox', checked: prefs[key] },
      on: {
        change: () => {
          prefs[key] = box.checked;
          emit();
        },
      },
    });
    return h('div', { class: 'field field-row' }, box, h('label', { text: label, attrs: { for: id } }));
  };

  const select = h(
    'select',
    {
      class: 'input',
      attrs: { id: 'language' },
      on: {
        change: () => {
          language = select.value as LanguageCode;
          dialog.close();
          emit();
        },
      },
    },
    ...o.languages.map((item) =>
      h('option', { text: item.label, attrs: { value: item.code, selected: item.code === language } }),
    ),
  );

  const dialog = openDialog(
    t.settingsTitle,
    t,
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'label', text: t.language, attrs: { for: 'language' } }),
      select,
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'label', text: t.voiceVolume, attrs: { for: 'voice-volume' } }),
      volume,
    ),
    toggle('sfx-on', t.sfx, 'sfx'),
    toggle('music-on', t.music, 'music'),
  );
}
