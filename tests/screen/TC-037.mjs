// TC-037 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=none 2. click Choose GPU 3. click RTX 4090 4. click Turn on 5. expect On
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-037";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=none`, { waitUntil: "load" });
await page.click('text="Choose GPU" >> nth=0', { label: "choose gpu for first preset" });
await page.click("text=RTX 4090", { label: "pick RTX 4090 card" });
await page.click("text=Turn on RTX 4090", { label: "turn on" });

// assert: the final `expect` step. The app updates asynchronously, so wait (bounded) for the text first.
await page.waitForSelector('text="On"', { state: "visible", timeout: 20000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const ok = /Your models[\s\S]*Qwen3-4B-Instruct-2507[\s\S]*text "On"/.test(snap);
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
