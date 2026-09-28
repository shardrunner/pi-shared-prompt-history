# Shared prompt history

Loads the last 100 interactive prompts from `~/.pi/agent/shared-prompt-history.jsonl` into Pi's normal Up/Down editor history when a session starts. Submissions from other Pi processes do **not** update already-open editors; a newly started session (including `/new`) takes a fresh snapshot. The file is shared across working directories, not sent to the model, and created with permissions `0600`.

Use `/history` to open a picker over the snapshot (newest first) and just type to fuzzy-filter it live (best match first; ↑/↓ to move, Enter to pick, Esc to cancel). `/history fix` opens it prefilled with `fix`. Selecting an entry restores it to the editor without submitting it. Search uses the snapshot taken when this session started, not newer prompts from other sessions.

Only interactive agent prompts and `!`/`!!` shell commands are saved. Pi's built-in slash commands, extension commands, and prompts submitted through RPC, print mode, or programmatically are not saved. Existing sessions' prompts are not imported retroactively. New prompts still appear in their own session's normal editor history immediately.

The JSONL file is append-only (one JSON string per line); it is not automatically pruned on disk. It may contain sensitive inputs. Keep it private or remove it when you no longer need it.

## Install

Clone this repository and register the checkout as a local Pi package:

```sh
pi install /absolute/path/to/shared-prompt-history
```

Pi loads a local package in place (no copy) and this package has no runtime
dependencies, so no `npm install` is needed to use it. Run `/reload` in existing
Pi instances.

## Test

```sh
npm ci --ignore-scripts
npm run check
```
