import { expect, test } from 'bun:test';
import { installClicks, uiSound, type UiSound } from '../src/ui/click';

test('a dragged slider ticks at most every 70 ms; presses always click', () => {
  const heard: UiSound[] = [];
  // No document here: only the sound hook is set.
  (globalThis as { document?: unknown }).document ??= { addEventListener() {} };
  installClicks((k) => heard.push(k));
  uiSound('tick');
  uiSound('tick');
  uiSound('press');
  uiSound('press');
  expect(heard).toEqual(['tick', 'press', 'press']);
});
