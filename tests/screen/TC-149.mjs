// TC-149 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=soldOut 2. click New pod 3. expect No GPU free right now
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-149";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=soldOut`, { waitUntil: "load" });
await page.click("loc=role:button[name='New pod']", { label: "new pod" });

// assert
await page.waitForSelector("text=No GPU free right now on RunPod", { state: "visible", timeout: 10000 }).catch(() => {});
const starts = await page.evaluate(() => [...document.querySelectorAll("button[aria-label^='Start ']")].map((b) => b.disabled));
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: Start buttons disabled = ${starts.join(",")}`);
const ok = snap.includes("No GPU free right now") && starts.length === 7 && starts.every(Boolean);
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
