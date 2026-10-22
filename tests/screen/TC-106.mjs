// TC-106 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=on 2. click Qwen3-8B · RTX 4090 3. click Show log 4. expect Loading weights took 12.3 seconds
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-106";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=on`, { waitUntil: "load" });
await page.click("text=Qwen3-8B · RTX 4090 >> nth=0", { label: "open pod" });
await page.click('text="Show log"', { label: "show server log" });

// assert: log panel under the chat; manual: the Message box stays enabled
await page.waitForSelector("text=Loading weights took 12.3 seconds", { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const enabled = await page.evaluate(() => !document.querySelector('textarea[aria-label="Message"]').disabled);
const ok = /log "Server log"[\s\S]*Loading weights took 12\.3 seconds/.test(snap) && enabled;
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
