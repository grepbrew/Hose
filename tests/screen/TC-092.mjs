// TC-092 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=stored 2. expect stored · ≈ $1.75/mo 3. click Qwen3-8B · RTX 4090 4. click Remove storage · save ≈ $1.75/mo
//   5. expect Downloading and loading the model takes 5–10 min
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-092";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=stored`, { waitUntil: "load" });
await page.waitForSelector("text=stored · ≈ $1.75/mo", { state: "visible", timeout: 10000 }).catch(() => {});
const before = await page.snapshot({ scope: "full_page" });
await page.click("text=Qwen3-8B · RTX 4090 >> nth=0", { label: "open pod" });
await page.click("text=Remove storage · save ≈ $1.75/mo", { label: "remove storage" });

// assert: the sidebar showed the charge; after removal every storage line is gone and Turn on means a full download
await page.waitForSelector("text=Downloading and loading the model takes 5–10 min", { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const ok =
  before.includes("stored · ≈ $1.75/mo") &&
  snap.includes("Downloading and loading the model takes 5–10 min") &&
  !snap.includes("$1.75/mo") &&
  !snap.includes("Remove storage");
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
