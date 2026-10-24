// TC-193 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=none 2. click Settings 3. click Keys 4. fill RunPod API key = other-key 5. click Cancel
//   6. click Settings 7. click Keys 8. manual: evaluate #runpod-key value and localStorage `hose.keys`
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-193";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

const openKeys = async () => {
  await page.click('text="Settings"', { label: "open settings" });
  await page.waitForSelector("text=Appearance", { state: "visible", timeout: 5000 }).catch(() => {});
  await page.click('text="Keys" >> nth=0', { label: "open keys" });
  await page.waitForSelector("text=Settings › Keys", { state: "visible", timeout: 10000 }).catch(() => {});
};

// act
await page.goto(`${BASE}/?seed=none`, { waitUntil: "load" });
await openKeys();
await page.fill("#runpod-key", "other-key");
await page.click('text="Cancel"', { label: "cancel key change" });
await page.waitForFunction(() => !document.getElementById("runpod-key"), undefined, { timeout: 5000 }).catch(() => {});
await openKeys();

// assert: the manual step, then the old account's balance
const [field, saved] = await page.evaluate(() => [document.getElementById("runpod-key")?.value, JSON.parse(localStorage.getItem("hose.keys") ?? "{}").runpod]);
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: field=${field} hose.keys runpod=${saved}`);
const ok = field === "good-key" && saved === "good-key" && snap.includes("$25.00");
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
