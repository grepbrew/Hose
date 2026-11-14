// TC-239 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=editOn 2. click Qwen-Image-Edit · A100 SXM 3. fill Describe the change = a ring 4. click Send 5. expect Attach the picture to change first
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-239";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=editOn`, { waitUntil: "load" });
await page.waitForSelector("text=Qwen-Image-Edit · A100 SXM", { state: "visible", timeout: 10000 }).catch(() => {});
await page.click('text="Qwen-Image-Edit · A100 SXM" >> nth=0', { label: "open edit pod" });
await page.waitForSelector("text=Attach a picture and describe the change", { state: "visible", timeout: 15000 }).catch(() => {});
await page.fill("loc=role:textbox[name='Describe the change']", "a ring");
await page.click("loc=role:button[name='Send']", { label: "send with nothing to change" });

// assert: the alert, and the words stay unsent (no message in the chat)
await page.waitForSelector("text=Attach the picture to change first", { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const sent = await page.evaluate(() => document.querySelectorAll("li.user, li.assistant").length);
console.log(`${TC}: messages ${sent}`);
const ok = snap.includes("Attach the picture to change first") && sent === 0;
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
