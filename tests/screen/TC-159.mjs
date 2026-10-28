// TC-159 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=seeOn 2. click Qwen3.5-9B · A40 3. click Pod 4. expect image_url 5. manual: click Attach image or PDF and pick tests/fixtures/page-3000x2000.png in the file chooser 6. expect Remove image 1 7. click Send 8. expect I see 1 image
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-159";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;
const PNG = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/fixtures/page-3000x2000.png`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=seeOn`, { waitUntil: "load" });
await page.click("text=Qwen3.5-9B · A40 >> nth=0", { label: "open pod" });
await page.click('text="Pod"', { label: "open Pod tab" });
await page.waitForSelector('[aria-label="Message"]', { state: "visible", timeout: 10000 }).catch(() => {});
const before = await page.snapshot();
const chooser = page.waitForFileChooser({ timeout: 10000 });
await page.click('[aria-label="Attach image or PDF"]', { label: "attach image" });
await (await chooser).setFiles(PNG);
await page.waitForSelector('[aria-label="Remove image 1"]', { state: "visible", timeout: 10000 }).catch(() => {});
const attached = await page.snapshot();
await page.click('text="Send"', { label: "send" });

// assert: the final `expect` step. The app updates asynchronously, so wait (bounded) for the text first.
await page.waitForSelector("text=I see 1 image", { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const width = await page.evaluate(() => document.querySelector(".shots img")?.naturalWidth ?? 0);
const ok =
  before.includes("image_url") &&
  attached.includes("Remove image 1") &&
  snap.includes("I see 1 image.") &&
  snap.includes("Read out all the text in this image") &&
  width === 2048;
console.log(`${TC}: ${ok ? "PASS" : "FAIL"} (sent image ${width} px wide)`);

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
