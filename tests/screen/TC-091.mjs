// TC-091 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=storedOn 2. click Qwen3-8B · RTX 4090 3. click Turn off 4. expect Model kept in storage
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-091";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=storedOn`, { waitUntil: "load" });
await page.click("text=Qwen3-8B · RTX 4090 >> nth=0", { label: "open pod" });
await page.waitForSelector("text=The model stays in storage", { state: "visible", timeout: 10000 }).catch(() => {});
const before = await page.snapshot({ scope: "full_page" });
await page.click('text="Turn off"', { label: "turn off" });

// assert: warned before, and once off the 25 GB volume's $1.75/mo charge shows next to a way to remove it
await page.waitForSelector("text=Model kept in storage", { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const ok =
  before.includes("The model stays in storage: ≈ $1.75/mo until you remove it.") &&
  snap.includes("Model kept in storage · ≈ $1.75/mo, even while it's off.") &&
  snap.includes("Remove storage · save ≈ $1.75/mo") &&
  snap.includes("stored · ≈ $1.75/mo");
console.log(`${TC}: ${ok ? "PASS" : "FAIL"}`);

try {
  await page.screenshot({ path: `${EVIDENCE}/${TC}.png`, fullPage: true });
} catch (e) {
  console.log(`${TC}: evidence skipped (${e.message})`);
}
if (!ok) {
  console.log(before, snap);
  process.exitCode = 1;
}

try {
  await task.finish({ keep: [] });
} catch (e) {
  console.log(`${TC}: finish skipped (${e.message})`);
}
