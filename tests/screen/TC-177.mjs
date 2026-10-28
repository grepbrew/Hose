// TC-177 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=drawOn 2. click Z-Image-Turbo · A40 3. fill Describe a picture = a red fox 4. click Send 5. expect img "a red fox"
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-177";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=drawOn`, { waitUntil: "load" });
await page.waitForSelector("text=Z-Image-Turbo · A40", { state: "visible", timeout: 10000 }).catch(() => {});
await page.click('text="Z-Image-Turbo · A40" >> nth=0', { label: "open picture pod" });
await page.waitForSelector("text=Describe a picture for", { state: "visible", timeout: 15000 }).catch(() => {});
await page.fill("loc=role:textbox[name='Describe a picture']", "a red fox");
await page.click("loc=role:button[name='Send']", { label: "send prompt" });

// assert: the picture (alt = its prompt) under the prompt; shape choice instead of Think first
await page.waitForSelector("img[alt='a red fox']", { state: "visible", timeout: 10000 }).catch(() => {});
const shown = await page.evaluate(() => {
  const img = document.querySelector("img.picture");
  return img ? { alt: img.alt, loaded: img.complete && img.naturalWidth > 0 } : null;
});
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: picture ${JSON.stringify(shown)}`);
const ok = shown?.alt === "a red fox" && shown.loaded && /Square[\s\S]*Portrait[\s\S]*Landscape/.test(snap) && !snap.includes("Think first");
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
