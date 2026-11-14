// TC-237 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=editOn 2. click Qwen-Image-Edit · A100 SXM 3. manual: evaluate dispatch paste with a PNG on Describe the change 4. fill Describe the change = poison ring 5. click Send 6. expect img "poison ring"
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-237";
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

// assert: the reference in the user turn, the new picture (alt = its words) under it; shapes and Settings, no Think first
const pictures = () => page.evaluate(() => [...document.querySelectorAll("img.picture")].map((i) => ({ alt: i.alt, loaded: i.complete && i.naturalWidth > 0 })));
const shown = await pictures();
const refs = await page.evaluate(() => document.querySelectorAll("li.user .shots img").length);
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: pictures ${JSON.stringify(shown)}, references ${refs}`);
const ok = shown.length === 1 && shown[0].alt === "poison ring" && shown[0].loaded && refs === 1 && /Square[\s\S]*Portrait[\s\S]*Landscape/.test(snap) && snap.includes("Settings") && !snap.includes("Think first");
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
