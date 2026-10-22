// TC-015 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=fresh 2. fill RunPod API key = good-key 3. click Save and continue 4. expect Balance $25.00
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-015";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=fresh`, { waitUntil: "load" });
await page.fill("loc=role:textbox[name='RunPod API key']", "good-key");
await page.click('text="Save and continue"', { label: "save runpod key" });

// assert: the final `expect` step. The app updates asynchronously, so wait (bounded) for the text first.
await page.waitForSelector(`text=${"$25.00"}`, { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const ok = /Balance[\s\S]*\$25\.00/.test(snap) && snap.includes("New pod");
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
