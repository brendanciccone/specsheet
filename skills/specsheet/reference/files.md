# Files in a handoff folder

```
handoff/HELP-12/
  specsheet.config.json   the setup the user confirmed
  requirements.json       the requirements the user approved
  scenarios/              the scenario files you write
  .gitignore              keeps out/ out of git
  out/                    everything the program produces
```

## specsheet.config.json

```json
{
  "title": "Add a contact form to the Help page",
  "ticket": { "key": "HELP-12", "url": "https://example.atlassian.net/browse/HELP-12" },
  "design": { "source": "figma", "link": "https://www.figma.com/design/...", "rebuilt": true },
  "baseURL": "http://localhost:4173",
  "webServer": { "command": "npm run dev", "cwd": "../..", "url": "http://localhost:4173" },
  "viewports": [{ "name": "Desktop", "width": 1440, "height": 900 }],
  "data": "mock",
  "format": "gherkin"
}
```

| Field | Meaning |
|---|---|
| `title` | The story, in a few words. Used as the handoff's title |
| `ticket` | The ticket key and its link. Either can be `null` |
| `design.source` | `claude-code`, `claude-design`, `paper` or `figma` |
| `design.link` | A link to the original design, or `null` when there is nothing to link |
| `design.rebuilt` | `true` when you built the prototype from the design |
| `baseURL` | Where the prototype runs. Scenario files navigate relative to this |
| `webServer` | How to start the prototype: a command, the folder to run it in (relative to this file) and the address to wait for. `null` if the user starts it themselves |
| `viewports` | One or two screen sizes. Add `"mobile": true` for a phone, and `"scale": 2` for sharper screenshots |
| `data` | `mock` or `real` |
| `format` | `gherkin` or `checklist`: which one appears in the ticket text |
| `videos` | `flow` (one walkthrough video per flow, the default), `scenario` (one per scenario) or `none`. With `none` nothing is recorded, so choosing videos later needs a new run |
| `browser` | Optional. `chromium` (the default: the browser Playwright downloads), or `chrome` or `msedge` to use one already on the computer, for when that download is blocked |
| `warnAt` | Optional. Where the size check starts to recommend a split. Defaults to `{ "scenarios": 12, "screens": 8, "requirements": 8 }`. Give any of the three, or one number for all of them |
| `pace` | Optional. The shortest pause around each step in milliseconds, for the videos. Defaults to 700. A step's caption is shown before the step starts, long enough to read. A pointer moves to each control, text is typed a key at a time and the page scrolls as needed, so the video looks like a person using the prototype |

## requirements.json

```json
{
  "requirements": [
    { "id": "R1", "text": "A visitor can send a message with their name, email and text.", "source": "stated" },
    { "id": "R4", "text": "If sending fails, the visitor keeps their message.", "source": "inferred" }
  ],
  "openQuestions": ["No loading state is designed for sending. Is one needed?"],
  "assumed": ["Dialogs close on Escape and on a click outside them."]
}
```

`source` is `stated` when the ticket says it, and `inferred` when you took it from the
design. Scenarios refer to requirements by `id` in their `covers` list.

`assumed` is standard behaviour the handoff relies on and does not test, one sentence
each. The handoff prints it once. Leave it empty when there is none.

## out/

| File | What it is |
|---|---|
| `handoff.html` | The full handoff as one page, with the steps of every scenario and a screenshot of each screen and state, copy buttons on every section, a list of contents, and a user flow that can be zoomed and clicked. With more than six scenarios, the passing ones start folded to one line each |
| `flow.png`, `flow.svg` | The user flow: one column per screen, its states branching below, and one drawing per flow |
| `screens/` | One full-page screenshot per screen, state and screen size |
| `videos/` | One walkthrough video per flow and screen size, or one per scenario, as set by `videos`. One per flow needs `ffmpeg`; without it the program writes one per scenario and says so |
| `features/` | One Gherkin feature file per flow |
| `checklist.md` | The acceptance checklist |
| `comment.md` | The text for the Jira comment. `comment-2.md` and so on when it does not fit in one |
| `manifest.json` | Every file to attach, with its size, plus the run's counts |
| `findings.txt` | The findings from the last run |
| `results.json` | The raw results every other file is built from |

`out/` can be deleted at any time. `specsheet run` rebuilds all of it, and `specsheet build`
rebuilds everything except the results from the last run.
