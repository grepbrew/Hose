// TC-067 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=off 2. click Qwen3-8B · RTX 4090 3. click Turn on 4. expect Pulling image 5. expect Say hello to Qwen3-8B
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-067";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=off`, { waitUntil: "load" });
await page.click("text=Qwen3-8B · RTX 4090 >> nth=0", { label: "open saved config" });
await page.click("text=Turn on >> nth=0", { label: "turn on" });

// assert: the log shows while Starting, then the empty chat replaces it with an enabled Message box
const sawLog = await page.waitForSelector("text=Pulling image", { state: "visible", timeout: 5000 }).then(() => true, () => false);
await page.waitForSelector("text=Say hello to Qwen3-8B", { state: "visible", timeout: 20000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const open = await page.evaluate(() => !document.querySelector('textarea[aria-label="Message"]').disabled);
const ok = sawLog && /Say hello to Qwen3-8B/.test(snap) && !/Startup log/.test(snap) && open;
console.log(`${TC}: ${ok ? "PASS" : "FAIL"}`);

try {
  await page.screenshot({ path: `${EVIDENCE}/${TC}.png`, fullPage: true });
} catch (e) {
  console.log(`${TC}: evidence skipped (${e.message})`);
}
if (!ok) {
  console.log({ sawLog, open });
  console.log(snap);
  process.exitCode = 1;
}

try {
  await task.finish({ keep: [] });
} catch (e) {
  console.log(`${TC}: finish skipped (${e.message})`);
}
