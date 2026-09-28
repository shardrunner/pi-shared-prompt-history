import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CustomEditor, getAgentDir, getSelectListTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Component, type Focusable, fuzzyFilter, Input, type KeybindingsManager, SelectList } from "@earendil-works/pi-tui";

const HISTORY_LIMIT = 100;
const historyPath = () => join(getAgentDir(), "shared-prompt-history.jsonl");

/** Entries are stored oldest first. One append-only JSON string per line. */
export function readHistory(path: string): string[] {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const lines = contents.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-HISTORY_LIMIT).map((line) => {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "string") throw new Error(`Invalid shared prompt history entry in ${path}`);
    return value;
  });
}

/** Fuzzy match, best first; the stable sort keeps equally good matches newest first. */
export function searchHistory(snapshot: readonly string[], query: string): string[] {
  return fuzzyFilter([...snapshot].reverse(), query, (prompt) => prompt);
}

/** Search box above a result list: typing filters, list keys navigate/confirm/cancel. */
function historyPicker(
  snapshot: readonly string[],
  query: string,
  title: string,
  keybindings: KeybindingsManager,
  done: (prompt: string | undefined) => void,
): Component & Focusable {
  const input = new Input({ prompt: "> " });
  input.setValue(query);
  const listKeys = ["tui.select.up", "tui.select.down", "tui.select.confirm", "tui.select.cancel"] as const;
  let list: SelectList;
  const refresh = () => {
    const matches = searchHistory(snapshot, input.getValue());
    // SelectList expects single-line labels; values index into the full prompts for restoration.
    const items = matches.map((prompt, index) => ({ value: String(index), label: prompt.replace(/\s+/g, " ") }));
    list = new SelectList(items, 12, getSelectListTheme());
    list.onSelect = (item) => done(matches[Number(item.value)]);
    list.onCancel = () => done(undefined);
  };
  refresh();
  return {
    get focused() {
      return input.focused;
    },
    set focused(value) {
      input.focused = value;
    },
    handleInput(data) {
      if (listKeys.some((key) => keybindings.matches(data, key))) return list.handleInput(data);
      const before = input.getValue();
      input.handleInput(data);
      if (input.getValue() !== before) refresh();
    },
    invalidate() {
      input.invalidate();
      list.invalidate();
    },
    render(width) {
      return [title, ...input.render(width), ...list.render(width)];
    },
  };
}

export function appendPrompt(path: string, text: string): void {
  const prompt = text.trim();
  if (!prompt) return;
  mkdirSync(dirname(path), { recursive: true });
  // O_APPEND avoids read-modify-write races between independently running Pi processes.
  appendFileSync(path, `${JSON.stringify(prompt)}\n`, { mode: 0o600, flag: "a" });
}

export default function (pi: ExtensionAPI): void {
  let currentSnapshot: string[] = [];
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    // Capture once. Never re-read when an already-open editor handles Up.
    const snapshot = readHistory(historyPath());
    currentSnapshot = snapshot;
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new CustomEditor(tui, theme, keybindings);
      for (const prompt of snapshot) editor.addToHistory(prompt);
      return editor;
    });
  });

  pi.registerCommand("history", {
    description: "Fuzzy-search shared prompt history from this session's startup snapshot: /history [term]",
    handler: async (query, ctx) => {
      if (ctx.mode !== "tui") return;
      if (currentSnapshot.length === 0) {
        ctx.ui.notify("No prompts in this session's history snapshot.", "info");
        return;
      }
      const snapshot = currentSnapshot;
      const selection = await ctx.ui.custom<string | undefined>((_tui, theme, keybindings, done) => {
        const title = theme.fg("accent", "Prompt history") + theme.fg("dim", " · type to fuzzy search · ↑↓ enter esc");
        return historyPicker(snapshot, query, title, keybindings, done);
      });
      if (selection !== undefined) ctx.ui.setEditorText(selection);
    },
  });

  pi.on("input", (event) => {
    if (event.source === "interactive") appendPrompt(historyPath(), event.text);
  });
  pi.on("user_bash", (event, ctx) => {
    if (ctx.mode === "tui") appendPrompt(historyPath(), `${event.excludeFromContext ? "!!" : "!"}${event.command}`);
  });
}
