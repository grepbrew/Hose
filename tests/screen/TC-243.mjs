// TC-243 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1–5 as TC-242 6. click Describe a picture 7. click New pod 8. click Z-Image-Turbo · A40 9. expect Height = 1152 10. manual: evaluate localStorage hose.models
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-243";
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
await page.click("loc=role:textbox[name='Describe a picture']", { label: "leave the size box" });
await page.waitForFunction(() => localStorage.getItem("hose.models")?.includes('"size":"1024x1152"'), undefined, { timeout: 5000 }).catch(() => {});
await page.click("loc=role:button[name='New pod']", { label: "new pod" });
await page.click('text="Z-Image-Turbo · A40" >> nth=0', { label: "back to the picture pod" });
await page.waitForSelector("loc=role:spinbutton[name='Height']", { state: "visible", timeout: 10000 }).catch(() => {});

// assert: Custom and its sides survive leaving the page; the size is saved with the config
const seen = await page.evaluate(() => ({
  pressed: [...document.querySelectorAll(".shapes button")].find((b) => b.textContent.trim() === "Custom")?.getAttribute("aria-pressed"),
  sides: [...document.querySelectorAll(".dims input")].map((i) => i.value),
  saved: JSON.parse(localStorage.getItem("hose.models") ?? "[]").map((c) => c.size),
}));
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: ${JSON.stringify(seen)}`);
const ok = seen.pressed === "true" && seen.sides.join("x") === "1024x1152" && seen.saved.includes("1024x1152");
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
