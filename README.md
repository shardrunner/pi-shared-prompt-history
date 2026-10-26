# pi-shared-prompt-history

> **Disclaimer:** This extension is vibe coded for personal use. Use at your own risk.

Find and reuse prompts from other [Pi](https://pi.dev) sessions with `/history`. They
don't mix with the editor's Up/Down history and are never sent automatically.

## Why

- Pi's Up/Down history is rebuilt from the current session and isn't shared between Pi processes, so a good prompt from another project or terminal is hard to find again.

## Features

- `/history` opens a picker over recent prompts from all sessions and directories,
  newest first.
- Type to filter, with the best fuzzy matches first.
- Choosing a prompt replaces the current draft; you still decide whether to send it.
- Leaves the editor alone, so it works alongside
  [`pi-modal-editor`](https://github.com/shardrunner/pi-modal-editor) in either load order.

## Installation

Requires **Pi 0.99.0+** and **Node.js 24+**.

```sh
pi install git:github.com/shardrunner/pi-shared-prompt-history
```

Run `/reload` in open Pi sessions. Update with `pi update --extensions`.
For local development, install a checkout instead
(`pi install /absolute/path/to/pi-shared-prompt-history`). No runtime dependencies,
no build step.

## Usage

```text
/history          # open the picker
/history fix      # open it with "fix" already typed in
```

Use ↑/↓ to move, Enter to pick and Esc to cancel. Picking an entry replaces the draft
with the stored text, line breaks included, without sending it or adding it to the native
history. Cancelling leaves the draft as it was.

## Behavior and limitations

- **Snapshot:** each session start (startup, new, resume, fork or reload) loads the last
  100 entries from `~/.pi/agent/shared-prompt-history.jsonl`. Prompts sent from other
  Pi processes after that don't show up until the next session start.
- **What gets saved:** prompts you type in the TUI and TUI `!`/`!!` shell commands.
  Slash commands, extension commands, and RPC, print or JSON prompts are not saved.
  Extensions that send prompts in TUI mode should mark them with
  `source: "extension"` so they are excluded. Older sessions are not imported.
- **Stored text:** leading and trailing whitespace is removed when a prompt is saved.
- **Native history:** Up/Down history is still handled by Pi alone; this extension
  never touches it.
- **Privacy:** the file only grows (one JSON string per line) and is never trimmed
  automatically. It is created with permissions `0600` and is never sent to the model.
  It can contain sensitive input, so keep it private or delete it when you no longer
  need it.

## Development

```sh
npm ci --ignore-scripts
npm run check
```

Requires Node.js 24+. `check` runs strict TypeScript checking and the test suite.

## License

[MIT](LICENSE) © 2026 Michael Brunner
