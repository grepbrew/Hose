// TC-105 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=on 2. click Qwen3-8B · RTX 4090 3. click Think first 4. fill Message = hi 5. click Send 6. expect Thought 7. expect Hello from fake GPU
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-105";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=on`, { waitUntil: "load" });
await page.click("text=Qwen3-8B · RTX 4090 >> nth=0", { label: "open pod" });
await page.click("text=Think first", { label: "ask it to think" });
await page.fill('[aria-label="Message"]', "hi");
await page.click('text="Send"', { label: "send" });

// assert: folded "Thought" above the answer; manual: no </think> left in the bubble, thinking folded once the answer came
await page.waitForSelector("text=Hello from fake GPU", { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const shown = await page.evaluate(() => {
  const reply = document.querySelector("li.assistant");
  return { folded: !reply.querySelector("details").open, tags: reply.textContent.includes("think>") };
});
const ok = /text "Thought"[\s\S]*Hello from fake GPU/.test(snap) && shown.folded && !shown.tags;
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
