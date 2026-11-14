// TC-269 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=toolsNew 2. click Qwen3-Coder-30B · L40S 3. click Pod 4. expect Set up Claude Code and Codex in Settings › Coding tools
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-269";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=toolsNew`, { waitUntil: "load" });
await page.waitForSelector("text=Qwen3-Coder-30B · L40S", { state: "visible", timeout: 10000 }).catch(() => {});
await page.click('text="Qwen3-Coder-30B · L40S" >> nth=0', { label: "open coder pod" });
await page.waitForSelector('text="Pod"', { state: "visible", timeout: 10000 }).catch(() => {});
await page.click('text="Pod"', { label: "open Pod tab" });
await page.waitForSelector("text=Use with coding tools", { state: "visible", timeout: 10000 }).catch(() => {});

// assert: the note; no commands and no Set up button in the Pod tab
const snap = await page.snapshot({ scope: "full_page" });
const buttons = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter((t) => t.startsWith("Set up")));
const ok =
  snap.includes("Set up Claude Code and Codex in Settings › Coding tools.") &&
  !snap.includes("claude --settings") &&
  !snap.includes("codex -p hose") &&
  buttons.length === 0;
console.log(`${TC}: buttons ${JSON.stringify(buttons)}`);
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
