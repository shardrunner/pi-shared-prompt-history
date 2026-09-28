import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendPrompt, readHistory, searchHistory } from "./index.ts";

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
