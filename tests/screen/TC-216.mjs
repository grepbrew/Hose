// TC-216 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=stored 2. click Qwen3-8B · RTX 4090 3. click Pod 4. expect 25 GB · ≈ $1.75/mo 5. expect so far
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-216";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=stored`, { waitUntil: "load" });
await page.waitForSelector("text=Qwen3-8B · RTX 4090", { state: "visible", timeout: 10000 }).catch(() => {});
await page.click("text=Qwen3-8B · RTX 4090 >> nth=0", { label: "open pod" });
await page.click('text="Pod"', { label: "open Pod tab" });

// assert: the Pod tab's Storage section shows the volume, its monthly charge, what it cost so far and the Remove button
await page.waitForSelector("text=so far", { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const storage = snap.slice(snap.indexOf('text "STORAGE"'));
const ok =
  snap.includes('text "STORAGE"') &&
  storage.includes("25 GB · ≈ $1.75/mo") &&
  storage.includes("so far") &&
  storage.includes("Remove storage · save ≈ $1.75/mo");
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
