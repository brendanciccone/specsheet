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

1. **Never open a screenshot or a video of a run.** You work from text: the code, the
   ticket and the program's output. This keeps token use low, and the program's text
   output tells you everything you need. The one exception is checking a prototype you
   rebuilt against its design, once per frame, before the run.
2. **A rebuilt prototype matches the design exactly.** The same logos, icons, text,
   sizes and type as the frames, with nothing reworded, cut short, swapped or left out.
   Check it against each frame yourself before the user reviews it. A prototype that is
   nearly right does more harm than good. See "Figma" and "When you rebuilt the design"
   in [reference/starting-points.md](reference/starting-points.md).
3. **Confirm the setup at the start of every run.** Never reuse the screen size from an
   earlier ticket. A wrong assumption wastes a whole run.
4. **Never present an inferred requirement as if the ticket said it.** Label every
   requirement `stated` or `inferred`.
5. **Lean towards splitting a large story, and never block.** When the size check
   warns, recommend a split and say where you would cut it. The user decides, and
   "continue as one" is a fine answer.
6. **Never write to Jira without showing a preview and getting a yes, every time.**
   There is no "don't ask again".
7. **Never weaken a scenario to make it pass.** A failing step means the prototype and
   the scenario disagree. That is a finding for the designer, not a bug to hide.
8. **Ask few open questions, and only real ones.** An open question is something only a
   person can settle. It needs all four: it ends in a question mark, you can name who
   can answer it, neither the ticket nor any frame or note in the design answers it, and
   a different answer would change what gets built or tested. Each one says what you
   built in the meantime. A choice you made to keep going is not a question: write it as
   a `note` on the requirement, where the reader can overrule it. Write the questions
   late, in step 9, not while listing requirements.
9. **Leave out what everyone already expects.** A handoff says what this design does,
   not how browsers and dialogs work. Standard behaviour goes in one "assumed" list, not
   in scenarios. See "What earns a scenario" in
   [reference/scenario-format.md](reference/scenario-format.md).
10. **Add files; do not change the product's own code.** In a project that holds real
   product code, the handoff folder and any prototype you build are new files, on their
   own branch. Never edit, move or delete a file that was there before without the
   user's yes for that file, and never commit or push unless asked. See "Where the
   prototype goes" in [reference/starting-points.md](reference/starting-points.md).
11. **Never handle a password.** Do not write a password, token or cookie into a scenario
   file, the config or the conversation, and do not ask the user to paste one. See
   "Screens behind a sign-in" in [reference/scenario-format.md](reference/scenario-format.md).

## Set up the project first

The skill is the only thing the user installs. You set up the rest, in the project that
holds the design, before step 1.

This skill needs Specsheet 0.4.0 or later.

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
   branch for the handoff first, for example `handoff/<ticket-key>` (rule 10).
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
```

Do not list open questions yet. Most of what looks unclear now is answered by a frame
you have not read closely or settles itself once the prototype exists. Ask the user now
only about something that stops you listing the requirements at all. For anything else,
take the most likely reading and carry on: it becomes a requirement's `note` or an open
question in step 9, once you know which.

Keep the list to what this ticket and this design ask for. Behaviour that every product
already has, such as a dialog closing on Escape or the Back button going back, is not a
requirement. Show it under the list as one line, so the user can object:

```
Assumed, not tested: dialogs close on Escape and on a click outside; Back returns to the previous step.
```

**More than 8 requirements is the sign of a story that is too big.** This is the cheapest
moment to split, so say so now, before anything is built, and propose the cut: group the
requirements by the screen or the goal they belong to, name each group as its own story,
and recommend handing off one group at a time. For example: "These 14 fall into three
stories: cart and promo codes (R1 to R5), shipping (R6 to R9), payment (R10 to R14). I'd
hand off the cart first. Split that way, or continue as one?" Carry on as one if the user
prefers.

Wait for the user to approve or edit it, then write `requirements.json`, with the assumed
lines in its `assumed` list and `openQuestions` left empty for now.

### 4. Early size check

Count the screens in the design, then run:

```bash
npx specsheet check handoff/<TICKET-KEY> --screens <number>
```

If it prints a `WARNING`, show it to the user and recommend a split, with the cut you
would make (see step 3). Nothing has been built yet, so splitting now costs nothing. If
the user wants to continue as one, do.

### 5. Make sure there is a prototype that runs in a browser

What this takes depends on where the design was made. A design made in Claude Code is
already a prototype. A Figma design has to be rebuilt as code, which is the expensive
step. Follow [reference/starting-points.md](reference/starting-points.md).

Before you write any prototype code, read "Where the prototype goes" in that file: in a
product's codebase the prototype is new files on a branch, and existing code stays as it
is (rule 10).

When you rebuilt a design, it has to match the frames exactly (rule 2): the real logos
and icons from the file, every piece of text word for word and not cut short, the same
sizes and type. Compare each screen with its frame yourself and fix every difference
before you show it to anyone.

When you built or changed the prototype, list the files you added, say what you compared
and what still differs, and ask the user to review it before you go on. From here on,
the prototype is what gets tested.

### 6. Write the scenarios

One scenario file per flow, in `handoff/<TICKET-KEY>/scenarios/`. Follow
[reference/scenario-format.md](reference/scenario-format.md) exactly: the size check and
the handoff files are built from the text of these files.

Where scenarios part ways over one condition (valid or not, found or not, accepted or
declined), give those "When" steps the same `decision` question and each its own
`answer`. The user flow then shows it as a yes/no fork. See "Decisions" in the scenario
format.

Word a step that every scenario opens with, such as "Given I am on the Help page",
exactly the same in each. The handoff then says it once, as a Gherkin `Background`,
instead of repeating it in every scenario.

### 7. Exact size check

```bash
npx specsheet check handoff/<TICKET-KEY>
```

It warns above 12 scenarios or 8 screens, and its notes say which flows and which
requirements hold the most scenarios. On a `WARNING`, first look for scenarios that should
not be there: standard behaviour (rule 9), and two scenarios that prove the same thing.
Then show the warning and recommend a split along the lines its notes give. A separate
story is a separate handoff folder. If the user wants to continue as one, do.

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
| State never reached | A state was declared and no step lands on it | If neither the ticket nor a frame calls for it, take it out of `states`. Otherwise ask the user: design it, mark it not applicable with a reason, or leave it flagged. The handoff already reports a flagged state, so it needs no open question as well |
| Requirement not proven | No passing scenario covers it | Add a scenario, or ask the user whether it is out of scope |

Run again until the only findings left are ones the user chose to leave flagged.

### 9. Write the open questions

Now, and not before: every frame has been read, the prototype is built and the findings
are handled. Go through what was still unclear and sort each item.

It is an open question only if all four are true:

- It is a question, ending in a question mark.
- You can name who can answer it: the designer, the product owner, whoever owns the API.
- Neither the ticket nor any frame or note in the design answers it. Look again before
  you write it down.
- A different answer would change what gets built or tested.

Write each one with who to ask and the default, which is what you built and what stays
if nobody answers:

```json
{ "question": "Should the form show that it is sending while it waits?", "who": "Design",
  "default": "No sending state. The button stays as it is until the reply comes." }
```

Everything else goes somewhere else:

| What you have | Where it goes |
|---|---|
| A decision you made to keep going | The `note` of the requirement it belongs to |
| Behaviour you are nearly sure of | `assumed` |
| A state nobody drew | Nowhere, unless the ticket asks for it. Then it is a declared state, and the handoff reports it as not shown |
| The design disagrees with itself | To the designer, as a finding in your report (step 11). Say which one you built |

Most handoffs end with none to three. With more than five, some are not questions for a
person.

Write them to `requirements.json`, then run `npx specsheet check handoff/<TICKET-KEY>`:
it names the ones that do not end in a question mark or have no `who` or no `default`.
Put those right, then show the user the list. A question the user answers on the spot
comes off it: the answer goes into the requirement or its `note`.

### 10. Final run

```bash
npx specsheet run handoff/<TICKET-KEY>
```

Without `--fast`, the videos are paced and captioned so a person can follow them.

### 11. Report, then offer to post

Tell the user what was produced, where it is, and which findings are still open. List
the places where the design disagrees with itself, for the designer, with what you built
in each. The
handoff page is `handoff/<TICKET-KEY>/out/handoff.html`, and it works on its own in any
platform.

In a git repository, also say which files are new: the handoff folder (git ignores its
`out/`), the prototype if you built one, and the dev dependency in `package.json`. Leave
committing them to the user.

If the ticket is in Jira and the user has a Jira connection, offer to post it. Follow
[reference/jira.md](reference/jira.md).
