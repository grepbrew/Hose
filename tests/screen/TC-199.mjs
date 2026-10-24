// TC-199 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=drawOn 2. click Z-Image-Turbo · A40 3. click Picture settings 4. expect Guidance 5. fill Steps = 6
//   6. fill Seed = 42 7. click Picture settings 8. fill Describe a picture = a red fox 9. click Send 10. expect img "a red fox"
//   11. manual: evaluate localStorage `hose.models`
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-199";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=drawOn`, { waitUntil: "load" });
await page.waitForSelector("text=Z-Image-Turbo · A40", { state: "visible", timeout: 10000 }).catch(() => {});
await page.click('text="Z-Image-Turbo · A40" >> nth=0', { label: "open picture pod" });
await page.waitForSelector("text=Describe a picture for", { state: "visible", timeout: 15000 }).catch(() => {});
await page.click("loc=role:button[name='Picture settings']", { label: "open picture settings" });
await page.waitForSelector("text=Guidance", { state: "visible", timeout: 5000 }).catch(() => {});
const panel = await page.snapshot();
const steps = await page.evaluate(() => document.querySelector("#tune-steps")?.placeholder);
await page.fill("loc=role:spinbutton[name='Steps']", "6");
await page.fill("loc=role:spinbutton[name='Seed']", "42");
await page.click("loc=role:button[name='Picture settings']", { label: "close picture settings" });
await page.fill("loc=role:textbox[name='Describe a picture']", "a red fox");
await page.click("loc=role:button[name='Send']", { label: "send prompt" });

// assert: all four fields for this model, the preset's 9 steps as the placeholder; picture made; settings saved on the config
await page.waitForSelector("img[alt='a red fox']", { state: "visible", timeout: 10000 }).catch(() => {});
const saved = await page.evaluate(() => {
  const z = JSON.parse(localStorage.getItem("hose.models") ?? "[]").find((c) => c.id === "Tongyi-MAI/Z-Image-Turbo");
  return z ? { steps: z.steps, seed: z.seed } : null;
});
const shown = await page.evaluate(() => !!document.querySelector("img.picture[alt='a red fox']"));
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: placeholder ${steps}, saved ${JSON.stringify(saved)}, picture ${shown}`);
const fields = ["Steps", "Seed", "Avoid", "Guidance"].every((f) => panel.includes(f));
const ok = fields && steps === "9" && shown && saved?.steps === 6 && saved?.seed === 42 && !snap.includes('dialog "Picture settings"');
console.log(`${TC}: ${ok ? "PASS" : "FAIL"}`);

try {
  await page.screenshot({ path: `${EVIDENCE}/${TC}.png`, fullPage: true });
} catch (e) {
  console.log(`${TC}: evidence skipped (${e.message})`);
}
if (!ok) {
  console.log(panel);
  process.exitCode = 1;
}

try {
  await task.finish({ keep: [] });
} catch (e) {
  console.log(`${TC}: finish skipped (${e.message})`);
}
