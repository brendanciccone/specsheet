# Contributing to Specsheet

Thanks for your interest in Specsheet. This guide covers working on it locally and
releasing it.

## Local development setup

Specsheet uses npm, on Node 20 or later. The repository ships a `package-lock.json`.

```bash
npm install
npx playwright install chromium
npm test
```

### Supply-chain protection

This project assumes contributors have [Aikido Safe Chain](https://github.com/AikidoSec/safe-chain)
installed locally. It wraps `npm` and `npx` to block known-malicious packages and
quarantine versions under 48 hours old at install time. Install it once with the command
in [its README's Installation section](https://github.com/AikidoSec/safe-chain#installation),
then restart your terminal.

## Scripts

- `npm test`: the unit tests, which need no browser
- `npm run example`: runs the example handoff end to end, in a browser. It writes
  `examples/contact-form/handoff/HELP-12/out/`
- `node docs/logo/final.mjs`: redraws the logo PNG files and the logo sheets after a
  change to an SVG file in `assets/`
- `node docs/screenshot/screenshot.mjs`: runs the example and redraws the picture at the
  top of the README

## Submitting changes

- Keep commits focused and descriptive.
- Run `npm test` before opening a pull request, and `npm run example` after a change to
  the program.
- After a change to the skill or the plugin files, run `claude plugin validate . --strict`.

## Releasing

Releases are built and uploaded from CI, and go live only after a maintainer approves
them with 2FA. `.github/workflows/release.yml` runs when a version tag is pushed. It runs
CI, stages the version on npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers)
with provenance, and creates the GitHub Release. Nothing reaches `npm install` until you
approve it, so a leaked GitHub credential can't ship a release on its own.

1. On a branch, set the new version with `npm version 0.1.1 --no-git-tag-version`,
   which updates `package.json` and `package-lock.json`, then set the same version in
   `.claude-plugin/plugin.json`. A test fails if the three differ.
2. Merge to `main`.
3. Optional dry run: Actions → Release → Run workflow on `main`. It runs the tests and
   checks that npm accepts the workflow, but uploads nothing. It fails if npm doesn't
   trust the workflow.
4. Tag the merge commit and push only that tag:

   ```bash
   git switch main && git pull --ff-only
   git tag v0.1.1
   git push origin v0.1.1
   ```

5. When the run finishes, approve the version on npmjs.com: account menu → **Staged
   Packages** → **Approve**, with 2FA. The button stays disabled until npm's malware scan
   finishes. The run's summary shows the tarball's shasum; approve only if the card shows
   the same one.

The tag must be `v` plus the exact `package.json` version, and it must point at a commit
on `main`, or the workflow stops before staging. These checks catch mistakes; the
approval in step 5 is what guards against misuse. Push one tag at a time: GitHub starts
no workflow when more than three tags are pushed at once. A prerelease tag such as
`v0.2.0-rc.1` goes to npm's `next` dist-tag and is marked as a prerelease on GitHub. If a
run fails or is canceled, re-run it: it skips what is already done. If you reject a
staged version, delete its GitHub Release and tag before tagging again.

### The first release

npm only lets you add a trusted publisher to a package that already exists, so the first
version is published by hand, once. From a clean checkout of `main`, signed in to npm
with 2FA:

```bash
npm ci
npm publish --access public
```

`prepublishOnly` runs the tests first, which is why `npm ci` comes before it. Then follow
the one-time setup below, so every later version goes through the workflow. Once
`specsheet` is on npm:

- Change the install line in `skills/specsheet/SKILL.md` and `docs/reference.md` from
  `github:brendanciccone/specsheet` to `specsheet`, so the skill installs a released
  version.
- Add the npm badge to the README, under the CI badge:
  `[![npm](https://img.shields.io/npm/v/specsheet)](https://www.npmjs.com/package/specsheet)`

### One-time npm setup

npm has to trust the workflow before the first release through it. On npmjs.com, open the
`specsheet` package → Settings → Trusted Publisher → GitHub Actions, and enter:

| Field | Value |
| --- | --- |
| Organization or user | `brendanciccone` |
| Repository | `specsheet` |
| Workflow filename | `release.yml` |
| Environment name | *(leave blank)* |
| Allowed actions | leave **Allow npm publish** and **Allow npm dist-tag** unchecked |

With both boxes unchecked, the connection can only stage, which is what the workflow
does. Fields are case-sensitive, and a connection can't be edited, only deleted and
recreated. npm accepts a workflow if any of the package's connections match, so delete
any other connection, especially one with **Allow npm publish** ticked. npm drops a new
connection that isn't used within two days, so add it when you're ready to tag the next
version.

Once a release has gone out this way, set Settings → Publishing access to "Require
two-factor authentication and disallow tokens". Trusted publishing keeps working, and no
npm token is stored in GitHub.

If the step fails with "npm did not accept this workflow", the connection doesn't match:
compare it field by field with the table. The lines starting with `npm verbose oidc` in
the log say why.
