// TC-073 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=none 2. click New pod 3. click Choose a model yourself 4. click Qwen3-4B-Instruct 5. select Sort = GPU memory, most first 6. expect A100 PCIe
//   then the other three sorts, and Show all for the price tiebreak (RTX A5000 and RTX 4090 are both 24 GB)
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-073";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`$TC-073 screen test`);
const page = task.page("p1");
const cards = () => page.evaluate(() => [...document.querySelectorAll(".grid .pick strong")].map((e) => e.textContent.trim()).join(","));

// act
await page.goto(`${BASE}/?seed=none`, { waitUntil: "load" });
await page.click("loc=role:button[name='New pod']", { label: "new pod" });
await page.click('text="Choose a model yourself"', { label: "choose a model" });
await page.click("text=Qwen3-4B-Instruct", { label: "pick curated model" });
await page.waitForSelector("text=RTX 4090", { state: "visible", timeout: 10000 }).catch(() => {});
const start = await page.evaluate(() => document.querySelector("select[aria-label=Sort]").selectedOptions[0].textContent.trim());
await page.selectOption("select[aria-label=Sort]", { label: "GPU memory, most first" });
const byMemory = await cards();
await page.selectOption("select[aria-label=Sort]", { label: "GPU memory, least first" });
const byMemoryUp = await cards();
await page.selectOption("select[aria-label=Sort]", { label: "Price, high to low" });
const byPriceDown = await cards();
await page.selectOption("select[aria-label=Sort]", { label: "Price, low to high" });
const byPrice = await cards();
await page.click("text=Show all", { label: "show all GPUs" });
await page.selectOption("select[aria-label=Sort]", { label: "GPU memory, most first" });
const tie = await cards();

// assert
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: starts on ${start} | memory ${byMemory} | memory up ${byMemoryUp} | price down ${byPriceDown} | price ${byPrice} | all by memory ${tie}`);
const ok =
  start === "Recommended first" &&
  byMemory === "A100 PCIe,A40,RTX 4090,RTX A4000" &&
  byMemoryUp === "RTX A4000,RTX 4090,A40,A100 PCIe" &&
  byPriceDown === "A100 PCIe,RTX 4090,A40,RTX A4000" &&
  byPrice === "RTX A4000,A40,RTX 4090,A100 PCIe" &&
  tie === "A100 PCIe,A40,RTX A5000,RTX 4090,RTX A4000";
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
