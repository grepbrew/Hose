// TC-217 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=storedOn 2. click Qwen3-8B · RTX 4090 3. click Pod 4. expect Turn off to remove
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-217";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=storedOn`, { waitUntil: "load" });
await page.waitForSelector("text=Qwen3-8B · RTX 4090", { state: "visible", timeout: 10000 }).catch(() => {});
await page.click("text=Qwen3-8B · RTX 4090 >> nth=0", { label: "open pod" });
await page.click('text="Pod"', { label: "open Pod tab" });

// assert: while the pod is on, the Storage section says to turn off first and its Remove button is disabled
await page.waitForSelector("text=Turn off to remove", { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
// manual: the snapshot doesn't carry the disabled state, so read it from the button
const disabled = await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Remove storage"))?.disabled);
const ok = snap.includes("Turn off to remove") && disabled === true;
console.log(`${TC}: ${ok ? "PASS" : "FAIL"}`);

try {
  await page.screenshot({ path: `${EVIDENCE}/${TC}.png`, fullPage: true });
} catch (e) {
  console.log(`${TC}: evidence skipped (${e.message})`);
}
if (!ok) {
  console.log(snap, { disabled });
  process.exitCode = 1;
}

try {
  await task.finish({ keep: [] });
} catch (e) {
  console.log(`${TC}: finish skipped (${e.message})`);
}
