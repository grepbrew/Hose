# Hose

Run your own AI chat (and picture) models on a rented GPU, from a Mac app, without touching a terminal.

Paste a RunPod API key, pick a model, press **Turn on**. Hose starts a RunPod GPU Pod running [vLLM](https://github.com/vllm-project/vllm), lets you chat with it, and deletes the Pod by itself when nobody has used it for a while. The sidebar shows your RunPod balance, what each Pod costs per hour and what this session has cost so far.

## What it does

- **Quick start**: seven cards (Everyday questions, Read photos & documents, Writing & email, Hard problems, Coding, Fast & cheap, Make pictures), each with a model and GPU already picked. Or choose any Hugging Face model yourself; Hose rejects models it can't run and recommends the cheapest GPU that runs yours smoothly.
- **Chat**: replies render as Markdown (code with Copy, math, links open in your browser). Optional **Think first** and **Show log** (the live server log).
- **Photos and PDFs**: vision models read photos, screenshots and PDF pages you attach, paste or drop.
- **Pictures**: picture models ([vLLM-Omni](https://github.com/vllm-project/vllm-omni)) make images from a description, saved to `~/Pictures/Hose`. Steps, seed, things to avoid and guidance are in Settings.
- **Chat history**: past chats are kept on your Mac and can be read even when the Pod is off.
- **Turns itself off**: a small watchdog on the Pod deletes it after 10 quiet minutes (configurable, or never), when an optional budget runs out, or when it fails to start within 20 minutes. This works even if your Mac sleeps or Hose is closed.
- **Faster restarts**: on Secure cloud the model can be kept on a RunPod network volume, so the next Turn on skips the download. Storage costs about $0.07/GB a month while it exists; the Storage section shows the cost and removes it.
- **API**: each running Pod is an OpenAI-compatible endpoint (base URL and key on the pod page), so other apps can use it too.

## Before you start

- A Mac with macOS 12 or later.
- A [RunPod](https://www.runpod.io) account with credit, and an API key. You pay RunPod directly.
- A [Hugging Face](https://huggingface.co/settings/tokens) token, only for gated models such as Llama.

A first Turn on takes about 5 to 10 minutes while the Pod downloads the model and warms up.

## Install

```sh
brew trust --cask grepbrew/tap/hose      # Homebrew 7+ only loads casks from taps you trust
brew install --cask grepbrew/tap/hose    # update later: brew upgrade --cask hose
```

Hose is not notarized by Apple (the brew build is ad-hoc signed). The cask clears the quarantine flag; if macOS still refuses to open it, go to System Settings > Privacy & Security and click **Open Anyway**.

## Your data

| What | Where |
|---|---|
| API keys, saved models, settings | the app's local storage (`~/Library/WebKit/com.grepbrew.hose/WebsiteData/LocalStorage`), a plain file, not the Keychain |
| Chat history | `~/Library/Application Support/com.grepbrew.hose/hose.db` (SQLite) |
| Pictures | `~/Pictures/Hose` |

Chats and pictures go through RunPod's proxy to your own Pod, nowhere else.

## Build from source

Needs Node 22 and Rust (stable).

```sh
npm install
npm run tauri dev      # the app, with hot reload
npm run tauri build    # Hose.app and a .dmg in src-tauri/target/release/bundle/
```

Without RunPod credit, `npm run dev:mock` serves the UI in a browser at http://localhost:5199 with fake RunPod and Hugging Face answers. `?seed=` picks the starting state; the seeds are listed at the top of `tests/TEST_CASES.md`.

## Tests

```sh
npm test    # type check, vitest, watchdog test
```

Test cases live in `tests/TEST_CASES.md`; screen tests in `tests/screen/` run with ego-browser against `npm run dev:mock`; the `screen run:` line at the top of `TEST_CASES.md` is the exact command.

## Release

Push a tag `vX.Y.Z` matching the version in `src-tauri/tauri.conf.json`. `.github/workflows/release.yml` runs the tests, builds a universal `.dmg`, attaches it to a GitHub release and updates the cask in `grepbrew/homebrew-tap`. It needs one repo secret, `TAP_DEPLOY_KEY`: the private half of a read-write deploy key on the tap.

## Built with

Tauri 2, Vue 3, TypeScript, Vite. RunPod REST API v2 (GraphQL for the balance only), Hugging Face Hub API, vLLM `vllm/vllm-openai:v0.32.0`, vLLM-Omni `vllm/vllm-omni:v0.30.0`.
