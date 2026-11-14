// TC-262 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=toolsOn 2. click Qwen3-Coder-30B · L40S 3. click Pod 4. expect Name for coding tools = qwen3-coder-30b
//   5. expect checkbox Coding tools can turn this on unchecked 6. expect the claude command 7. expect the codex command
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-262";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=toolsOn`, { waitUntil: "load" });
await page.waitForSelector("text=Qwen3-Coder-30B · L40S", { state: "visible", timeout: 10000 }).catch(() => {});
await page.click('text="Qwen3-Coder-30B · L40S" >> nth=0', { label: "open coder pod" });
await page.waitForSelector('text="Pod"', { state: "visible", timeout: 10000 }).catch(() => {});
await page.click('text="Pod"', { label: "open Pod tab" });
await page.waitForSelector("text=Use with coding tools", { state: "visible", timeout: 10000 }).catch(() => {});

// assert: the name, the switch off, the cost line and both commands
const seen = await page.evaluate(() => {
  const name = document.querySelector("input[aria-label='Name for coding tools']");
  const box = [...document.querySelectorAll("label.check")].find((l) => l.textContent.includes("Coding tools can turn this on"))?.querySelector("input");
  return { name: name?.value, checked: box ? box.checked : null };
});
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: ${JSON.stringify(seen)}`);
const ok =
  seen.name === "qwen3-coder-30b" &&
  seen.checked === false &&
  snap.includes("≈$0.86/hr, off after 10 min idle") &&
  snap.includes("claude --settings ~/.claude/hose.json --model qwen3-coder-30b") &&
  snap.includes("codex -p hose -m qwen3-coder-30b");
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
