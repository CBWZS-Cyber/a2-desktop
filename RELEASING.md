# Releasing & version backup

Every released version must leave a recoverable copy of itself behind **before**
new code is pushed on top of it. In this repository that is done with a **tag +
a GitHub Release**, not by copying old sources into a `backup/` folder.

## Why tags and releases instead of a backup folder

Git already keeps every commit forever — nothing is ever lost by pushing new
code on top. A tag is just a human-readable bookmark onto a specific commit, and
a Release attaches the built installers to that bookmark. Together they give:

- `git checkout v1.1.1` — the exact source of that version, any time
- the Releases page — downloadable installers for that version, any time

Copying old source trees into a `backup/` directory would duplicate what Git
already stores and roughly double the repository size for no gain.

## Release checklist

1. **Confirm the previous version is anchored.** Check that the version
   currently on `main` already has a tag and a Release:

   ```bash
   git tag -l
   gh release list        # or the Releases page in the browser
   ```

   If it does not, tag it and publish it **before** committing the new version.
   This is the step that protects the old version.

2. Bump `version` in `package.json` (single source of truth — the Inno Setup
   script receives it via `/DMyAppVersion`, so nothing else needs editing).

3. Update `RELEASE_NOTES.md` for the new version.

4. Commit and push `main`.

5. Trigger the build with the new tag:

   ```
   Actions → Build desktop app → Run workflow
     sign        = true when SignPath is configured, otherwise false
     release_tag = v<new version>
   ```

   Pushing a `v*` tag also triggers it, but then every run must have signing
   credentials available.

6. Verify on the Releases page that **both** the new version and the previous
   one are present, each with its installers attached.

## Version history

| Version | Tag | Notes |
| --- | --- | --- |
| 1.1.1 | `v1.1.1` | First public build: desktop pet, click-through, tray, autostart |
| 1.1.4 | `v1.1.4` | Desktop-only settings block, close-to-tray/quit with a rememberable prompt, quit fix, smaller pet, on-screen position clamp, download handling |
| 1.1.7 | `v1.1.7` | Update prompts became an in-window HTML layer (capturable and clickable from `--smoke-update`), book-cover width fix carried in from the web app |

`1.1.2` and `1.1.3` were internal builds and were never released: `1.1.3` shipped
with a broken "quit the app" option (the process stayed in the tray), so it is
superseded by `1.1.4`.

`1.1.5` and `1.1.6` were published only through the desktop updater (a signed OSS
URL plus `/api/desktop/version`), to bring the auto-update channel up and to test
download → silent install → relaunch. They have no GitHub release; `1.1.7` is the
first build that ships the finished update UI.
