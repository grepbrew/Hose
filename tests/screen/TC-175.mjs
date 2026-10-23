// TC-175 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=none 2. click New pod 3. click Choose a model yourself 4. click Pictures 5. expect Z-Image-Turbo 6. expect FLUX.1-schnell 7. expect Qwen-Image
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-175";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");
const listed = () => page.evaluate(() => [...document.querySelectorAll("button.result .ellipsis")].map((e) => e.textContent.trim()));

// act
await page.goto(`${BASE}/?seed=none`, { waitUntil: "load" });
await page.click("loc=role:button[name='New pod']", { label: "new pod" });
await page.click('text="Choose a model yourself"', { label: "choose a model" });
// role:button[name='Pictures'] matches nothing in ego (snapshot 2026-10-23); the exact text does
await page.click('text="Pictures"', { label: "pictures tab" });

// assert
await page.waitForSelector("text=Qwen-Image", { state: "visible", timeout: 10000 }).catch(() => {});
await page.waitForSelector("text=Fits · A40 >> nth=0", { state: "visible", timeout: 10000 }).catch(() => {});
const names = await listed();
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: ${names.join(", ")}`);
const ok =
  names.join(",") === "Z-Image-Turbo,FLUX.1-schnell,Qwen-Image" && /Z-Image-Turbo[\s\S]*Fits · A40/.test(snap) && !snap.includes("Thinking models") && !snap.includes("Reads images");
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
