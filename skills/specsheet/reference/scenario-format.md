# Scenario format

A scenario file is a Playwright test with one addition: every step says which screen and
state it lands on. Files live in `handoff/<TICKET-KEY>/scenarios/` and end in
`.scenario.js` (or `.scenario.ts`).

## Example

```js
import { expect, flow, scenario } from 'specsheet';

flow(
  'Contact form',
  {
    states: {
      'help/contact': ['ready', 'invalid-email', 'sending', 'sent', 'send-failed'],
    },
  },
  () => {
    scenario('Sending fails', { covers: ['R4'] }, async ({ page, step }) => {
      await step('Given I am on the Help page', { screen: 'help/contact', state: 'ready' }, async () => {
        await page.goto('/help');
        await expect(page.getByRole('heading', { name: 'Contact us' })).toBeVisible();
      });

      await step('When I send a valid message while the server is down', { screen: 'help/contact', state: 'send-failed' }, async () => {
        await page.route('**/api/contact', (route) => route.fulfill({ status: 500 }));
        await page.getByLabel('Name').fill('Sam Rivera');
        await page.getByLabel('Email').fill('sam@example.com');
        await page.getByLabel('Message').fill('How do I export my projects?');
        await page.getByRole('button', { name: 'Send message' }).click();
      });

      await step('Then I see that sending failed and my message is still there', { screen: 'help/contact', state: 'send-failed' }, async () => {
        await expect(page.getByText("We couldn't send your message.")).toBeVisible();
        await expect(page.getByLabel('Message')).toHaveValue('How do I export my projects?');
      });
    });
  },
);
```

## The three calls

**`flow(name, options, body)`** groups the scenarios for one user flow.

- `states` lists every state each screen should have, including ones the design does not
  show yet. Decide this from the code: a screen that loads data needs loading, empty and
  error states; a form needs invalid, submitting, success and failure states; a list
  needs none, one and many.
- `notApplicable` maps `"screen/state"` to the reason a state does not apply. Use it only
  when the user agrees.

**`scenario(title, options, body)`** is one Gherkin scenario.

- `covers` lists the ids of the requirements this scenario proves.
- The body receives `{ page, step, context, request }`. `page` is a normal Playwright page.

**`step(title, options, body)`** is one Gherkin line.

- `title` starts with Given, When, Then, And or But.
- `screen` and `state` name where the step lands. A "When" step names the state its
  action leads to.
- `capture` is `'page'` (the default, the whole page), `'viewport'` (only what is
  visible, for dialogs, menus and toasts) or `'none'`.

## Rules

These are not style preferences. The program reads the source text of these files, and
the handoff is built from it.

1. **Write titles, screens, states and ids as plain quoted strings.** No variables, no
   template strings, no string joins. The size check reads them as text.
2. **Put the options before the function.** `step('...', { screen: '...', state: '...' }, async () => { ... })`.
3. **Every "Then" step needs at least one `expect`.** A "Then" with no check is reported
   as unverified.
4. **Check what the user would see.** Use `toBeVisible`, `toContainText`, `toHaveValue`,
   `toBeEnabled` and similar. Never use `waitForTimeout` in place of a check.
5. **Find elements the way a person would.** Prefer `getByRole`, `getByLabel` and
   `getByText`. If an element can only be found by a CSS class or test id, say so to the
   user: it usually means the control has no accessible name.
6. **One behaviour per scenario, three to seven steps.** Start each scenario from a
   "Given" that navigates to its starting screen, so scenarios do not depend on each other.
   Word that opening step exactly the same in every scenario that shares it. The handoff
   then states it once, as a `Background`, instead of repeating it.
7. **Force states with the network, not by editing the prototype.** Use `page.route` to
   return an empty list, an error or a slow response.
8. **Write step titles in the user's words.** "When I pay with a card the bank declines",
   not "When POST /pay returns 402".
9. **Name screens by where they are and states by what is true.** `checkout/payment`
   with `ready`, `submitting`, `card-declined`. Use the same name every time the same
   screen and state appears, in every scenario.
10. **Do not take screenshots or record anything yourself.** The program does both.

## Screens behind a sign-in

Before you write a scenario for a screen that needs a signed-in user, ask how the
prototype handles signing in. In order of preference:

1. **The prototype needs no sign-in,** or has a mock user built in. Nothing to do.
2. **Fake the session with the network.** Use `page.route` to answer the request the app
   makes to find out who is signed in, the same way rule 7 forces other states.
3. **Sign in as a test account** in an opening step, "Given I am signed in as a test
   user", worded the same in every scenario. Read the name and password from environment
   variables the user sets in their own terminal, for example
   `process.env.SPECSHEET_USER` and `process.env.SPECSHEET_PASSWORD`.

Never write a password, token or cookie into a scenario file, `specsheet.config.json` or
the conversation, and never ask the user to paste one. A real account's data appears in
the screenshots and videos, so treat it as real data: set `"data": "real"` and give the
warning that goes with it.

## How screenshots are chosen

The program takes a screenshot after every step. When several steps in a row land on the
same screen and state, the handoff shows the one taken after the last of them, when the
page has settled and the checks have passed. So a "When" followed by its "Then" share one
screenshot, shown beside the "Then". The handoff page shows each screen and state once: a
later step that lands on one shown earlier links back to that picture.

## Screen sizes

Scenarios do not set a screen size. It comes from `viewports` in `specsheet.config.json`,
and with two sizes every scenario runs twice. If a mobile layout behaves differently, for
example a menu hidden behind a button, write a separate scenario for it and tell the user
that this adds to the cost.
