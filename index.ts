import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CustomEditor, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

export function searchHistory(snapshot: readonly string[], query: string): string[] {
  const term = query.trim().toLowerCase();
  return snapshot.filter((prompt) => prompt.toLowerCase().includes(term)).reverse();
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
    description: "Search shared prompt history from this session's startup snapshot: /history [term]",
    handler: async (query, ctx) => {
      if (ctx.mode !== "tui") return;
      const matches = searchHistory(currentSnapshot, query);
      if (matches.length === 0) {
        ctx.ui.notify("No matching prompts in this session's history snapshot.", "info");
        return;
      }
      // SelectList expects single-line, distinct labels; keep full prompts for restoration.
      const labels = matches.map((prompt, index) => `${index + 1}. ${prompt.replace(/\s+/g, " ").slice(0, 120)}`);
      const selection = await ctx.ui.select("Prompt history (newest first)", labels);
      if (selection !== undefined) ctx.ui.setEditorText(matches[labels.indexOf(selection)]!);
    },
  });

  pi.on("input", (event) => {
    if (event.source === "interactive") appendPrompt(historyPath(), event.text);
  });
  pi.on("user_bash", (event, ctx) => {
    if (ctx.mode === "tui") appendPrompt(historyPath(), `${event.excludeFromContext ? "!!" : "!"}${event.command}`);
  });
}
