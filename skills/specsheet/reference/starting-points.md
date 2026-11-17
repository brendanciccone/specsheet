# Starting points

Specsheet needs a prototype that runs in a browser. How much work that takes depends on
where the design was made. Tell the user the cost before you start an expensive path.

| Made in | What you get | Work before a run | Cost |
|---|---|---|---|
| Claude Code | The code itself | None | Lowest |
| Claude Design | An HTML export, or a handoff to Claude Code | Check it is clickable. Add behaviour if not | Low to medium |
| Paper | The real HTML and CSS of each screen | Add behaviour, states and mock data | Medium |
| Figma | A code translation of each frame, as a reference | Rebuild each screen as code | Highest |

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

- Read each frame through the Figma connection. What comes back is a reference to adapt,
  not final code.
- Rebuild each screen as code. Reuse the project's components where they exist.
- Frames show how a screen looks, not what happens between screens. Use the frame order,
  the frame names and any prototype links, and ask the user about anything you cannot
  tell. Do not invent behaviour.
- A state with no frame is a missing state. Ask the user what should happen, or record
  an open question.
- Set `design.rebuilt` to `true`. The frame sizes give the screen size, and
  `design.link` is the link to the frames.

## When you rebuilt the design

With `design.rebuilt` set to `true`, the handoff says so in its summary: the original
design is the reference for how it looks, and the prototype, videos and screenshots show
how it behaves.

Two things follow from that:

1. **The user must review the prototype against their design before the run.** You wrote
   both the prototype and the scenarios from the same source, so a passing run shows they
   agree with each other. It does not show that either matches the original design.
2. **Tell the user this costs more.** Reading every frame and writing every screen is
   several times the cost of the rest of the handoff.

## A connected codebase

If the session can read the product's codebase or design system, use the real components
and tokens when you build a prototype. It costs less than writing screens from scratch,
and the handoff's code references then point at code engineering will use.
