// TC-057 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=two 2. click Qwen3-8B · RTX 4090 3. fill Message = hi 4. click Send 5. click Mistral-7B · A40 6. click Qwen3-8B · RTX 4090 7. expect Hello from fake GPU
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-057";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=two`, { waitUntil: "load" });
await page.click("text=Qwen3-8B · RTX 4090 >> nth=0", { label: "open pod" });
await page.fill('[aria-label="Message"]', "hi");
await page.click('text="Send"', { label: "send" });
await page.waitForSelector('text=Hello from fake GPU', { state: "visible", timeout: 10000 }).catch(() => {});
await page.click("text=Mistral-7B · A40", { label: "open other config" });
await page.click("text=Qwen3-8B · RTX 4090 >> nth=0", { label: "back to first pod" });

// assert: the final `expect` step. The app updates asynchronously, so wait (bounded) for the text first.
await page.waitForSelector('text=Hello from fake GPU', { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const ok = snap.includes("Hello from fake GPU");
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
