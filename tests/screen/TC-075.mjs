// TC-075 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=none 2. click New pod 3. click Large 4. click Qwen3.8-27B 5. expect Storage = 105 6. fill Storage = 50 then blur 7. expect 105 8. fill Storage = 202 9. click Save only
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-075";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`$TC-075 screen test`);
const page = task.page("p1");
const cards = () => page.evaluate(() => [...document.querySelectorAll(".grid .pick strong")].map((e) => e.textContent.trim()).join(","));
const disk = () => page.evaluate(() => document.getElementById("disk").value);

// act
await page.goto(`${BASE}/?seed=none`, { waitUntil: "load" });
await page.click("loc=role:button[name='New pod']", { label: "new pod" });
await page.click('text="Large"', { label: "large models" });
await page.click("text=Qwen3.8-27B", { label: "pick curated model" });
await page.waitForSelector("text=A100 PCIe", { state: "visible", timeout: 10000 }).catch(() => {});
const recommended = await disk();
const step = await page.evaluate(() => document.getElementById("disk").getAttribute("step"));
await page.fill("#disk", "50");
await page.press("#disk", "Tab");
const clamped = await disk();
await page.fill("#disk", "202");
await page.press("#disk", "Tab");
await page.click("loc=role:button[name='Save only']", { label: "save only" });

// assert
await page.waitForSelector("text=205 GB disk", { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: recommended ${recommended}, step ${step}, after 50 → ${clamped}`);
const ok = recommended === "105" && step === "5" && clamped === "105" && snap.includes("205 GB disk");
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
