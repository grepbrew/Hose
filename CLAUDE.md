# Hose

macOS app (Tauri 2 + Vue 3 + TS) for non-technical users: paste a RunPod key, pick a Hugging Face model and GPU, Turn on → a RunPod Pod runs vLLM (or vLLM-Omni for picture models) → chat / make pictures → the Pod deletes itself when idle. See README.md for the user-facing story.

## Commands

- `npm test` — vue-tsc + vitest + `tests/watchdog_test.py`. The done gate; must be green.
- `npm run dev:mock` — UI in a browser on :5199, msw fakes RunPod + HF. `/?seed=<name>` picks the state (seeds listed in the `tests/TEST_CASES.md` header).
- `npm run tauri dev` — real app against real RunPod (costs money; ask before starting a Pod).
- `npm run tauri build` — signed `Hose.app` + `.dmg` (identity "Hose Local Signing").

## Layout

- `src/cost.ts` — pure logic: model sizing, GPU cards, Pod spec (`podInput`), cost math, presets (`QUICK`), image tags. No I/O; most unit tests hit this.
- `src/api.ts` — every network call. In Tauri it uses tauri-plugin-http (RunPod's management API blocks CORS); in vite/tests plain fetch + msw.
- `src/fleet.ts` — reactive configs (saved on this Mac) + polled Pods, shared by views.
- `src/history.ts` — chat history in SQLite (`hose.db`, tauri-plugin-sql). No-op outside Tauri.
- `src/secrets.ts` — keys in localStorage `hose.keys` (not the Keychain, by decision).
- `src/watchdog.py` — runs on the Pod (stdlib only, passed via env `HOSE_WATCHDOG`); deletes the Pod on idle / budget / stuck boot.
- `src/images.ts`, `src/markdown.ts` — attachments → JPEG data URLs; Markdown + highlight + KaTeX.
- `src/views/*.vue` — no router, no state lib. `App.vue` switches pages.
- `src-tauri/src/lib.rs` — plugins + one command, `save_image` (→ `~/Pictures/Hose`).
- `tests/` — `*.test.ts` (vitest), `mocks/handlers.ts` (msw + seeds), `fixtures/`, `screen/TC-*.mjs` (ego-browser).

## Rules

- Branch first, PR per change, squash merge. Every PR bumps the patch version in all five: `package.json`, `package-lock.json` (top two), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (`name = "hose"`).
- Every feature/fix adds rows to `tests/TEST_CASES.md` (next free TC id, check other worktrees first) and a code test. Screen TCs run through the header's `screen run:` line verbatim.
- Never edit a test to make it pass; fix the code.
- Same controls for every model; blank field = server default. No per-model hard-coded UI.
- Mockups start from real app screenshots (`dev:mock`, 1440×900), never a redraw.
- Mock fixtures are copied from `api.runpod.io/v2/openapi.json` examples or real responses, never guessed.
- RunPod REST v2 for everything; GraphQL only for the balance.
- Comments explain why, short. Deliberate shortcuts get a `ponytail:` comment naming the ceiling.
- UI copy is plain English for non-tech users; spend shown with "≈" (estimated locally).

## Known traps

- vLLM image is `vllm/vllm-openai:v0.32.0` (CUDA 13). Never the `-cu129` variant (crash-loops on torchcodec).
- Pod entrypoint: `vllm …; sleep infinity`, never `& exec vllm` (a crash loop resets the watchdog and bills forever).
- A stopped RunPod Pod often can't restart (its GPU is taken), so Turn off = delete; the model survives on a network volume.
- vLLM-Omni defaults to ~50 steps; always send `num_inference_steps`. Its metrics are `vllm_omni:*`.
- Qwen3.5 thinking streams only `</think>` (the template opens `<think>` in the prompt).
- CJS Vite plugins arrive as `{ default: fn }` in dev → blank app while vitest stays green.
- :5199 may be served by a stale vite from another checkout; check `ps` before screen tests.
- More: the vault's `Projects/hose/memory/gotcha-*` notes. Read them before diagnosing.
