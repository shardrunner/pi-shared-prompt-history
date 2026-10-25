# Shared prompt history

> **Disclaimer:** This extension is vibe coded for personal use. Use at your own risk.

Search saved prompts across sessions with `/history`. Each TUI session start (startup, new, resume, fork, or reload) captures the last 100 entries from `~/.pi/agent/shared-prompt-history.jsonl` for the picker. Submissions from other Pi processes do **not** update an already-open session's snapshot. The file is shared across working directories, not sent to the model, and created with permissions `0600`.

Native Up/Down editor history is separate and untouched by this extension. Shared prompts are not imported into it, and this package never replaces the prompt editor or installs editor key handlers. It can load before or after `pi-modal-editor`.

Use `/history` to open a picker over the snapshot (newest first) and just type to fuzzy-filter it live (best match first; ↑/↓ to move, Enter to pick, Esc to cancel). `/history fix` opens it prefilled with `fix`. Selecting an entry replaces the current draft with its full text, including multiple lines, without submitting it or adding it directly to native history. Cancel leaves the draft unchanged. Search uses the snapshot taken when this session started, not newer prompts from other sessions.

Only TUI agent prompts with an `interactive` input source and TUI `!`/`!!` shell commands are saved. Pi's built-in slash commands, extension commands, and prompts submitted through RPC, print, or JSON mode are not saved. Programmatic callers bound to TUI mode must label injected prompts with `source: "extension"` to exclude them. Existing sessions' prompts are not imported retroactively. Pi remains responsible for adding submitted prompts to the current session's native editor history.

The JSONL file is append-only (one JSON string per line); it is not automatically pruned on disk. It may contain sensitive inputs. Keep it private or remove it when you no longer need it.

## Install

Install from GitHub; Pi clones it and `pi update --extensions` keeps it current:

```sh
pi install git:github.com/shardrunner/pi-shared-prompt-history
```

For development, register a local checkout instead:

```sh
pi install /absolute/path/to/pi-shared-prompt-history
```

Pi loads a local package in place (no copy) and this package has no runtime
dependencies, so no `npm install` is needed to use it. Run `/reload` in existing
Pi instances.

## Test

```sh
npm ci --ignore-scripts
npm run check
```
