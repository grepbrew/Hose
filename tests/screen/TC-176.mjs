// TC-176 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=none 2. click New pod 3. expect Make pictures 4. click Start Make pictures 5. expect Z-Image-Turbo · A40
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-176";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=none`, { waitUntil: "load" });
await page.click("loc=role:button[name='New pod']", { label: "new pod" });
await page.waitForSelector('text="on A40" >> nth=0', { state: "visible", timeout: 10000 }).catch(() => {});
const card = await page.evaluate(() => [...document.querySelectorAll("article[aria-labelledby]")].find((a) => a.innerText.includes("Make pictures"))?.innerText.replace(/\s+/g, " ") ?? "");
await page.click("loc=role:button[name='Start Make pictures']", { label: "start make pictures" });

// assert: the pod page of the new config opens and the sidebar lists it as running
await page.waitForFunction(() => !document.body.innerText.includes("What do you want help with?"), undefined, { timeout: 10000 }).catch(() => {});
const title = await page.evaluate(() => document.querySelector("button[title='Click to rename']")?.textContent?.trim());
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: card "${card}" | page title ${title}`);
const ok = card.includes("Z-Image-Turbo") && card.includes("on A40") && /RUNNING[\s\S]*Z-Image-Turbo · A40/.test(snap) && title === "Z-Image-Turbo · A40";
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
