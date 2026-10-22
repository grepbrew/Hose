// TC-056 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=none 2. click New pod 3. fill Search Hugging Face = deepseek 4. expect DeepSeek-R1-Distill-Qwen-7B
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-056";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=none`, { waitUntil: "load" });
await page.click("loc=role:button[name='New pod']", { label: "new pod" });
await page.fill("loc=role:textbox[name='Search Hugging Face']", "deepseek");

// assert: the final `expect` step. The app updates asynchronously, so wait (bounded) for the text first.
await page.waitForSelector('text=DeepSeek-R1-Distill-Qwen-7B', { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const ok = snap.includes("DeepSeek-R1-Distill-Qwen-7B") && !snap.includes("FLUX");
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
