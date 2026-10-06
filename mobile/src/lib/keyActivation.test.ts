import { describe, expect, it } from 'vitest';

import { activatesOnEnter, activatesOnSpace, type RoleBearer } from './keyActivation';

const el = (tagName: string, attributes: Record<string, string> = {}): RoleBearer => ({
  tagName,
  getAttribute: (name) => attributes[name] ?? null,
});

describe('which elements Space presses', () => {
  it('presses the roles the ARIA patterns give Space to', () => {
    for (const role of ['switch', 'checkbox', 'radio', 'tab', 'option']) {
      expect(activatesOnSpace(el('DIV', { role })), role).toBe(true);
    }
  });

  it('leaves buttons to react-native-web, which already presses them', () => {
    expect(activatesOnSpace(el('DIV', { role: 'button' }))).toBe(false);
    expect(activatesOnSpace(el('DIV', { role: 'link' }))).toBe(false);
  });

  it('leaves native form controls to the browser', () => {
    // A Switch's own checkbox toggles itself; pressing it again would undo it.
    expect(activatesOnSpace(el('INPUT', { role: 'switch' }))).toBe(false);
    expect(activatesOnSpace(el('BUTTON', { role: 'tab' }))).toBe(false);
  });

  it('does nothing for a disabled control or an element with no role', () => {
    expect(activatesOnSpace(el('DIV', { role: 'radio', 'aria-disabled': 'true' }))).toBe(false);
    expect(activatesOnSpace(el('DIV'))).toBe(false);
  });
});

describe('which elements Enter presses', () => {
  it('follows a link drawn as anything but an <a>', () => {
    expect(activatesOnEnter(el('DIV', { role: 'link' }))).toBe(true);
  });

  it('leaves a real <a> to the browser, which already follows it', () => {
    expect(activatesOnEnter(el('A', { role: 'link' }))).toBe(false);
  });

  it('leaves buttons and the rest to react-native-web, which already presses them', () => {
    for (const role of ['button', 'switch', 'tab']) {
      expect(activatesOnEnter(el('DIV', { role })), role).toBe(false);
    }
    expect(activatesOnEnter(el('DIV'))).toBe(false);
  });

  it('does nothing for a disabled link', () => {
    expect(activatesOnEnter(el('DIV', { role: 'link', 'aria-disabled': 'true' }))).toBe(false);
  });
});
