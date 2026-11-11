Windows desktop companion for the Learnest study assistant.

## Assets

- **installer** — Simplified Chinese wizard, desktop and Start Menu shortcuts, uninstaller, optional start with Windows
- **portable zip** — the executable is the upstream Electron binary renamed without rewriting its PE resources, so it also runs on machines where Smart App Control blocks freshly compiled unsigned binaries

## What's in 1.1.7

### Update prompts now live inside the window

`dialog.showMessageBox` was replaced by an HTML layer injected into the main
window (`src/uiprompt.js`). Native dialogs sit outside the renderer, which meant
the update prompt could not be captured in a screenshot, could not be clicked by
a script, and blocked unattended test runs until somebody dismissed it by hand.

- The prompt follows the site's light/dark theme and matches the app instead of
  looking like a system message box.
- It can be driven end to end headlessly: render, `capturePage()`, click a button,
  assert the result. `--smoke-update` does exactly that, including a real
  `checkUpdates()` run against a local fake manifest.
- Every update prompt uses it, not just the "new version" one: download failures,
  "already up to date", "update ready to install" and the debug-build notice.
- If no main window exists yet (silent start at login) it falls back to a native
  dialog, so the prompt is never lost.
- Prompts resolve when the window closes or navigates away, so a page redirect
  can no longer leave the updater stuck in a busy state forever.

### Fixes

- **Some book covers showed a white strip on the right.** This one is in the web
  app, not the shell: `.b-cover` is a `<button>`, and Chromium's default
  `align-items: flex-start` made the cover shrink to its content width inside a
  column flex container — the longer the title, the narrower the cover. Fixed by
  setting `align-items: stretch`.

### Earlier

`1.1.4` added the desktop-only settings block (pet visibility, close behaviour),
fixed the "quit the app" option, the sliding switch and the pet position clamp,
and routed downloads through a *Save as* dialog. See that release for details.
`1.1.5` and `1.1.6` were builds used to bring the auto-update channel up; they
were published through the updater only and never got a GitHub release.

## Code signing

> Release builds are code-signed by the [SignPath Foundation](https://signpath.org/)
> free code-signing program for open source projects.

Until the SignPath enrollment completes, the binaries in this release are
unsigned, so Windows SmartScreen may show an "unknown publisher" prompt.
