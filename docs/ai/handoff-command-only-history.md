---
summary: Handoff for separating the /history picker from native Up/Down editor history.
read_when:
  - Implementing command-only shared history without editor ownership or native-history seeding.
  - Verifying shared history and the modal editor work independently in either load order.
---

# Handoff: separate shared history from the prompt editor

Prepared: 2026-10-09T22:36:09+02:00.

**This is an implementation guide, not an implemented refactor.** At handoff time,
shared history still creates an editor and seeds its native history. This task
only writes the handoff; runtime code and configuration have not been changed.

## 1. Goal and reason

The user distinguishes two features and wants the design to respect that boundary:

1. **Native Up/Down history:** Pi's normal editor history and navigation.
2. **Shared `/history` lookup:** search saved prompts across sessions and replace
   the current draft with a selected prompt.

The second feature does not require an editor replacement. It needs only:

```ts
ctx.ui.setEditorText(selectedPrompt);
```

The existing extension additionally imports shared prompts into native Up/Down
history. That extra integration is why it owns an editor factory and why the
modal extension currently has to wrap it. Remove that extra integration rather
than building more editor-composition infrastructure around it.

### Desired boundary

- Shared history records eligible prompts, captures a picker snapshot, provides
  `/history`, and replaces draft text **only after a selection**.
- Shared history never replaces the editor, installs editor key handlers, or adds
  shared entries to the native editor history.
- Pi remains responsible for native history; modal forwards native arrows and
  adds its existing Vim-like editing behavior.
- Selecting a shared prompt does not submit it. If the user subsequently submits
  it, Pi's ordinary submission path may add it to native history as usual.

Here, “command-only” means no prompt-editor ownership; it does **not** mean
removing the recording or session-start event handlers.

## 2. Projects, configuration, and baseline

Projects are separate Git repositories, not one monorepo:

```text
/home/michaelb/Documents/repos/projects/pi-extensions/
├── pi-shared-prompt-history/
└── pi-modal-editor/
```

### Shared history

- Worktree: `/home/michaelb/Documents/repos/projects/pi-extensions/pi-shared-prompt-history`
- Baseline HEAD: `99c3501` — `test(history): simplify heading and privacy assertions`
- Files: `index.ts`, `index.test.ts`, `README.md`, `package.json`.
- Existing validation result: 5 tests and TypeScript check passed.
- Development host dependencies are pinned to Pi **0.99.0**; the actual running
  host is Pi **1.1.0**. The proposed removal introduces no newer production API,
  so do not upgrade dependencies or regenerate the lockfile without a reason.
- Remote already exists: `git@github.com:shardrunner/pi-shared-prompt-history.git`.

### Modal editor

- Worktree: `/home/michaelb/Documents/repos/projects/pi-extensions/pi-modal-editor`
- Baseline HEAD: `2c43027` — `fix(modal-editor): preserve Kitty key identity in normal mode`
- Existing validation result: 33 tests and TypeScript check passed.
- Earlier commits: `f9ee4ad` made `yy` copy the whole expanded draft;
  `54e5ed5` fixed reviewed editing issues.
- Production code is in `index.ts`; tests are in `index.test.ts`.

### Runtime configuration

`/home/michaelb/.pi/agent/settings.json` already references both absolute local
package paths. Shared history is currently earlier in `packages`; modal is last.
Keep the existing paths. There is no need to reinstall or edit the package list
just to make this refactor. Afterward the relative order of **these two** should
no longer matter, though other editor-owning packages may still affect modal.

### Preserve existing work

Before editing, inspect both worktrees. At handoff time:

- Modal has an untracked `docs/ai/oracle-reviews.md`.
- Shared history has an untracked `docs/ai/oracle-reviews.md` under `docs/`.
- The old managed checkout at
  `/home/michaelb/.pi/agent/git/github.com/shardrunner/pi-shared-prompt-history`
  has a preexisting dirty `package-lock.json`. Do not modify/delete that checkout
  or discard the change; Pi is using the development checkout now.

The oracle notes are historical review records deliberately left uncommitted.
Do not stage them accidentally. Prior reviews said no shared-history patch was
needed **while retaining cross-session Up/Down behavior**. This handoff targets a
new separation of responsibilities, so those conclusions are not a reason to
retain the seeding feature. Preserve the historical records rather than rewriting
what the reviewers concluded.

## 3. Exact source of the conflict

In shared history's `index.ts`:

```ts
import { CustomEditor, getAgentDir, getSelectListTheme, type ExtensionAPI }
  from "@earendil-works/pi-coding-agent";
```

The `session_start` handler currently does this:

```ts
const snapshot = readHistory(historyPath());
currentSnapshot = snapshot;
ctx.ui.setEditorComponent((tui, theme, keybindings) => {
  const editor = new CustomEditor(tui, theme, keybindings);
  for (const prompt of snapshot) editor.addToHistory(prompt);
  return editor;
});
```

That factory exists solely to seed the hidden native history list. It is not
needed for the picker. The command already restores its result correctly:

```ts
if (selection !== undefined) ctx.ui.setEditorText(selection);
```

The modal extension currently captures `ctx.ui.getEditorComponent()`, invokes
that factory when one exists, or creates a native `CustomEditor` otherwise, then
decorates the resulting instance. Shared history can stop owning the editor
without requiring a modal production-code rewrite.

## 4. Minimal implementation

### A. Edit only the relevant shared-history code

1. Remove `CustomEditor` from the coding-agent import.
2. Delete the `setEditorComponent` factory and all `addToHistory` calls.
3. Keep session snapshot capture; simplify the handler to:

```ts
let currentSnapshot: string[] = [];
pi.on("session_start", (_event, ctx) => {
  if (ctx.mode !== "tui") return;
  // Capture once for /history; an open session keeps its own snapshot.
  currentSnapshot = readHistory(historyPath());
});
```

4. Leave `/history` selection restoration through `setEditorText` unchanged.
5. Leave the `input` and `user_bash` recording handlers unchanged.
6. Leave parsing, fuzzy matching, JSONL format, permissions, and picker UI alone.

No new factory wrapper, monkey patch, terminal-input listener, shared event bus,
keybinding interception, private editor access, or configurable seeding toggle.
Target the new behavior directly; do not preserve the removed feature behind a
compatibility option.

### B. Preserve these existing behaviors explicitly

- Snapshot is taken on each TUI `session_start`, including new/resume/fork/reload.
- An already-open session's `/history` does not reread the file or acquire prompts
  appended by other sessions. Keep this fixed-snapshot behavior; live refresh is
  a separate feature, not part of removing editor ownership.
- Keep the latest 100 entries in the in-memory snapshot; the on-disk JSONL file
  remains append-only and is not pruned.
- `/history [term]` supports prefilled fuzzy search, newest-first ordering for
  ties, keyboard selection, cancel, and restoration of full multiline text.
- Empty history shows the existing notification; cancel leaves the draft alone.
- Only eligible TUI interactive prompts and TUI `!`/`!!` events are recorded, as
  before. Keep exclusion of extension-source prompts and non-TUI operation.
- Do not submit selected prompts or add them directly to native history.
- Keep default private file creation mode `0600` and existing error behavior.

### C. Do not redesign modal as part of this change

Keep whole-draft `yy`, native arrow forwarding, `dd` without yanking, paste safety,
normal/insert modes, and existing app-shortcut delegation unchanged.

The existing generic factory wrapper can remain: it is still useful when another
package owns an editor, and its no-custom-factory path already creates a native
`CustomEditor`. Removing generic composition would broaden this refactor and
could affect other editor integrations.

## 5. Test-first guide

Follow the requested workflow: **make edits before running tests**. Add the
focused regression tests first, then run them to demonstrate the old implementation
fails. Do not spend time running the unchanged baseline suite before any edits.

### Required regression: session start never touches the prompt editor

Use existing `isolatedHistory(t)` and `captureExtension()` helpers. Seed a
synthetic history file, then pass a UI mock whose editor-affecting methods throw:

```ts
const forbidden = () => assert.fail("shared history must not own or seed the editor");
const ctx = {
  mode: "tui",
  ui: {
    setEditorComponent: forbidden,
    getEditorComponent: forbidden,
    setEditorText: forbidden,
    pasteToEditor: forbidden,
  },
} as unknown as ExtensionContext;

await extension.start({ type: "session_start", reason: "startup" }, ctx);
```

The old implementation should fail at `setEditorComponent`. After the removal,
the handler should complete without calling any editor method. Cover subsequent
session-start reasons with small, focused cases if using a loop; do not build a
new test framework.

### Existing picker test needs its permissive stub removed

The existing test named
`picker heading follows the supplied live theme and fits resized widths without losing state`
currently provides `ui: { setEditorComponent() {} }` at session start. That hides
editor replacement. Replace the permissive stub with a forbidden-call assertion
or an empty UI mock after the dedicated regression exists.

Keep that test's real picker execution, focus/resize/theme checks, and exact
restoration of the older multiline prompt. Do not replace the actual picker with
a mock that returns a predetermined string and therefore fails to test the
captured snapshot.

### Command and snapshot coverage

Verify, using the actual picker factory where selection contents matter:

- `/history` selects an entry from the startup snapshot and calls `setEditorText`
  once with full text; it does not call `setEditorComponent`, submit, or seed
  native history.
- Cancel returns `undefined` and calls no draft setter.
- Empty history notifies without opening a picker or touching the draft.
- Appending a uniquely named entry after startup does not change that session's
  results; a subsequent `session_start` includes it.
- Non-TUI starts and commands do not touch UI APIs.

Retain the existing parsing, fuzzy matching, input privacy, and history-limit
regressions. Recording code is unchanged; avoid unrelated test-suite expansion.

## 6. Integration with the real modal package

Do not rely solely on the existing modal tests: some deliberately use a fake
history-seeding factory to test generic editor composition.

### Exercise both orders

Use Pi 1.1.0's `DefaultResourceLoader` and `SettingsManager.inMemory` from the
modal project's installed dependencies, with these two local packages only:

```ts
packages: [sharedPath, modalPath]
// Repeat with:
packages: [modalPath, sharedPath]
```

Use an isolated agent directory and synthetic JSONL entries. Do not inspect,
truncate, or rewrite the user's actual prompt-history file for testing. If
setting `PI_CODING_AGENT_DIR`, restore its previous value after the test.

For startup/new/resume/fork/reload:

1. Clear the simulated editor factory before dispatching session-start handlers,
   matching Pi's `resetExtensionUI()` behavior.
2. Capture UI factory setter calls. Only modal should install a main-editor
   factory; shared history should install none in either ordering.
3. Instantiate the resulting editor; check mode rendering and ordinary modal
   commands still execute once.
4. Give the editor a synthetic native entry such as `native-local-only` to model
   Pi's normal history population. This is **test setup**, not a new shared-history
   behavior.
5. Move to line start before testing Up/`k`, since native history navigation
   depends on cursor position. Verify native navigation does not acquire a unique
   entry that exists only in the shared JSONL file.
6. Execute `/history` through its real picker and select that shared-only entry.
   Verify the draft changes, but the picker selection itself does not submit or
   append that entry to the native list.
7. Check whole-draft `yy`, collapsed-paste expansion, `dd`, and app-shortcut
   delegation remain covered by the unchanged modal suite.

### Important real-TUI verification boundary

Pi's custom-editor setter copies text and handlers, not the previous editor's
hidden history collection. Native history population is done elsewhere by Pi.
Therefore “shared history installs no factory” alone does **not** prove native
history works on every UI lifecycle path.

Source inspection of Pi 1.1.0 shows:

- Initial startup binds extensions before `renderInitialMessages()` populates
  the active editor's history.
- Session replacement can use `rebindCurrentSession({ renderBeforeBind: true })`,
  rendering the session before binding extensions.
- The modal extension can then create a new editor.

This is a verification risk, not a runtime reproduction performed for this
handoff. Manually check current-session history after startup, resume, fork, and
reload with modal enabled. If native session-history loss appears, reproduce it
against the baseline as well and report whether it is preexisting/masked by
shared seeding or introduced by the refactor. **Do not restore shared seeding as
a workaround.** Ask before expanding into a modal/Pi lifecycle-history fix; do
not silently introduce private-history copying or claim native behavior was
preserved without testing it.

### Modal test naming and docs

- Keep generic pre-existing-editor factory tests, but rename misleading
  “shared history” fixture descriptions if they imply the real command-only
  package still owns a factory.
- Retain the no-custom-factory and UI-reset tests.
- Add actual two-package, both-order integration coverage at an appropriate
  boundary; do not add an undeclared cross-repository production dependency.

## 7. Documentation changes during implementation

Shared-history `README.md` currently opens with a promise to load shared entries
into normal Up/Down history. Replace that promise with the command-only lookup
model. State explicitly that native Up/Down is separate and untouched by this
extension. Keep snapshot, privacy, recording exclusions, and installation details.

Also update current descriptions in modal's:

- `README.md`
- `docs/ai/design.md`
- `docs/ai/report.md`

Remove the claim that modal must follow **shared history specifically**. Keep the
more general caveat about other packages that replace the editor. Update the
report's current shared-history decision to distinguish the newly requested
separation from the earlier preserve-existing-behavior decision. Do not rewrite
historical oracle reviews.

## 8. Validation and delivery

Dependencies are already installed in both development worktrees. After edits:

```bash
cd /home/michaelb/Documents/repos/projects/pi-extensions/pi-shared-prompt-history
npm run check
git diff --check

cd /home/michaelb/Documents/repos/projects/pi-extensions/pi-modal-editor
npm run check
git diff --check
```

If dependencies are missing, use the project's documented `npm ci --ignore-scripts`.
If a tool, credential, or npm release-age policy blocks installation, report the
exact error rather than silently weakening policy or changing versions.

Then perform the isolated real-package integration and manual TUI checks above.
Use `/reload` or a fresh Pi instance to load local changes. Avoid personal API
calls merely to run unit tests; use mocks and synthetic entries where possible.

Commit coherent changes in each Git repository. Suggested shared-history message:

```text
refactor(history)!: separate shared lookup from native editor history

BREAKING CHANGE: shared prompts are no longer imported into native Up/Down
history. Use /history to search and restore prompts across sessions.
```

Commit any modal test/documentation adjustments separately in the modal repo.
Stage exact files, not the entire `docs/` tree, because the oracle records are
untracked and intentionally uncommitted. Do not push, create a remote, remove
cached checkouts, or discard unrelated changes without confirmation.

## 9. Acceptance checklist

- [ ] Shared history imports no `CustomEditor` and calls no `setEditorComponent`,
      `getEditorComponent`, or `addToHistory`.
- [ ] Session start captures the search snapshot without touching the prompt.
- [ ] `/history` still searches, restores full text, cancels cleanly, and does not
      submit or directly seed native history.
- [ ] Recording, snapshot lifetime, privacy rules, format, and limits are unchanged.
- [ ] Native history and shared lookup are verified as separate features.
- [ ] Modal works with the real shared package in both relative load orders.
- [ ] Native local-session history is checked on actual lifecycle transitions;
      any separate host/modal problem is reported honestly, not worked around by
      reintroducing the removed integration.
- [ ] Both checks pass, integration/manual results are recorded, and current docs
      describe the new boundary accurately.
- [ ] Only scoped changes are committed; no history data is deleted or migrated,
      unrelated work is preserved, and nothing is pushed without confirmation.

## 10. Non-goals

No live-refresh redesign, history pruning/migration, new shortcuts, native Up/Down
interception, optional compatibility seeding mode, full Vim features, dependency
refresh, new third-party package, or speculative general editor-composition
framework. If verification exposes a separate issue, report it and ask rather
than expanding scope silently.
