// TC-096 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=stuck 2. click Qwen3-8B · RTX 4090 3. expect RunPod hasn't started this pod 4. click Try another machine
//   5. expect Pulling image
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-096";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=stuck`, { waitUntil: "load" });
await page.click("text=Qwen3-8B · RTX 4090 >> nth=0", { label: "open pod" });
await page.waitForSelector("text=RunPod hasn't started this pod", { state: "visible", timeout: 10000 }).catch(() => {});
const before = await page.snapshot({ scope: "full_page" });
await page.click('text="Try another machine"', { label: "retry" });

// assert: pod1 (5 min old, no log lines) got the hint; the new pod's boot log streams
await page.waitForSelector("text=Pulling image", { state: "visible", timeout: 15000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const ok = before.includes("RunPod hasn't started this pod on its machine yet: no log lines for 5 min") && snap.includes("Pulling image");
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
