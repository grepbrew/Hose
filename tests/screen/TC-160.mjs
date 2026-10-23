// TC-160 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=seeOn 2. click Qwen3.5-9B · A40 3. manual: click Attach image or PDF and pick tests/fixtures/two-pages.pdf in the file chooser 4. expect Remove image 2 5. fill Message = read this 6. click Send 7. expect I see 2 images
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-160";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";
const PDF = "/Users/you/Work/GitHub/gruda/hose/tests/fixtures/two-pages.pdf";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=seeOn`, { waitUntil: "load" });
await page.click("text=Qwen3.5-9B · A40 >> nth=0", { label: "open pod" });
await page.waitForSelector('[aria-label="Message"]', { state: "visible", timeout: 10000 }).catch(() => {});
const chooser = page.waitForFileChooser({ timeout: 10000 });
await page.click('[aria-label="Attach image or PDF"]', { label: "attach pdf" });
await (await chooser).setFiles(PDF);
await page.waitForSelector('[aria-label="Remove image 2"]', { state: "visible", timeout: 15000 }).catch(() => {});
const attached = await page.snapshot();
await page.fill('[aria-label="Message"]', "read this");
await page.click('text="Send"', { label: "send" });

// assert: the final `expect` step. The app updates asynchronously, so wait (bounded) for the text first.
await page.waitForSelector("text=I see 2 images", { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const ok = attached.includes("Remove image 2") && !attached.includes("Remove image 3") && snap.includes("I see 2 images.");
console.log(`${TC}: ${ok ? "PASS" : "FAIL"}`);

try {
  await page.screenshot({ path: `${EVIDENCE}/${TC}.png`, fullPage: true });
} catch (e) {
  console.log(`${TC}: evidence skipped (${e.message})`);
}
if (!ok) {
  console.log(attached, snap);
  process.exitCode = 1;
}

try {
  await task.finish({ keep: [] });
} catch (e) {
  console.log(`${TC}: finish skipped (${e.message})`);
}
