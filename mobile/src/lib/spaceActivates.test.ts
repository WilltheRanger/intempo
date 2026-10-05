import { describe, expect, it } from 'vitest';

import { activatesOnSpace, type RoleBearer } from './spaceActivates';

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
