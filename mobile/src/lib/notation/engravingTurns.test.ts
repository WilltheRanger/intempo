import { describe, expect, it } from 'vitest';

import { createTurnQueue } from './engravingTurns';

/** A queue whose pauses end only when the test says the screen has had its turn. */
function queue() {
  const paused: (() => void)[] = [];
  const turns = createTurnQueue((resume) => paused.push(resume));
  const pass = () => {
    const resumes = paused.splice(0);
    resumes.forEach((resume) => resume());
  };
  return { turns, pass, pausing: () => paused.length };
}

describe('createTurnQueue', () => {
  it('grants the first request at once', () => {
    const { turns } = queue();
    const granted: string[] = [];

    turns.request(() => granted.push('a'));

    expect(granted).toEqual(['a']);
  });

  it('grants one turn at a time, in the order they were asked for', () => {
    const { turns, pass } = queue();
    const granted: string[] = [];

    const a = turns.request(() => granted.push('a'));
    const b = turns.request(() => granted.push('b'));
    const c = turns.request(() => granted.push('c'));
    expect(granted).toEqual(['a']);

    a();
    pass();
    expect(granted).toEqual(['a', 'b']);

    b();
    pass();
    expect(granted).toEqual(['a', 'b', 'c']);
    c();
  });

  it('pauses before handing the turn on', () => {
    // The point of the queue: a tap, and the paint of what the last turn drew,
    // come before the next engraving starts.
    const { turns, pass, pausing } = queue();
    const granted: string[] = [];

    const a = turns.request(() => granted.push('a'));
    turns.request(() => granted.push('b'));
    a();

    expect(granted).toEqual(['a']);
    expect(pausing()).toBe(1);
    pass();
    expect(granted).toEqual(['a', 'b']);
  });

  it('takes a request made during the pause in its place behind it', () => {
    const { turns, pass } = queue();
    const granted: string[] = [];

    const a = turns.request(() => granted.push('a'));
    a();
    turns.request(() => granted.push('b'));

    expect(granted).toEqual(['a']);
    pass();
    expect(granted).toEqual(['a', 'b']);
  });

  it('drops a request withdrawn before its turn came', () => {
    // A tile unmounted while it waited — a search started — must not be
    // granted a turn nothing will use, and must not hold up the ones behind it.
    const { turns, pass } = queue();
    const granted: string[] = [];

    const a = turns.request(() => granted.push('a'));
    const b = turns.request(() => granted.push('b'));
    turns.request(() => granted.push('c'));

    b();
    a();
    pass();

    expect(granted).toEqual(['a', 'c']);
  });

  it('does not pause for a request withdrawn before its turn', () => {
    const { turns, pausing } = queue();

    const a = turns.request(() => {});
    const b = turns.request(() => {});
    b();

    expect(pausing()).toBe(0);
    a();
    expect(pausing()).toBe(1);
  });

  it('is unmoved by a second hand-back', () => {
    // A tile gives its turn back when its engraving is on screen and again
    // when it unmounts; the second must not hand on a turn someone else holds.
    const { turns, pass } = queue();
    const granted: string[] = [];

    const a = turns.request(() => granted.push('a'));
    turns.request(() => granted.push('b'));
    const c = turns.request(() => granted.push('c'));

    a();
    pass();
    expect(granted).toEqual(['a', 'b']);

    a();
    pass();
    expect(granted).toEqual(['a', 'b']);
    c();
  });

  it('grants straight away again once the queue has drained', () => {
    const { turns, pass } = queue();
    const granted: string[] = [];

    turns.request(() => granted.push('a'))();
    pass();
    turns.request(() => granted.push('b'));

    expect(granted).toEqual(['a', 'b']);
  });
});
