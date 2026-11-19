# Reference

You do not need this page to use Specsheet. The skill runs everything for you.

## The two parts

- **The skill** (`skills/specsheet/`) tells Claude how to drive a handoff from start to
  finish: setting up the project, the questions to ask you, and the rules for posting to
  Jira. The Claude Code plugin in this repository installs it.
- **The program** (`bin/`, `src/`) runs scenarios and builds the files. The skill adds it
  to your project as a dev dependency the first time. Its only dependency is
  [Playwright](https://playwright.dev).

To install the skill without the plugin, add the program to your project yourself and
copy the skill from it. `--project` puts it in the project's `.claude/skills/` instead of
your own:

```bash
npm install --save-dev github:brendanciccone/specsheet
```

```bash
npx specsheet install-skill
```

## Commands

Claude runs these for you.

| Command | What it does |
|---|---|
| `specsheet install-skill [--project]` | Copies the skill to `~/.claude/skills/`, or the project's `.claude/skills/` |
| `specsheet doctor [folder]` | Says whether this computer has what a run needs: a browser that starts, video recording, and `ffmpeg` for the single walkthrough video |
| `specsheet version` | Prints the version |
| `specsheet init <folder>` | Creates a handoff folder with starter files |
| `specsheet check <folder>` | Counts what the handoff contains and warns if it is very large. Never blocks |
| `specsheet run <folder> [--fast]` | Runs every scenario, then builds the handoff files. `--fast` skips the pauses and captions, for use while fixing findings |
| `specsheet build <folder>` | Rebuilds the handoff files from the last run, without running anything again |

`run` and `build` take `--videos flow` (one walkthrough per flow, the default),
`--videos scenario` (one per scenario) or `--videos none`. With `none`, nothing is recorded.

`specsheet run` exits with 0 when every scenario passed, 1 when a step failed, and 2 when
the run could not start.

`specsheet doctor` has its own two: 0 when this computer has what a run needs, and 1 when
it does not, because the browser does not start, or videos are wanted and cannot be
recorded.

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
[skills/specsheet/reference/scenario-format.md](../skills/specsheet/reference/scenario-format.md).

## What it produces

Everything lands in `out/` inside the handoff folder.

| File | What it is |
|---|---|
| `handoff.html` | The full handoff as one page, with a copy button on every section. The user flow can be zoomed and dragged, and any screenshot opens full size. The screenshots and videos are inside the file, so it can be sent on its own. Each screenshot appears once: a later step on the same screen links back to it |
| `flow.png` | The user flow: screens and states as boxes, actions as arrows |
| `screens/` | One full-page screenshot per screen, state and screen size |
| `videos/` | One captioned walkthrough video per flow, every scenario in order |
| `features/` | One Gherkin feature file per flow, for QA to import. Steps that every scenario opens with are written once, as a `Background` |
| `checklist.md` | The acceptance checklist |
| `comment.md` | The text for a Jira comment, split into parts if it is too long for one |
| `manifest.json` | Every file to attach, with its size |

Joining scenarios into one video needs `ffmpeg`. Without it, the program writes one WebM
video per scenario and says how to install it. After installing it, `specsheet build`
remakes the videos without running anything again.

## Behind a firewall

A first run downloads three things. Each has a way round a blocked download:

- **The program**, from GitHub. Your registry or mirror needs to reach it.
- **Chromium**, from Playwright's servers. To use a browser already on the computer, set
  `"browser": "chrome"` or `"msedge"` in `specsheet.config.json`. Playwright can also
  download from a mirror: set `PLAYWRIGHT_DOWNLOAD_HOST`.
- **Playwright's own ffmpeg**, which records the videos and comes with that Chromium
  download. Without it, run `npx playwright install ffmpeg`, or set `"videos": "none"` to
  run with no videos. Everything else in the handoff is the same.

`specsheet doctor` says which of these the computer has, and what to do about the rest.
The `ffmpeg` you install yourself is a different one: it only joins a flow's videos into
one.

## Posting to Jira

The program never talks to Jira. Claude posts through the Jira connection you already
have: it shows a preview of the comment and the files, waits for your yes every time, and
posts a comment instead of editing the ticket. With no Jira connection, paste
`comment.md` and attach the files yourself.

## Known limits

- **Not tried on a real ticket.** Posting through a Jira connection, uploading videos,
  and placing screenshots inline in a comment are untested.
- **Only the Claude Code starting point has been run.** The skill covers Claude Design,
  Paper and Figma, but no design from those tools has been through it yet.
- **Scenario files must use plain quoted strings** for titles, screens, states and
  requirement ids. The size check reads them as text.
- **Videos show the visible screen, not the whole page.** The screenshots show the full
  page.
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

[CONTRIBUTING.md](../CONTRIBUTING.md) lists the other scripts and how to release.
