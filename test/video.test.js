import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scrollToward } from '../src/index.js';

// `scrollToward` runs in the page. Here it runs against a stand-in for the page: a
// window 1280 wide and 800 high, over a page 4000 high.
function page() {
  const calls = { scrollTo: [], scrollIntoView: 0 };
  const saved = {};
  const fakes = {
    window: { innerWidth: 1280, innerHeight: 800, scrollY: 0, scrollTo: (to) => calls.scrollTo.push(to.top) },
    document: { documentElement: {}, scrollingElement: { scrollHeight: 4000 } },
    getComputedStyle: (node) => node.style,
    requestAnimationFrame: (run) => setTimeout(() => run(performance.now()), 1),
  };
  for (const [name, value] of Object.entries(fakes)) {
    saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  const restore = () => {
    for (const [name, was] of Object.entries(saved)) {
      if (was) Object.defineProperty(globalThis, name, was);
      else delete globalThis[name];
    }
  };
  const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const element = (rect, parent = null) => ({
    getBoundingClientRect: () => rect,
    scrollIntoView: () => (calls.scrollIntoView += 1),
    parentElement: parent,
    style: { overflowX: 'visible', overflowY: 'visible' },
  });
  return { calls, restore, box, element };
}

test('the video: what is already in view is left where it is', () => {
  const { restore, box, element } = page();
  try {
    assert.equal(scrollToward(element(box(100, 200, 300, 60)), 0), false);
    // Something that is not drawn has nowhere to scroll to.
    assert.equal(scrollToward(element(box(0, 0, 0, 0)), 0), false);
    // Taller than the screen and filling most of it.
    assert.equal(scrollToward(element(box(100, -300, 600, 1500)), 0), false);
    // Wider than the window, with part of it showing.
    assert.equal(scrollToward(element(box(-200, 200, 2000, 60)), 0), false);
  } finally {
    restore();
  }
});

test('the video: the page scrolls to what is below the screen or under the caption', async () => {
  const { calls, restore, box, element } = page();
  try {
    // Far down the page: it ends up in the middle of the screen.
    assert.equal(await scrollToward(element(box(100, 2000, 300, 40)), 0), true);
    assert.equal(calls.scrollTo.at(-1), 2000 + 20 - 400);
    assert.ok(calls.scrollTo.length > 3, 'the page moves a little at a time');
    assert.ok(calls.scrollTo.every((top, index) => index === 0 || top >= calls.scrollTo[index - 1]), 'and only one way');

    // On screen, but where the caption sits.
    calls.scrollTo.length = 0;
    assert.equal(await scrollToward(element(box(100, 700, 300, 60)), 0), true);
    assert.equal(calls.scrollTo.at(-1), 700 + 30 - 400);
  } finally {
    restore();
  }
});

test('the video: something off to the side is brought in, however tall it is', async () => {
  const { calls, restore, box, element } = page();
  try {
    // Wholly to the right of the window.
    assert.equal(await scrollToward(element(box(1400, 360, 200, 80)), 0), true);
    assert.equal(calls.scrollIntoView, 1);
    // The same for something taller than the screen, which would otherwise count as filling it.
    assert.equal(await scrollToward(element(box(1400, 70, 600, 1500)), 0), true);
    assert.equal(calls.scrollIntoView, 2);
    assert.equal(await scrollToward(element(box(-900, 70, 600, 1500)), 0), true);
    assert.equal(calls.scrollIntoView, 3);
  } finally {
    restore();
  }
});

test('the video: inside a panel that scrolls by itself, the part the panel shows is what counts', async () => {
  const { calls, restore, box, element } = page();
  try {
    const panel = (overflowX, overflowY) => ({ ...element(box(100, 100, 400, 300)), style: { overflowX, overflowY } });
    // Within the window, but below what the panel shows.
    assert.equal(await scrollToward(element(box(120, 450, 200, 40), panel('visible', 'auto')), 0), true);
    assert.equal(calls.scrollIntoView, 1);
    // Beside what a panel that scrolls sideways shows.
    assert.equal(await scrollToward(element(box(600, 200, 200, 40), panel('scroll', 'visible')), 0), true);
    assert.equal(calls.scrollIntoView, 2);
    // A panel that does not scroll hides nothing.
    assert.equal(scrollToward(element(box(120, 450, 200, 40), panel('visible', 'visible')), 0), false);
    // Inside the panel's view.
    assert.equal(scrollToward(element(box(120, 200, 200, 40), panel('auto', 'auto')), 0), false);
  } finally {
    restore();
  }
});
