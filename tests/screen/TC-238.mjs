// TC-238 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1–6 as TC-237 7. fill Describe the change = make it glow 8. click Send 9. expect img "make it glow"
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-238";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=editOn`, { waitUntil: "load" });
await page.waitForSelector("text=Qwen-Image-Edit · A100 SXM", { state: "visible", timeout: 10000 }).catch(() => {});
await page.click('text="Qwen-Image-Edit · A100 SXM" >> nth=0', { label: "open edit pod" });
await page.waitForSelector("text=Attach a picture and describe the change", { state: "visible", timeout: 15000 }).catch(() => {});
// manual: a picture pasted as a file with no text, like a ⌘⇧4 screenshot
await page.evaluate(async () => {
  const canvas = Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
  canvas.getContext("2d").fillRect(64, 64, 128, 128);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], "ring.png", { type: "image/png" }));
  document.querySelector('[aria-label="Describe the change"]').dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForSelector('[aria-label="Remove image 1"]', { state: "visible", timeout: 10000 }).catch(() => {});
await page.fill("loc=role:textbox[name='Describe the change']", "poison ring");
await page.click("loc=role:button[name='Send']", { label: "send change" });
await page.waitForSelector("img[alt='poison ring']", { state: "visible", timeout: 10000 }).catch(() => {});
await page.fill("loc=role:textbox[name='Describe the change']", "make it glow");
await page.click("loc=role:button[name='Send']", { label: "send second change, nothing attached" });

// assert: a second picture and no alert; nothing was attached, so the first picture was the reference
await page.waitForSelector("img[alt='make it glow']", { state: "visible", timeout: 10000 }).catch(() => {});
const pictures = () => page.evaluate(() => [...document.querySelectorAll("img.picture")].map((i) => ({ alt: i.alt, loaded: i.complete && i.naturalWidth > 0 })));
const shown = await pictures();
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: pictures ${JSON.stringify(shown)}`);
const ok = shown.map((p) => p.alt).join(",") === "poison ring,make it glow" && shown.every((p) => p.loaded) && !snap.includes("Attach the picture to change first");
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
