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
    sendUserMessage() { assert.fail("history must not submit prompts"); },
    sendMessage() { assert.fail("history must not send messages"); },
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
    ui: { setEditorComponent: () => assert.fail("shared history must not own the editor") },
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

test("session starts capture history without owning, seeding, or changing the editor", async (t) => {
  const path = isolatedHistory(t);
  appendPrompt(path, "shared-only startup entry");
  const extension = captureExtension();
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
  for (const reason of ["startup", "new", "resume", "fork", "reload"] as const) {
    await extension.start({ type: "session_start", reason }, ctx);
  }
});

test("history restores full text from a fixed snapshot; a subsequent start captures new entries", async (t) => {
  const path = isolatedHistory(t);
  const original = "startup-only 界🙂\nfull multiline prompt";
  const later = "unique-after-startup\nsecond line";
  appendPrompt(path, original);
  initTheme("dark", false);
  const extension = captureExtension();
  const forbidden = () => assert.fail("history lookup must not own, seed, paste, or submit");
  const restored: string[] = [];
  let query = "";
  let refreshed = false;
  const ctx = {
    mode: "tui",
    ui: {
      setEditorComponent: forbidden,
      getEditorComponent: forbidden,
      pasteToEditor: forbidden,
      setEditorText: (text: string) => { restored.push(text); },
      async custom(factory: Parameters<ExtensionContext["ui"]["custom"]>[0]) {
        let selection: unknown;
        let completed = false;
        const picker = await factory({} as TUI, { fg: (_role: string, text: string) => text } as Theme,
          getKeybindings() as Parameters<typeof factory>[2], (value) => { selection = value; completed = true; }) as Component;
        const rendered = picker.render(100).join("\n");
        if (query === "unique-after-startup") assert.equal(rendered.includes("second line"), refreshed);
        picker.handleInput!("\r");
        if (!completed) picker.handleInput!("\x1b"); // No match in the fixed snapshot.
        assert.equal(completed, true);
        return selection;
      },
    },
  } as unknown as ExtensionCommandContext;
  await extension.start({ type: "session_start", reason: "startup" }, ctx);
  appendPrompt(path, later);
  await extension.history.handler(query, ctx);
  assert.deepEqual(restored, [original]);
  query = "unique-after-startup";
  await extension.history.handler(query, ctx);
  assert.deepEqual(restored, [original]);
  await extension.start({ type: "session_start", reason: "reload" }, ctx);
  refreshed = true;
  await extension.history.handler(query, ctx);
  assert.deepEqual(restored, [original, later]);
});

test("cancel leaves the draft alone and empty history notifies without opening a picker", async (t) => {
  const path = isolatedHistory(t);
  initTheme("dark", false);
  const extension = captureExtension();
  const forbidden = () => assert.fail("cancel/empty must not touch the draft or main editor");
  let opened = 0;
  const notifications: [string, string | undefined][] = [];
  const ctx = {
    mode: "tui",
    ui: {
      setEditorComponent: forbidden,
      getEditorComponent: forbidden,
      setEditorText: forbidden,
      pasteToEditor: forbidden,
      notify: (message: string, level?: string) => { notifications.push([message, level]); },
      async custom(factory: Parameters<ExtensionContext["ui"]["custom"]>[0]) {
        opened++;
        let selection: unknown = "not cancelled";
        const picker = await factory({} as TUI, {} as Theme,
          getKeybindings() as Parameters<typeof factory>[2], (value) => { selection = value; }) as Component;
        picker.handleInput!("\x1b");
        assert.equal(selection, undefined);
        return selection;
      },
    },
  } as unknown as ExtensionCommandContext;
  await extension.start({ type: "session_start", reason: "startup" }, ctx);
  await extension.history.handler("", ctx);
  assert.equal(opened, 0);
  assert.deepEqual(notifications, [["No prompts in this session's history snapshot.", "info"]]);
  appendPrompt(path, "cancel me");
  await extension.start({ type: "session_start", reason: "new" }, ctx);
  await extension.history.handler("", ctx);
  assert.equal(opened, 1);
  assert.equal(notifications.length, 1);
});

test("non-TUI starts and history commands never touch UI APIs", async (t) => {
  const path = isolatedHistory(t);
  appendPrompt(path, "synthetic prompt");
  const extension = captureExtension();
  const ui = new Proxy({}, { get: () => assert.fail("non-TUI must not access UI") });
  for (const mode of ["rpc", "print", "json"] as const) {
    const ctx = { mode, ui } as unknown as ExtensionCommandContext;
    await extension.start({ type: "session_start", reason: "startup" }, ctx);
    await extension.history.handler("", ctx);
  }
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
