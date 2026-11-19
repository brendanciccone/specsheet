---
name: specsheet
description: Turn a ticket and a design into everything engineering needs, as a tested handoff for engineering and QA. Use from the very first message when a designer asks to hand off a design or a ticket, prepare a ticket for developers, write acceptance criteria, Gherkin or a QA checklist for a prototype, or mentions Specsheet. It sets up the project itself on first use, so do not ask the user to install anything first. Takes a ticket (Jira or pasted text) and a design made in Claude Code, Claude Design, Paper or Figma, and produces a user flow, walkthrough videos, Gherkin or a checklist with a screenshot beside each step, and a list of missing states, then offers to post them to the Jira ticket.
---

# Specsheet: design handoff

Specsheet has two halves. You do the thinking: read the ticket and the design, list the
requirements, write the scenarios. The `specsheet` program does the proving: it runs the
scenarios in a hidden browser, takes the screenshots, records the videos and builds the
handoff files. No model is involved in a run.

## Rules that always hold

1. **Never open a screenshot or a video.** You work from text: the code, the ticket and
   the program's output. This keeps token use low, and the program's text output tells
   you everything you need.
2. **Confirm the setup at the start of every run.** Never reuse the screen size from an
   earlier ticket. A wrong assumption wastes a whole run.
3. **Never present an inferred requirement as if the ticket said it.** Label every
   requirement `stated` or `inferred`.
4. **The size check warns and never blocks.** Show the warning and ask whether to
   continue or split the story. The user decides.
5. **Never write to Jira without showing a preview and getting a yes, every time.**
   There is no "don't ask again".
6. **Never weaken a scenario to make it pass.** A failing step means the prototype and
   the scenario disagree. That is a finding for the designer, not a bug to hide.
7. **Do not make design decisions.** When a state, a message or a behaviour is missing,
   ask the designer. If they have no answer yet, record an open question.
8. **Add files; do not change the product's own code.** In a project that holds real
   product code, the handoff folder and any prototype you build are new files, on their
   own branch. Never edit, move or delete a file that was there before without the
   user's yes for that file, and never commit or push unless asked. See "Where the
   prototype goes" in [reference/starting-points.md](reference/starting-points.md).
9. **Never handle a password.** Do not write a password, token or cookie into a scenario
   file, the config or the conversation, and do not ask the user to paste one. See
   "Screens behind a sign-in" in [reference/scenario-format.md](reference/scenario-format.md).

## Set up the project first

The skill is the only thing the user installs. You set up the rest, in the project that
holds the design, before step 1.

This skill needs Specsheet 0.2.0 or later.

1. Run `npx --no specsheet version`. Write it exactly so: `npx` keeps `--version` for
   itself and prints its own.
   - It prints that version or a later one: the project is ready. Skip to the handoff
     folder below.
   - It prints an earlier version, or `Unknown command "version"`: the project has an
     older program. Say so, and on a yes run the install command in step 4 again, which
     updates it.
   - It fails any other way: the program is not installed. Carry on.
2. Check `node --version` is 22 or later. If it is not, tell the user to install a newer
   Node from nodejs.org, and stop.
3. If the project is a git repository and you are on its main branch, ask to create a
   branch for the handoff first, for example `handoff/<ticket-key>` (rule 8).
4. Ask once: "Specsheet needs its program in this project and a browser to run the
   scenarios in. I'll run these two commands. The first adds a dev dependency to
   package.json and the lockfile. OK?" and show them:

   ```bash
   npm install --save-dev github:brendanciccone/specsheet
   npx playwright install chromium
   ```

   Run them on a yes. With no `package.json`, run `npm init -y` first and say so. If the
   project uses pnpm or yarn (a `pnpm-lock.yaml` or `yarn.lock`), use `pnpm add -D` or
   `yarn add -D` instead of `npm install --save-dev`.
5. Run `npx specsheet doctor`. It starts the browser, records a moment of video and
   looks for `ffmpeg`, and says what to do about anything missing. On a work network the
   browser download is often blocked. `doctor` then names a browser already on the
   computer, and you set `"browser": "chrome"` or `"msedge"` in `specsheet.config.json`
   once the handoff folder exists. If it says videos cannot be recorded, the user chooses:
   `npx playwright install ffmpeg`, or `"videos": "none"`.

Do this once per project. Later handoffs in the same project start at step 1.

Each handoff lives in its own folder in the project, named after the ticket:
`handoff/<TICKET-KEY>/`. Create it with `npx specsheet init handoff/<TICKET-KEY>`.
See [reference/files.md](reference/files.md) for every file in that folder.

## The steps

### 1. Collect the two inputs

You need a ticket and a design. Ask for whichever is missing.

- **Ticket.** A Jira key (read it through the user's Jira connection), or pasted text.
  With no ticket at all you can still continue: every requirement will be `inferred`.
- **Design.** Where it was made (Claude Code, Claude Design, Paper or Figma) and how to
  reach it. See [reference/starting-points.md](reference/starting-points.md).

### 2. Confirm the setup

First run `npx specsheet doctor handoff/<TICKET-KEY>`. It says whether this handoff's
browser starts, whether videos can be recorded, and whether `ffmpeg` is installed, which
is what joins a flow's scenarios into one walkthrough video.

Then ask once, in one message, with the likely answers filled in:

> This ticket's design is desktop, 1440 × 900. Mock data. Gherkin in the ticket. One
> walkthrough video for the flow. Confirm or change?

- **Screen size** comes from this ticket's design: frame sizes in Figma, Paper or Claude
  Design, or clues in the code and ticket for Claude Code. If the design has both
  desktop and mobile, ask which are needed and say that both roughly doubles the output.
  If you cannot tell, ask outright: desktop, mobile or both.
- **Data** is mock unless the user opts in to real data. If they do, warn them that real
  records will appear in screenshots and videos attached to the ticket.
- **Format** is which of Gherkin or checklist appears in the ticket text. Both files are
  always produced.
- **Videos** is one walkthrough video per flow (`flow`, the default), one video per
  scenario (`scenario`), or no videos (`none`). The walkthrough plays every scenario in
  order, and the handoff lists the time each one starts. Suggest `scenario` only when the
  user wants to attach clips separately. If the user changes their mind after a run, do
  not run again: `npx specsheet build handoff/<TICKET-KEY> --videos <choice>` remakes the
  videos from the recordings of the last run in a few seconds. The exception is `none`,
  which records nothing: going from `none` to videos needs a new run.
  If `doctor` said `ffmpeg` is missing, say so in the same message and give the choice:
  install it now (show the command `doctor` printed, and let the user run it or tell you
  to), or carry on with one video per scenario. Never install it without a yes. It is
  not a blocker: installing it later and running `build` gives the walkthrough without
  running the scenarios again.

Write the answers to `specsheet.config.json`.

### 3. List the requirements

Read the ticket and the design, then show the user a numbered list:

```
R1  A visitor can send a message with their name, email and text.   stated
R2  An invalid email address shows an error and nothing is sent.    stated
R3  If sending fails, the visitor keeps their message.              inferred from the design
Open question: no loading state is designed for sending. Is one needed?
```

Wait for the user to approve or edit it, then write `requirements.json`.

### 4. Early size check

Count the screens in the design, then run:

```bash
npx specsheet check handoff/<TICKET-KEY> --screens <number>
```

If it prints a `WARNING`, show it to the user and ask whether to continue or split the
story first. This is the cheapest moment to stop, because nothing has been built yet.

### 5. Make sure there is a prototype that runs in a browser

What this takes depends on where the design was made. A design made in Claude Code is
already a prototype. A Figma design has to be rebuilt as code, which is the expensive
step. Follow [reference/starting-points.md](reference/starting-points.md).

Before you write any prototype code, read "Where the prototype goes" in that file: in a
product's codebase the prototype is new files on a branch, and existing code stays as it
is (rule 8).

When you built or changed the prototype, list the files you added and ask the user to
review it before you go on. From here on, the prototype is what gets tested.

### 6. Write the scenarios

One scenario file per flow, in `handoff/<TICKET-KEY>/scenarios/`. Follow
[reference/scenario-format.md](reference/scenario-format.md) exactly: the size check and
the handoff files are built from the text of these files.

Word a step that every scenario opens with, such as "Given I am on the Help page",
exactly the same in each. The handoff then says it once, as a Gherkin `Background`,
instead of repeating it in every scenario.

### 7. Exact size check

```bash
npx specsheet check handoff/<TICKET-KEY>
```

Show any `WARNING` to the user and ask whether to continue.

### 8. Run, and handle the findings

```bash
npx specsheet run handoff/<TICKET-KEY> --fast
```

Use `--fast` while fixing. Read the findings the program prints and take each one to
the user:

| Finding | What it means | What to do |
|---|---|---|
| Failed step | The prototype does not do what the scenario says | Work out with the user which one is wrong. Fix that one. Never loosen a check to pass |
| Unverified "Then" step | The step has no check, so nothing was proven | Add a check for what the step claims |
| State never reached | A state was declared and no step lands on it | Ask the user: design it, mark it not applicable with a reason, or leave it flagged and add an open question |
| Requirement not proven | No passing scenario covers it | Add a scenario, or ask the user whether it is out of scope |

Run again until the only findings left are ones the user chose to leave flagged.

### 9. Final run

```bash
npx specsheet run handoff/<TICKET-KEY>
```

Without `--fast`, the videos are paced and captioned so a person can follow them.

### 10. Report, then offer to post

Tell the user what was produced, where it is, and which findings are still open. The
handoff page is `handoff/<TICKET-KEY>/out/handoff.html`, and it works on its own in any
platform.

In a git repository, also say which files are new: the handoff folder (git ignores its
`out/`), the prototype if you built one, and the dev dependency in `package.json`. Leave
committing them to the user.

If the ticket is in Jira and the user has a Jira connection, offer to post it. Follow
[reference/jira.md](reference/jira.md).
