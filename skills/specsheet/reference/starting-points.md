# Starting points

Specsheet needs a prototype that runs in a browser. How much work that takes depends on
where the design was made. Tell the user the cost before you start an expensive path.

| Made in | What you get | Work before a run | Cost |
|---|---|---|---|
| Claude Code | The code itself | None | Lowest |
| Claude Design | An HTML export, or a handoff to Claude Code | Check it is clickable. Add behaviour if not | Low to medium |
| Paper | The real HTML and CSS of each screen | Add behaviour, states and mock data | Medium |
| Figma | The values, images and a picture of each frame | Rebuild each screen to match its frame exactly, then check it against the frame | Highest |

## Where the prototype goes

When you build or change a prototype in a project that holds real product code:

- **Work on a branch.** If the project is a git repository and you are on its main
  branch, ask to create one first, for example `handoff/<ticket-key>`. Never commit or
  push unless the user asks.
- **Add new files and leave existing ones alone.** Ask the user where the prototype
  should live. Offer `handoff/<TICKET-KEY>/prototype/` when it can run on its own, or a
  new route or page inside the app when it has to use the app's components. Do not edit,
  move or delete a file that was there before without a yes for that file.
- **Reuse, do not modify.** Import the project's components and styles as they are. If a
  component cannot do what the design needs, say so. That is a finding for the designer
  and engineering, not something to patch.
- **Say what you added.** When the prototype is ready for review, list the new files.

A design made in Claude Code is different. The prototype is the user's own work, on the
branch they are on, and you change it only to fix what the user agrees is wrong.

## Claude Code

The design is already a prototype.

- Find how to start it (the `dev` or `start` script) and put that in `webServer` in
  `specsheet.config.json`, so the program starts it for each run.
- There are no frames, so look for the screen size in the code and the ticket: a
  mobile-only layout, breakpoints, the word "app". Then ask the user to confirm.
- `design.link` is the branch, pull request or preview address, if one exists. If the
  work only exists on this machine, leave it empty.

## Claude Design

- Ask the user to export the design as standalone HTML, or to send it to Claude Code.
- Serve the exported files with a small static server and set `webServer` to start it.
- Check whether moving between screens works in the export. If it does, use it as it
  is. If the export is a set of separate screens, add the behaviour between them and set
  `design.rebuilt` to `true`.
- The frame sizes give the screen size. `design.link` is the artifact's link.

## Paper

- Read each screen's markup through the Paper connection. It is real HTML and CSS, so
  the look carries over without a translation step.
- Add what the canvas does not have: what happens on click, validation, each state, and
  mock data.
- If the project has a design system, map the canvas markup onto the real components.
- Set `design.rebuilt` to `true`. The frame sizes give the screen size, and
  `design.link` is the link to the file.

## Figma

The prototype has to be the design, not a sketch of it. Its screenshots and videos go to
engineering as the reference, so a logo that is missing, an icon from another set or a
label cut short sends them the wrong thing. A prototype that is nearly right does more
harm than no prototype. Build it to match the frames exactly, and prove that it does
before you show it to the user.

**Read everything the frame has, before writing any code.** Through the Figma connection,
for every frame in the story:

- the design context: the layout, sizes, spacing, colours and type of every layer;
- the variables and styles the file defines, so colours and type come from the file's
  own values;
- every image the frame uses: logos, icons, illustrations, photos, avatars. Download
  each one from the file into the prototype's own assets folder;
- a picture of the frame, saved as `handoff/<TICKET-KEY>/design/<frame-name>.png`, for
  the check below.

What comes back as code is a reference for the values, not code to paste. The values in
it are the ones to use.

**Then rebuild each screen so nothing differs:**

- **Images come from the file.** Never swap in an icon from a library, an emoji, a
  placeholder box or a logo you drew yourself. If an image cannot be downloaded, stop and
  ask the user for it.
- **Text is copied, character for character.** Every heading, label, button, hint,
  number and placeholder, with its capitals and punctuation. Do not reword, shorten,
  translate or invent text, and do not leave any out.
- **Text fits the way it does in the frame.** A label on one line in the frame is on one
  line in the prototype. Nothing is cut off, ends in "…" or wraps where the frame does
  not, unless the frame itself shows it that way.
- **Sizes are the frame's sizes.** Widths, heights, spacing, corner radii, borders and
  shadows come from the design context, not from a guess that looks close.
- **Type is the frame's type.** The same font family, weight, size, line height and
  letter spacing. Load the font the file uses. If it is not available, ask before you
  use another one, and say so in the handoff.
- **Nothing is added.** No element, text or decoration that the frame does not have.
- **Small things count.** Dividers, badges, dots, focus rings, the order of items, the
  alignment of an icon with its text.

Reuse the project's components where they come out the same as the frame. Where a
component looks different from the frame, do not quietly accept the difference and do not
change the component: tell the user what differs. That is a finding for the designer and
engineering.

**What the frames do not say:**

- Frames show how a screen looks, not what happens between screens. Use the frame order,
  the frame names and any prototype links, and ask the user about anything you cannot
  tell. Do not invent behaviour.
- A state with no frame is a missing state. Ask the user what should happen, or record
  an open question.
- Set `design.rebuilt` to `true`. The frame sizes give the screen size, and
  `design.link` is the link to the frames.

## When you rebuilt the design

With `design.rebuilt` set to `true`, the handoff says so in its summary: the original
design is the reference for how it looks, and the prototype shows how it behaves.

Three things follow from that:

1. **Check the prototype against the design yourself, frame by frame, before the user
   sees it.** This is the one time you look at pictures (rule 1). For each frame:
   - Take a picture of the prototype at the frame's size:
     `npx playwright screenshot --viewport-size "<width>,<height>" <address> handoff/<TICKET-KEY>/design/<frame-name>.built.png`
   - Open it beside the frame's picture and go through this list: every logo, icon and
     image is there and is the same one; every piece of text is there, complete, worded
     the same and wrapped the same; sizes, spacing and alignment match; colours and type
     match; nothing is extra.
   - Fix each difference and compare again. Stop when you find none, not when it looks
     close.
   - Compare once per frame, and once more after fixes. Do not look at the screenshots
     of a run: those you still read as text.
2. **Then the user reviews it against their design, before the run.** Give them the list
   of frames you compared and, for each, anything that still differs and why: a font that
   could not be loaded, an image that could not be downloaded, a project component that
   looks different. Say "no differences found" only for a frame you compared. You wrote
   both the prototype and the scenarios from the same source, so a passing run shows they
   agree with each other. It does not show that either matches the original design.
3. **Tell the user this costs more.** Reading every frame, writing every screen and
   checking each one is several times the cost of the rest of the handoff. It is also
   another reason to split a large story.

The same check applies to a Paper or Claude Design prototype you changed the look of.

## A connected codebase

If the session can read the product's codebase or design system, use the real components
and tokens when you build a prototype. It costs less than writing screens from scratch,
and the handoff's code references then point at code engineering will use.
