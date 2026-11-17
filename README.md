<p><img src="assets/logo.svg" alt="specsheet" width="240" height="60"></p>

**Turn a ticket and a design into everything engineering needs.**

You give Claude a ticket and a design that runs in a browser. You get back one handoff:
a user flow, a walkthrough video, and Gherkin or a checklist with a screenshot beside
every step, plus a list of the states the design is missing. Every step has been run
against the design, so the written spec is proven to match it.

Free and open source, under the MIT license.

## Get started

You need [Node](https://nodejs.org) 20 or later and [Claude Code](https://claude.com/claude-code).
Run these in the project that holds your design.

**1. Install it**

```bash
npm install --save-dev github:brendanciccone/specsheet
```

```bash
npx playwright install chromium
```

**2. Give Claude the skill**

```bash
npx specsheet install-skill
```

**3. Ask Claude**

Start a new Claude Code session and say:

> Hand off the contact form for HELP-12 with Specsheet.

That is all. Claude takes it from there.

## What happens next

1. **Claude confirms the setup** in one message: screen size, mock or real data, Gherkin
   or checklist, and one video or several. It asks this every time.
2. **Claude lists the requirements** for you to approve. Each is marked as stated in the
   ticket or inferred from the design.
3. **Claude writes the scenarios** as Given/When/Then steps.
4. **The program runs them.** It performs every step in a hidden browser, checks the
   result, takes a full-page screenshot and records the video. No model is involved, so
   this part costs no tokens.
5. **You see what it found:** failed steps, steps that prove nothing, states no scenario
   reaches, and requirements no scenario covers. You fix or flag each one.
6. **You get the handoff**, and Claude offers to post it to Jira. It always shows a
   preview and waits for your yes, and it posts a comment, never an edit to the ticket.

A design made in Claude Code already runs in a browser. For Claude Design, Paper or
Figma, Claude builds a prototype from the design first.

## What you get

Open `out/handoff.html` in the handoff folder. It is one file you can send to anyone:
the screenshots and the video are inside it, and every section has a copy button for
pasting into Jira or anywhere else. The same content is also written as separate files
for attaching to a ticket. The full list is under [What it produces](#what-it-produces).

For the single walkthrough video, install [ffmpeg](https://ffmpeg.org). Without it you
get one video per scenario, and everything else is the same. To check:

```bash
npx specsheet doctor
```

## See it first

To try it on the example in this repository, with no ticket or design of your own:

```bash
git clone https://github.com/brendanciccone/specsheet.git
```

```bash
cd specsheet
```

```bash
npm install
```

```bash
npx playwright install chromium
```

```bash
npm run example
```

Then open `examples/contact-form/handoff/HELP-12/out/handoff.html`. There is also a
two-minute video of the whole thing at `docs/demo/specsheet-demo.mp4`.

The example is a contact form on a Help page. Its design has no loading state for
sending a message, and the handoff reports that.

## Status

This is a first version. It has been built and checked against the example in this
repository, and has not yet been tried on a real ticket. See [Known limits](#known-limits).

---

The rest of this page is reference. You do not need it to get started.

## The two parts

- **The program** (`bin/`, `src/`) runs scenarios and builds the files. Its only
  dependency is [Playwright](https://playwright.dev).
- **The skill** (`skill/specsheet/`) tells Claude how to drive a handoff from start to
  finish, including the questions to ask you and the rules for posting to Jira.
  `npx specsheet install-skill` copies it to `~/.claude/skills/`. Add `--project` to
  put it in the current project's `.claude/skills/` instead. Run it again after
  updating Specsheet.

## Commands

Claude runs these for you. They are here in case you want to run one yourself.

| Command | What it does |
|---|---|
| `specsheet install-skill` | Gives Claude the Specsheet skill |
| `specsheet doctor` | Says whether `ffmpeg` is installed, which the single walkthrough video needs |
| `specsheet init <folder>` | Creates a handoff folder with starter files |
| `specsheet check <folder>` | Counts what the handoff contains and warns if it is very large. Never blocks |
| `specsheet run <folder>` | Runs every scenario, then builds the handoff files |
| `specsheet run <folder> --fast` | The same without the pauses and captions that make videos watchable. For use while fixing findings |
| `specsheet build <folder>` | Rebuilds the handoff files from the last run, without running anything again |
| `specsheet build <folder> --videos scenario` | The same, with one video per scenario. `flow` gives one walkthrough per flow (the default) and `none` leaves videos out. Also works on `run` |

`specsheet run` exits with 0 when every scenario passed, 1 when a step failed, and 2 when
the run could not start.

## What a scenario looks like

```js
import { expect, flow, scenario } from 'specsheet';

flow('Contact form', { states: { 'help/contact': ['ready', 'sending', 'sent'] } }, () => {
  scenario('Message is sent', { covers: ['R1', 'R3'] }, async ({ page, step }) => {
    await step('Given I am on the Help page', { screen: 'help/contact', state: 'ready' }, async () => {
      await page.goto('/help');
      await expect(page.getByRole('heading', { name: 'Contact us' })).toBeVisible();
    });

    await step('When I send a message with my name, email and text', { screen: 'help/contact', state: 'sent' }, async () => {
      await page.getByLabel('Name').fill('Sam Rivera');
      await page.getByLabel('Email').fill('sam@example.com');
      await page.getByLabel('Message').fill('How do I export my projects?');
      await page.getByRole('button', { name: 'Send message' }).click();
    });

    await step('Then I see a confirmation that my message was sent', { screen: 'help/contact', state: 'sent' }, async () => {
      await expect(page.getByRole('status')).toContainText('Message sent');
    });
  });
});
```

It is a normal Playwright test. The step titles become the Gherkin, the screen and state
names become the boxes in the user flow, and the `expect` lines are what make a step
verified. The full format is in
[skill/specsheet/reference/scenario-format.md](skill/specsheet/reference/scenario-format.md).

## What it produces

Everything lands in `out/` inside the handoff folder.

| File | What it is |
|---|---|
| `handoff.html` | The full handoff as one page. A plain document with copy buttons on every section, so it pastes cleanly into other tools. The user flow can be zoomed and dragged, and any screenshot opens full size. The screenshots and videos are inside the file, so it can be moved or sent on its own |
| `flow.png` | The user flow: screens and states as boxes, actions as arrows |
| `screens/` | One full-page screenshot per screen, state and screen size |
| `videos/` | One captioned walkthrough video per flow, with every scenario in order. The page and the Jira comment list the time each scenario starts |
| `features/` | One Gherkin feature file per flow, for QA to import |
| `checklist.md` | The acceptance checklist |
| `comment.md` | The text for a Jira comment, split into parts if it is too long for one |
| `manifest.json` | Every file to attach, with its size |

Joining scenarios into one video needs `ffmpeg`. Without it, the program writes one
WebM video per scenario and says so, with the command to install it. `specsheet doctor`
checks for it up front, and after installing it `specsheet build` remakes the videos
without running anything again.

## Posting to Jira

The program never talks to Jira. Claude posts through the Jira connection you already
have, following the skill: it shows a preview of the comment and the files, waits for
your yes every time, and posts a comment instead of editing the ticket's description.
With no Jira connection, you paste `comment.md` and attach the files yourself.

## Known limits

- **Not tried on a real ticket.** Posting through a Jira connection, uploading videos,
  and placing screenshots inline in a comment are untested.
- **Only the Claude Code starting point has been run.** The skill covers Claude Design,
  Paper and Figma, but no design from those tools has been through it yet.
- **Scenario files must use plain quoted strings** for titles, screens, states and
  requirement ids. The size check reads them as text.
- **Videos show the visible screen, not the whole page.** When a step uses something
  further down, the video scrolls to it, as it would for a person. The screenshots show
  the full page.
- **The page carries up to 15 MB of video.** Past that, the remaining videos play from the
  `videos/` folder, so the page needs that folder beside it.
- **Developed on macOS.** Other systems should work, since Playwright does, but have not
  been checked.

## Development

```bash
npm test
```

The unit tests cover the parts with no browser: reading scenario files, the size check,
the findings, the Gherkin, the user flow and the Jira comment. `npm run example` checks
the rest end to end.

`node docs/demo/record.mjs` records the demo video again, and `node docs/logo/final.mjs`
redraws the logo files.

## License

[MIT](LICENSE).
