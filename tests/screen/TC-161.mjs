// TC-161 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=seeOn 2. click Qwen3.5-9B · A40 3. manual: evaluate dispatch paste with a PNG on Message 4. expect Remove image 1
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-161";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=seeOn`, { waitUntil: "load" });
await page.click("text=Qwen3.5-9B · A40 >> nth=0", { label: "open pod" });
await page.waitForSelector('[aria-label="Message"]', { state: "visible", timeout: 10000 }).catch(() => {});
// manual: a ⌘⇧4 screenshot pastes as an image file with no text
await page.evaluate(async () => {
  const canvas = Object.assign(document.createElement("canvas"), { width: 400, height: 300 });
  canvas.getContext("2d").fillRect(0, 0, 200, 150);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], "Screenshot.png", { type: "image/png" }));
  document.querySelector('[aria-label="Message"]').dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});

// assert: the final `expect` step. The app updates asynchronously, so wait (bounded) for the text first.
await page.waitForSelector('[aria-label="Remove image 1"]', { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const sendEnabled = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Send" && !b.disabled));
const ok = snap.includes("Remove image 1") && sendEnabled;
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
