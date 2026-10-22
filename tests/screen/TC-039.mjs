// TC-039 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=on 2. click Qwen3-8B · RTX 4090 3. click Turn off 4. expect Off
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-039";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=on`, { waitUntil: "load" });
await page.click("text=Qwen3-8B · RTX 4090 >> nth=0", { label: "open pod" });
await page.click('text="Turn off"', { label: "turn off" });

// assert: the final `expect` step. The app updates asynchronously, so wait (bounded) for the text first.
await page.waitForSelector('text="Off"', { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const ok = /SAVED[\s\S]*Qwen3-8B · RTX 4090/.test(snap) && !/RUNNING/.test(snap) && snap.includes("Turn on");
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
