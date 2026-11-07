Windows desktop companion for the Learnest study assistant.

## Assets

- **installer** — Simplified Chinese wizard, desktop and Start Menu shortcuts, uninstaller, optional start with Windows
- **portable zip** — the executable is the upstream Electron binary renamed without rewriting its PE resources, so it also runs on machines where Smart App Control blocks freshly compiled unsigned binaries

## What's in 1.1.1

- Click-through desktop pet: only the character's opaque pixels accept the mouse, using an alpha-mask hit test; gaps between the arms and the body, and the area outside the silhouette, let clicks reach the desktop underneath
- The speech bubble is treated as solid, so a click on it cannot open a desktop icon behind the pet
- Entrance animation re-aligned to the idle sprite — the character occupies 91.6% of the sprite frame but only 48.7% of the video frame, so switching between video and sprite used to make it visibly shrink
- Window state machine fixes: closing the main window no longer reopens it, and `--quit` exits immediately instead of starting a hidden pet process

## Code signing

> Release builds are code-signed by the [SignPath Foundation](https://signpath.org/)
> free code-signing program for open source projects.

Until the SignPath enrollment completes, the binaries in this release are
unsigned, so Windows SmartScreen may show an "unknown publisher" prompt.
