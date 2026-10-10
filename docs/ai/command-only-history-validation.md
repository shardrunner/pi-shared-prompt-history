---
summary: Command-only history implementation, red-green checks, real-package integration, and live TUI lifecycle limitation.
read_when:
  - Verifying the separation of shared lookup and native editor history.
  - Investigating native session-history loss with modal on Pi 1.1.0.
---

# Command-only shared history validation

The implementation and live TUI results below were recorded for shared history
`42756c8` and modal `cc3c66b` (whose production code matched `5deffd3`). Later modal
simplifications are separate changes; the original test counts and live results
are not a fresh validation of those revisions. See the final review below.

Implemented the requested command-only boundary:
shared history records eligible prompts, captures a fixed session-start snapshot,
and replaces the draft only after a `/history` selection. It no longer imports
`CustomEditor`, installs an editor factory, or seeds native Up/Down history.
Recording, parsing, picker UI, file permissions, format, and limits are unchanged.
No dependencies, lockfiles, personal settings, or history data were changed.

## Automated validation

- Added regressions before running tests. Four focused tests failed on the old
  `setEditorComponent` call, including the existing real-picker heading test
  after removal of its permissive factory stub.
- Shared `npm run check`: TypeScript and **9 tests pass**. Coverage includes all
  five TUI start reasons without editor access, real-picker multiline restoration,
  fixed snapshots after external appends, fresh snapshots after reload, cancel,
  empty notifications, non-TUI guards, and existing search/parsing/privacy/limits.
- Modal `npm run check`: TypeScript and **92 tests pass**, including its unchanged
  editing/clipboard/cursor suite and two new real-package integration tests.
- `git diff --check` passes in both repositories.

`../pi-modal-editor/shared-history.integration.test.ts` uses the modal project's
Pi **1.1.0** `DefaultResourceLoader` and `SettingsManager.inMemory`, loading only
the two real local packages in both relative orders. It isolates the agent
folder, uses synthetic JSONL, and restores `PI_CODING_AGENT_DIR` afterward.
For startup/new/resume/fork/reload it resets the simulated factory, observes only
modal installing a factory, checks modes and single execution of modal commands,
adds a synthetic native-local entry as test setup, and exhausts native Up/`k`
navigation from line start. The real picker restores a shared-only multiline
entry exactly once without submitting, seeding, replacing the main editor, or
appending to JSONL. Native navigation afterward still excludes that shared entry.

The test uses a sibling shared-history checkout by default. It accepts
`PI_SHARED_HISTORY_PACKAGE` for another location and skips only these integration
tests when no sibling or override exists. No cross-repository production dependency
was added. These simulated lifecycle checks do not prove Pi's own history
population works during actual transitions.

## Live Pi 1.1.0 TUI smoke check

Ran real Pi in a dedicated tmux server, regular TUI mode, with isolated agent
folders and synthetic session files. Used `--offline`, no credentials, no tools,
no discovered extensions/skills/templates/context/themes, and explicit extension
paths. No model/API request, personal history read, or desktop clipboard operation
was performed. Temporary test-only commands invoked the real command-context
`switchSession`, `fork(..., { position: "at" })`, and `newSession({ setup })`
operations; `/reload` was the built-in command. A test-only Ctrl+Q shortcut recorded
`getEditorText()` and cleared the draft. Navigation used Escape then line-start
`0` and `k` with modal, and Ctrl+A/Up without modal.

Initial startup used a synthetic session with `native-startup-0` and
`native-startup-1`. Resume switched to a session with `native-resume-0` and
`native-resume-1`. Fork retained the selected second user message. The new-session
setup appended `native-new-only` without a model call. These prompts were absent
from the synthetic shared JSONL; its only entry was a unique multiline shared
prompt. The baseline was shared history at `f55a2f9` (before this refactor), with
unchanged modal production code at `5deffd3`.

| Lifecycle / check | Command-only shared + modal | Old shared seeding + modal | Command-only shared, no modal |
| --- | --- | --- | --- |
| Startup native Up/`k` | `native-startup-1` | `native-startup-1` | `native-startup-1` |
| `/history` at startup | Full shared-only multiline draft | Full shared-only multiline draft | Not exercised |
| Resume native Up/`k` | Empty draft | Shared-only entry, not native resume entry | `native-resume-1` |
| Fork native Up/`k` | Empty draft | Shared-only entry, not native resume entry | `native-resume-1` |
| Reload native Up/`k` | Empty draft | Shared-only entry, not native resume entry | `native-resume-1` |
| New session with setup message | Empty draft | Shared-only entry, not native new entry | `native-new-only` |

The live modal checks used history-first order; real-package automated coverage
checks both orders. Repeated `gg0k` navigation after resume confirmed that the
missing native entries were not merely hidden behind a multiline cursor position
or another history entry. The actual native resume messages were visible in the
transcript in both runs, but absent from modal's editor navigation.

### Separate preexisting host/modal issue

The native-history loss is reproduced against the baseline, not introduced by
removing shared history's factory. Old seeding supplies shared entries instead
and can mask the absence of local session entries. The no-modal control preserves
native history on every tested transition.

Pi 1.1.0 source explains the boundary: `setCustomEditorComponent` copies text,
callbacks, appearance, and app handlers, but not hidden native history. Startup
binds extensions before `renderInitialMessages` populates the active editor.
Session replacement can render before binding a newly created modal editor;
reload similarly resets the editor and reconstructs the transcript before the
new modal factory takes ownership. Synthetic native setup in the integration
tests deliberately cannot detect that host lifecycle ordering problem.

**Do not claim native session history is preserved on all transitions.** Fixing
that separate host/modal issue requires user approval. No private-history copying,
shared-seeding fallback, or modal production-code redesign was added.
Historical oracle reviews were preserved during implementation, then deleted
along with the completed handoff after explicit user approval. Nothing was pushed.

## Final focused review

Re-read the shared-history production diff, picker regressions, and real-package
integration coverage, initially against modal's newer `987ec68` checkout. No shared-history
production correction was needed: the change only removes editor ownership and
seeding, adds no hot-path work, and leaves recording and picker behavior alone.
The later modal simplifications were preserved, not included in this refactor.

Corrected one integration-test instrumentation gap: before invoking `/history`,
attribute UI access to the shared-history extension rather than the last dispatched
startup handler. This ensures the forbidden-editor-read assertion also covers
lookup in history-first order. This review did not change production code.

While the review was in progress, concurrent modal commit `1f9cee7` incorporated
that instrumentation correction and separately added native-history restoration.
Those independent production changes were preserved, not implemented as part of
this review. After the review edits, both `npm run check` commands passed: shared
history **9 tests**, current modal **86 tests**, including both real-package load
orders. TypeScript and whitespace checks passed in both repositories. The earlier
live TUI reproduction above remains historical; it was not repeated against the
new modal lifecycle fix, so this review makes no fresh live-TUI claim about it.
