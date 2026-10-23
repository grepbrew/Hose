// TC-150 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=none 2. click New pod 3. click Choose a model yourself 4. click Granite-4.2-8B 5. expect Recommended
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-150";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");
const cards = () => page.evaluate(() => [...document.querySelectorAll(".grid .pick")].map((e) => e.innerText.replace(/\s+/g, " ").trim()));

// act
await page.goto(`${BASE}/?seed=none`, { waitUntil: "load" });
await page.click("loc=role:button[name='New pod']", { label: "new pod" });
await page.click('text="Choose a model yourself"', { label: "choose a model" });
await page.click("text=Granite-4.2-8B", { label: "pick granite" });

// assert
await page.waitForSelector("text=Recommended", { state: "visible", timeout: 10000 }).catch(() => {});
const shown = await cards();
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: ${shown.join(" | ")}`);
const a40 = shown.find((c) => c.startsWith("A40 "));
const rtx = shown.find((c) => c.startsWith("RTX 4090"));
const ok = !!a40 && a40.includes("Recommended") && !!rtx && rtx.includes("Works · short chats only") && snap.includes("Turn on · A40 · $0.59/hr");
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
