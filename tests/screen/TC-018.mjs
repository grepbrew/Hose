// TC-018 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=none 2. click New pod 3. click Choose a model yourself 4. click Pictures 5. fill Search Hugging Face = stable-diffusion-v1-5/stable-diffusion-v1-5 6. click Check 7. expect can't make pictures
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-018";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=none`, { waitUntil: "load" });
await page.click("loc=role:button[name='New pod']", { label: "new pod" });
await page.click('text="Choose a model yourself"', { label: "choose a model" });
// role:button[name='Pictures'] matches nothing in ego (snapshot 2026-10-23); the exact text does
await page.click('text="Pictures"', { label: "pictures tab" });
await page.fill("loc=role:textbox[name='Search Hugging Face']", "stable-diffusion-v1-5/stable-diffusion-v1-5");
await page.click("text=Check", { label: "check hugging face model" });

// assert: the final `expect` step. The app updates asynchronously, so wait (bounded) for the text first.
await page.waitForSelector("text=can't make pictures", { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
// still the default picture model in the GPU step, not SD 1.5
const ok = /can't make pictures/.test(snap) && !/stable-diffusion-v1-5 runs smoothly/.test(snap);
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
