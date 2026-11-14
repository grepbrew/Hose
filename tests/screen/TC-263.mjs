// TC-263 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=on 2. click Qwen3-8B · RTX 4090 3. click Pod 4. expect This model can't use tools
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-263";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=on`, { waitUntil: "load" });
await page.waitForSelector("text=Qwen3-8B · RTX 4090", { state: "visible", timeout: 10000 }).catch(() => {});
await page.click('text="Qwen3-8B · RTX 4090" >> nth=0', { label: "open Qwen3-8B pod" });
await page.waitForSelector('text="Pod"', { state: "visible", timeout: 10000 }).catch(() => {});
await page.click('text="Pod"', { label: "open Pod tab" });
await page.waitForSelector("text=Use with coding tools", { state: "visible", timeout: 10000 }).catch(() => {});

// assert: the note, and no commands
const snap = await page.snapshot({ scope: "full_page" });
const ok = snap.includes("This model can't use tools, so coding tools won't work with it.") && !snap.includes("claude --settings") && !snap.includes("codex -p hose");
console.log(`${TC}: ${ok ? "PASS" : "FAIL"}`);

try {
  await page.screenshot({ path: `${EVIDENCE}/${TC}.png`, fullPage: true });
} catch (e) {
  console.log(`${TC}: evidence skipped (${e.message})`);
}
if (!ok) {
  console.log(snap);
  process.exitCode = 1;
}

try {
  await task.finish({ keep: [] });
} catch (e) {
  console.log(`${TC}: finish skipped (${e.message})`);
}
