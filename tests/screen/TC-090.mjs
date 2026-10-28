// TC-090 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=none 2. click New pod 3. click Choose a model yourself 4. click Qwen3.5-4B 5. click RTX 4090 6. click More options 7. select Never in Turns off after 8. expect Stays on 24/7
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-090";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=none`, { waitUntil: "load" });
await page.click("loc=role:button[name='New pod']", { label: "new pod" });
await page.click('text="Choose a model yourself"', { label: "choose a model" });
await page.click("text=Qwen3.5-4B >> nth=0", { label: "pick model" });
await page.waitForSelector("text=RTX 4090", { state: "visible", timeout: 10000 }).catch(() => {});
await page.click("text=RTX 4090 >> nth=0", { label: "pick GPU" });
await page.click('text="More options"', { label: "more options" });
await page.selectOption("select#idle", { label: "Never" });

// assert: RTX 4090 at $0.89/hr all day = $21.36/day, × 730 h = $650/month; the button names the 24/7 cost
await page.waitForSelector("text=Stays on 24/7", { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const ok =
  snap.includes("Stays on 24/7 until you turn it off: ≈ $21.36/day · ≈ $650/month.") && snap.includes("Turn on 24/7 · RTX 4090 · ≈ $650/mo");
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
