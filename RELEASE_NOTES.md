Windows desktop companion for the Learnest study assistant.

## Assets

- **installer** — Simplified Chinese wizard, desktop and Start Menu shortcuts, uninstaller, optional start with Windows
- **portable zip** — the executable is the upstream Electron binary renamed without rewriting its PE resources, so it also runs on machines where Smart App Control blocks freshly compiled unsigned binaries

## What's in 1.1.4

### Close button now does what you configure

- New desktop-only settings block in the account centre: **Show desktop pet** (a sliding
  switch) and **When closing the window** (minimise to tray / quit the app / ask every time).
- "Ask every time" shows a two-button dialog with a *remember my choice* checkbox.
- Opening the pet switches the setting back to *minimise* automatically — closing the
  window would otherwise take the pet away with it and look like the app vanished —
  but an explicit *quit* choice afterwards is honoured, not overridden.

### Fixes

- **Choosing "quit the app" left the process running in the tray.** `app.quit()` was
  called synchronously from inside the window's `close` handler, so Electron treated
  the quit as cancelled by the very window it was closing. Deferred by one tick.
- **The pet switch did nothing on the first click, and closed on the second.** The
  switch read its state from the DOM before the asynchronous settings reply landed.
  It now only trusts the state returned by the main process.
- **The pet could appear half off-screen in a corner.** `workArea` can briefly report
  zero size right after boot or a monitor wake, which produced negative coordinates;
  the old clamp then allowed 70% of the body to sit outside the display. The clamp now
  keeps the whole window inside the work area, with a fallback chain when the work
  area is empty, plus a self-heal pass 1.5 s after launch.
- **Downloading a Word document blanked the main window.** The site navigates to the
  file URL, which turned the window into a document viewer. Downloads are now
  intercepted, saved through a *Save as* dialog, and the `Zone.Identifier` mark is
  removed afterwards so Word opens the file normally instead of in Protected View.

### Other changes

- Double-clicking the launcher always opens the study centre; only `--autostart`
  starts silently with the pet alone.
- The pet is 18% smaller (200×300 → 164×246) — uniformly scaled, so the bubble, the
  gear and the sprite keep their proportions.
- The hover gear at the pet's top-right corner was already there in the source; it is
  now documented and covered by the smoke tests.
- The desktop build hides the site's ICP filing footer. The browser build keeps it.

## Code signing

> Release builds are code-signed by the [SignPath Foundation](https://signpath.org/)
> free code-signing program for open source projects.

Until the SignPath enrollment completes, the binaries in this release are
unsigned, so Windows SmartScreen may show an "unknown publisher" prompt.
