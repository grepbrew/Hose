// TC-107 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=on 2. click Qwen3-8B · RTX 4090 3. click Pod 4. expect https://pod1-8000.proxy.runpod.net/v1 5. click Copy base URL 6. expect Copied
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-107";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=on`, { waitUntil: "load" });
await page.click("text=Qwen3-8B · RTX 4090 >> nth=0", { label: "open pod" });
await page.click('text="Pod"', { label: "open Pod tab" });
await page.waitForSelector("text=https://pod1-8000.proxy.runpod.net/v1", { state: "visible", timeout: 10000 }).catch(() => {});
await page.click('[aria-label="Copy base URL"]', { label: "copy base URL" });

// assert: URL, hidden key and model shown; the button confirms the copy. manual: clipboard content checked in the installed app
await page.waitForSelector("text=Copied", { state: "visible", timeout: 5000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const ok = /USE FROM OTHER APPS[\s\S]*https:\/\/pod1-8000\.proxy\.runpod\.net\/v1[\s\S]*Copied[\s\S]*••••[\s\S]*Qwen\/Qwen3-8B/.test(snap);
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
