// TC-074 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=none 2. click New pod 3. click Small 4. click Qwen3-4B-Instruct 5. select Location = EU Romania 1 6. click Save only
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-074";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`$TC-074 screen test`);
const page = task.page("p1");
const cards = () => page.evaluate(() => [...document.querySelectorAll(".grid .pick strong")].map((e) => e.textContent.trim()).join(","));

// act
await page.goto(`${BASE}/?seed=none`, { waitUntil: "load" });
await page.click("loc=role:button[name='New pod']", { label: "new pod" });
await page.click('text="Small"', { label: "small models" });
await page.click("text=Qwen3-4B-Instruct", { label: "pick curated model" });
await page.waitForSelector("select[aria-label=Location]", { state: "visible", timeout: 10000 }).catch(() => {});
await page.selectOption("select[aria-label=Location]", { label: "EU Romania 1" });
const here = await cards();
await page.screenshot({ path: `${EVIDENCE}/${TC}-picker.png`, fullPage: true }).catch(() => {});
await page.click("loc=role:button[name='Save only']", { label: "save only" });

// assert
await page.waitForSelector("text=Secure cloud · EU Romania 1", { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: cards in EU Romania 1: ${here}`);
const ok = here === "A40,RTX 4090,A100 PCIe" && snap.includes("Secure cloud · EU Romania 1");
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
