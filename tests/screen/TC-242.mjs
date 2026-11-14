// TC-242 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=drawOn 2. click Z-Image-Turbo · A40 3. click Custom 4. fill Width = 1024 5. fill Height = 1150 6. manual: evaluate wrap fetch to record the /v1/images/generations body 7. fill Describe a picture = a red fox 8. click Send 9. expect img "a red fox"
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-242";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=drawOn`, { waitUntil: "load" });
await page.waitForSelector("text=Z-Image-Turbo · A40", { state: "visible", timeout: 10000 }).catch(() => {});
await page.click('text="Z-Image-Turbo · A40" >> nth=0', { label: "open picture pod" });
await page.waitForSelector("text=Describe a picture for", { state: "visible", timeout: 15000 }).catch(() => {});
// role:button[name] misses .seg toggles in ego (gotcha 2026-10-24); the exact text works
await page.click('text="Custom"', { label: "custom size" });
await page.fill("loc=role:spinbutton[name='Width']", "1024");
await page.fill("loc=role:spinbutton[name='Height']", "1150");
// manual: record the picture request's body (the app calls window.fetch in the browser)
await page.evaluate(() => {
  const real = window.fetch;
  window.fetch = (url, init) => {
    if (String(url).includes("/v1/images/generations")) window.__drawBody = JSON.parse(init.body);
    return real(url, init);
  };
});
await page.fill("loc=role:textbox[name='Describe a picture']", "a red fox");
await page.click("loc=role:button[name='Send']", { label: "send prompt" });

// assert: 1150 went out as the nearest multiple of 16, Custom stays pressed with the rounded sides shown
await page.waitForSelector("img[alt='a red fox']", { state: "visible", timeout: 10000 }).catch(() => {});
const seen = await page.evaluate(() => ({
  size: window.__drawBody?.size,
  pressed: [...document.querySelectorAll(".shapes button")].find((b) => b.textContent.trim() === "Custom")?.getAttribute("aria-pressed"),
  sides: [...document.querySelectorAll(".dims input")].map((i) => i.value),
}));
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: ${JSON.stringify(seen)}`);
const ok = seen.size === "1024x1152" && seen.pressed === "true" && seen.sides.join("x") === "1024x1152";
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
