// TC-059 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=on 2. click Settings 3. expect Appearance 4. click Dark 5. click Keys 6. expect Settings › Keys
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-059";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=on`, { waitUntil: "load" });
await page.click('text="Settings"', { label: "open settings" });
await page.waitForSelector('text=Appearance', { state: "visible", timeout: 5000 }).catch(() => {});
await page.click('text="Dark"', { label: "dark appearance" });
const theme = (await page.cdp("Runtime.evaluate", { expression: "document.documentElement.dataset.theme", returnByValue: true })).result.value;
await page.click('text="Keys" >> nth=0', { label: "open keys" });

// assert: the final `expect` step. The app updates asynchronously, so wait (bounded) for the text first.
await page.waitForSelector('text=Settings › Keys', { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: data-theme=${theme}`);
const ok = theme === "dark" && /heading\s+text "Settings ›"\s+text "Keys"/.test(snap) && snap.includes("RunPod API key");
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
