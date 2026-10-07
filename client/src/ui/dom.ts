/**
 * Tiny DOM builder. Text always goes in through `textContent`, never as HTML, so captions,
 * nicknames and anything else the server sends can't inject markup. No inline styles either:
 * the production CSP forbids them.
 */

type Child = Node | string | null | undefined | false;

interface Props {
  class?: string;
  text?: string;
  /** Plain attributes: `aria-*`, `role`, `type`, `for`, `lang`… */
  attrs?: Record<string, string | number | boolean | undefined>;
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const [name, listener] of Object.entries(props.on ?? {})) {
    node.addEventListener(name, listener as EventListener);
  }
  for (const child of children) {
    if (child) node.append(child);
  }
  return node;
}

export function button(
  label: string,
  onClick: () => void,
  options: { class?: string; ariaLabel?: string } = {},
): HTMLButtonElement {
  return h('button', {
    class: `btn ${options.class ?? ''}`.trim(),
    text: label,
    attrs: { type: 'button', 'aria-label': options.ariaLabel },
    on: { click: onClick },
  });
}

export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function clear(node: Element): void {
  node.replaceChildren();
}
