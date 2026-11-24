<img src="assets/mark.svg" alt="Specsheet logo" width="88" height="88">

# Specsheet

[![CI](https://github.com/brendanciccone/specsheet/actions/workflows/ci.yml/badge.svg)](https://github.com/brendanciccone/specsheet/actions/workflows/ci.yml)

Turn a ticket and a design into everything engineering needs.

Give Claude a ticket and a design that runs in a browser. You get back a user flow, a
walkthrough video, Gherkin or a checklist with a screenshot for every step, and the
states the design is missing. Every step is run against the design, so the spec matches it.

![Four parts of the handoff page for the example ticket HELP-12: the summary and requirements, the user flow with the missing "sending" state drawn as not shown, the walkthrough video paused on the email error, and the "Invalid email is rejected" scenario with its steps and screenshot](docs/screenshot/screenshot.webp)

Free and open source, under the MIT license.

## Install

In Claude Code, run:

```
/plugin install specsheet --marketplace brendanciccone/specsheet
```

That is the only install. You also need:

- [Node](https://nodejs.org) 22 or later.
- [ffmpeg](https://ffmpeg.org), to join a flow's scenarios into one walkthrough video.
  Without it, you get one video per scenario.
- For a design in Figma or Paper, that tool's connection in Claude Code, so Claude can
  read the frames.
- Optionally, a Jira connection, so Claude can read the ticket and post the handoff.
  Without it, paste the ticket in and attach the files yourself.

Connections you added in claude.ai work when Claude Code is signed in with a claude.ai
account. With Amazon Bedrock, Vertex AI or an API key they are not loaded: add each
tool's MCP server yourself, as [Claude Code's MCP guide](https://code.claude.com/docs/en/mcp)
describes. On a network that blocks downloads, see
[Behind a firewall](docs/reference.md#behind-a-firewall).

## Use

In the project that holds your design, ask Claude:

> Hand off the contact form for HELP-12.

Or type `/specsheet:specsheet HELP-12`. Both start the same skill, in Claude Code in the
terminal or in the desktop app's Code tab.

For a design in Figma or Paper, run it in your product's codebase and include the link:

> Hand off PROJ-123. The design is in Figma: \<link to the frames\>

Claude first builds a working prototype from the design, with your real components, and
asks you to check it against the design. It adds new files on a branch, and leaves your
existing code as it is. In an empty folder it writes every screen from scratch, which
costs more. Nothing is built when the design already runs: one made in Claude Code, or a
Claude Design export you can already click through.

The skill takes it from there. The first time, it adds Specsheet to the project and
downloads a browser, after asking you. Then it confirms the setup, lists the requirements
for your approval, writes and runs the scenarios, and goes through what it found with you.

You get `handoff/HELP-12/out/handoff.html`: one file with the screenshots and video
inside, and a copy button on every section. Claude can also post it to Jira as a
comment, always after showing you a preview.

## Update

To get a new version of the plugin, refresh the marketplace and update it from a
terminal, then restart Claude Code:

```bash
claude plugin marketplace update specsheet
```

```bash
claude plugin update specsheet@specsheet
```

That is all you do. The next time you ask for a handoff in a project, the skill checks
the version of the program that project has. If it is older than the skill needs, it
says so and, on your yes, runs the install command again to bring it up to date.

## See it first

Run the example in this repository:

```bash
git clone https://github.com/brendanciccone/specsheet.git
cd specsheet
npm install
npx playwright install chromium
npm run example
```

Then open `examples/contact-form/handoff/HELP-12/out/handoff.html`. The example's design
has no loading state for sending a message, and the handoff reports that.

## Status

A first version. It works on the example here, and has not yet been tried on a real
ticket. The [reference](docs/reference.md) covers the commands, the scenario format,
every output file, Jira and the known limits. [CONTRIBUTING.md](CONTRIBUTING.md) covers
working on Specsheet and releasing it.
