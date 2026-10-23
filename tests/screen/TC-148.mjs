// TC-148 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=presetOff 2. click New pod 3. expect Start again 4. click Start Everyday questions 5. expect Qwen3.5-9B · A40
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-148";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=presetOff`, { waitUntil: "load" });
await page.click("loc=role:button[name='New pod']", { label: "new pod" });
await page.waitForSelector('text="Start again"', { state: "visible", timeout: 10000 }).catch(() => {});
const label = await page.evaluate(() => document.querySelector("button[aria-label='Start Everyday questions']")?.textContent?.trim());
await page.click("loc=role:button[name='Start Everyday questions']", { label: "start everyday questions" });

// assert: the saved config turned on; no second Qwen3.5-9B config
await page.waitForFunction(() => /running/i.test(document.body.innerText), undefined, { timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const copies = (snap.match(/Qwen3\.5-9B · A40/g) ?? []).length;
console.log(`${TC}: button said "${label}", "Qwen3.5-9B · A40" appears ${copies}×`);
const ok = label === "Start again" && /RUNNING[\s\S]*Qwen3\.5-9B · A40/.test(snap) && !/SAVED/.test(snap);
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
