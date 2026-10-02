import { expect, test } from 'bun:test';
import { installClicks, uiSound, type UiSound } from '../src/ui/click';

test('a dragged slider ticks at most every 70 ms; presses always click', () => {
  const heard: UiSound[] = [];
  // No page here: a stand-in document, so only the sound hook is set.
  const g = globalThis as { document?: unknown };
  const was = g.document;
  g.document = { addEventListener() {} };
  try {
    installClicks((k) => heard.push(k));
  } finally {
    g.document = was;
  }
  uiSound('tick');
  uiSound('tick');
  uiSound('press');
  uiSound('press');
  expect(heard).toEqual(['tick', 'press', 'press']);
});
