import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  initTheme,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type ExtensionHandler,
  type InputEvent,
  type InputEventResult,
  type RegisteredCommand,
  type SessionStartEvent,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, type Focusable, getKeybindings, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import sharedPromptHistory, { appendPrompt, readHistory, searchHistory } from "./index.ts";

function isolatedHistory(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-history-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  return join(dir, "shared-prompt-history.jsonl");
}

function captureExtension() {
  const handlers = new Map<string, unknown>();
  let history!: RegisteredCommand;
  sharedPromptHistory({
    on(event: string, handler: unknown) {
      handlers.set(event, handler);
      return () => {};
    },
    registerCommand(name: string, command: RegisteredCommand) {
      assert.equal(name, "history");
      history = command;
    },
  } as unknown as ExtensionAPI);
  return {
    start: handlers.get("session_start") as ExtensionHandler<SessionStartEvent>,
    input: handlers.get("input") as ExtensionHandler<InputEvent, InputEventResult>,
    history,
  };
}

test("new snapshots include earlier sessions' prompts, but old snapshots do not change", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-history-"));
  const path = join(dir, "history.jsonl");
  try {
    appendPrompt(path, "first");
    const firstSession = readHistory(path);
    appendPrompt(path, "second");
    const secondSession = readHistory(path);
    assert.deepEqual(firstSession, ["first"]);
    assert.deepEqual(secondSession, ["first", "second"]);
    assert.deepEqual(readFileSync(path, "utf8").trim().split("\n"), ['"first"', '"second"']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fuzzy-searches the captured snapshot case-insensitively, newest first on ties", () => {
  const snapshot = ["First fix", "unrelated", "Second FIX"];
  assert.deepEqual(searchHistory(snapshot, "fix"), ["Second FIX", "First fix"]);
  assert.deepEqual(searchHistory(snapshot, ""), [...snapshot].reverse());
  assert.deepEqual(searchHistory(snapshot, "missing"), []);
  assert.deepEqual(searchHistory(snapshot, "unrltd"), ["unrelated"]);
  assert.deepEqual(searchHistory(snapshot, "sec fx"), ["Second FIX"]);
  assert.deepEqual(snapshot, ["First fix", "unrelated", "Second FIX"]);
});

test("picker heading follows the supplied live theme and fits resized widths without losing state", async (t) => {
  const path = isolatedHistory(t);
  const older = "older fix 界🙂\nfull prompt";
  appendPrompt(path, older);
  appendPrompt(path, "unrelated");
  appendPrompt(path, "newer fix");
  initTheme("dark", false);
  const extension = captureExtension();
  await extension.start({ type: "session_start", reason: "startup" }, {
    mode: "tui",
    ui: { setEditorComponent() {} },
  } as unknown as ExtensionContext);

  let accent = "\x1b[31m";
  let dim = "\x1b[2m";
  const theme = { fg: (role: string, text: string) => `${role === "accent" ? accent : dim}${text}\x1b[0m` } as Theme;
  let restored: string | undefined;
  await extension.history.handler("fix", {
    mode: "tui",
    ui: {
      async custom(factory: Parameters<ExtensionContext["ui"]["custom"]>[0]) {
        let selection: unknown;
        const picker = await factory({} as TUI, theme, getKeybindings() as Parameters<typeof factory>[2], (value) => { selection = value; }) as Component & Focusable;
        picker.focused = true;
        picker.handleInput!("\x1b[B");
        const before = picker.render(80);
        const expectedHeading = `${accent}Prompt history\x1b[0m${dim} · type to fuzzy search · ↑↓ enter esc\x1b[0m`;
        assert.equal(before[0], expectedHeading);
        accent = "\x1b[34m";
        dim = "\x1b[90m";
        picker.invalidate();
        const after = picker.render(80);
        assert.equal(after[0], expectedHeading.replace("\x1b[31m", accent).replace("\x1b[2m", dim));
        assert.deepEqual(after.slice(1), before.slice(1));
        assert.equal(picker.focused, true);
        for (const width of [20, 32, 40, 80]) {
          for (const line of picker.render(width)) assert.ok(visibleWidth(line) <= width, `line exceeds ${width} columns`);
        }
        picker.handleInput!("\r");
        return selection;
      },
      setEditorText(text: string) { restored = text; },
    },
  } as unknown as ExtensionCommandContext);
  assert.equal(restored, older);
});

test("records only interactive-source input in TUI mode, not print/JSON default-source input", async (t) => {
  const path = isolatedHistory(t);
  const { input } = captureExtension();
  for (const [mode, source] of [
    ["rpc", "interactive"],
    ["print", "interactive"],
    ["json", "interactive"],
    ["tui", "rpc"],
  ] as const) {
    const text = `${mode}:${source}`;
    assert.equal(await input({ type: "input", text, source }, { mode } as ExtensionContext), undefined);
    assert.equal(existsSync(path), false, text);
    assert.deepEqual(readHistory(path), [], text);
  }

  const text = "tui:interactive";
  assert.equal(await input({ type: "input", text, source: "interactive" }, { mode: "tui" } as ExtensionContext), undefined);
  assert.deepEqual(readHistory(path), [text]);
  const stored = readFileSync(path, "utf8");

  assert.equal(await input({ type: "input", text: "tui:extension", source: "extension" }, { mode: "tui" } as ExtensionContext), undefined);
  assert.equal(readFileSync(path, "utf8"), stored);
});

test("retains only 100 recent nonblank prompts and rejects corrupt history", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-history-"));
  const path = join(dir, "history.jsonl");
  try {
    for (let i = 0; i < 102; i++) appendPrompt(path, `prompt ${i}`);
    appendPrompt(path, "  ");
    assert.equal(readHistory(path).length, 100);
    assert.equal(readHistory(path)[0], "prompt 2");
    appendPrompt(path, "last\nline");
    assert.equal(readHistory(path).at(-1), "last\nline");
    appendFileSync(path, "not-json\n");
    assert.throws(() => readHistory(path), SyntaxError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
