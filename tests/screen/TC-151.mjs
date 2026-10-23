// TC-151 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=none 2. click New pod 3. click Choose a model yourself 4. select Max price = Under $1/hr 5. click Thinking models 6. expect Qwen3.5-9B
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-151";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

const listed = () => page.evaluate(() => [...document.querySelectorAll("button.result .ellipsis")].map((e) => e.textContent.trim()));

// act
await page.goto(`${BASE}/?seed=none`, { waitUntil: "load" });
await page.click("loc=role:button[name='New pod']", { label: "new pod" });
await page.click('text="Choose a model yourself"', { label: "choose a model" });
await page.waitForSelector("text=Fast replies · A40 >> nth=0", { state: "visible", timeout: 10000 }).catch(() => {});
await page.selectOption("select[aria-label='Max price']", { label: "Under $1/hr" });
await page.click("text=Thinking models", { label: "thinking models only" });

// assert
await page.waitForSelector("text=Qwen3.5-9B", { state: "visible", timeout: 10000 }).catch(() => {});
const names = await listed();
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: ${names.join(", ")}`);
const ok = names.join(",") === "Qwen3.5-4B,Qwen3.5-9B,Granite-4.2-8B,gpt-oss-20b";
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
