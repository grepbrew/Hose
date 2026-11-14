// TC-268 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=toolsNew 2. click Settings 3. click Coding tools 4. expect both "Installed, not set up"
//   5. click Set up Claude Code and Codex 6. expect both "Set up" 7. click Qwen3-Coder-30B · L40S 8. click Pod 9. expect both commands
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-268";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");
const states = () => page.evaluate(() => [...document.querySelectorAll(".tools li")].map((li) => `${li.querySelector(".name")?.textContent}: ${li.querySelector(".state")?.textContent}`));

// act
await page.goto(`${BASE}/?seed=toolsNew`, { waitUntil: "load" });
await page.waitForSelector('text="Settings"', { state: "visible", timeout: 10000 }).catch(() => {});
await page.click('text="Settings"', { label: "open Settings menu" });
await page.click('text="Coding tools"', { label: "open Coding tools" });
await page.waitForSelector("text=Installed, not set up", { state: "visible", timeout: 10000 }).catch(() => {});
const before = await states();
await page.click('text="Set up Claude Code and Codex"', { label: "set up both" });
await page.waitForSelector('text="Set up again"', { state: "visible", timeout: 10000 }).catch(() => {});
const after = await states();
const settingsSnap = await page.snapshot({ scope: "full_page" });
await page.click('text="Qwen3-Coder-30B · L40S" >> nth=0', { label: "open coder pod" });
await page.waitForSelector('text="Pod"', { state: "visible", timeout: 10000 }).catch(() => {});
await page.click('text="Pod"', { label: "open Pod tab" });
await page.waitForSelector("text=Use with coding tools", { state: "visible", timeout: 10000 }).catch(() => {});

// assert
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
const ok =
  JSON.stringify(before) === JSON.stringify(["Claude Code: Installed, not set up", "Codex: Installed, not set up"]) &&
  JSON.stringify(after) === JSON.stringify(["Claude Code: Set up", "Codex: Set up"]) &&
  settingsSnap.includes("Set up again") &&
  snap.includes("claude --settings ~/.claude/hose.json --model qwen3-coder-30b") &&
  snap.includes("codex -p hose -m qwen3-coder-30b");
console.log(`${TC}: ${ok ? "PASS" : "FAIL"}`);

try {
  await page.screenshot({ path: `${EVIDENCE}/${TC}.png`, fullPage: true });
} catch (e) {
  console.log(`${TC}: evidence skipped (${e.message})`);
}
if (!ok) {
  console.log(settingsSnap);
  console.log(snap);
  process.exitCode = 1;
}

try {
  await task.finish({ keep: [] });
} catch (e) {
  console.log(`${TC}: finish skipped (${e.message})`);
}
