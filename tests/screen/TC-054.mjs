// TC-054 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=off 2. click New pod 3. click Choose a model yourself 4. fill Search Hugging Face = Qwen/Qwen3-8B 5. click Check 6. click A40 7. click Save only 8. expect Qwen3-8B · A40
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-054";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=off`, { waitUntil: "load" });
await page.click("loc=role:button[name='New pod']", { label: "new pod" });
await page.click('text="Choose a model yourself"', { label: "choose a model" });
await page.fill("loc=role:textbox[name='Search Hugging Face']", "Qwen/Qwen3-8B");
await page.click("text=Check", { label: "check model" });
await page.click('text="A40"', { label: "pick A40 card" });
await page.click('text="Save only"', { label: "save only" });

// assert: the final `expect` step. The app updates asynchronously, so wait (bounded) for the text first.
await page.waitForSelector('text=Qwen3-8B · A40', { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const ok = /SAVED[\s\S]*Qwen3-8B · RTX 4090[\s\S]*Qwen3-8B · A40/.test(snap);
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
