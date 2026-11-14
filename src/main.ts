import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

// Mock mode for screen tests: fake RunPod/HF answer every request. `?seed=` picks the precondition.
if (import.meta.env.DEV && import.meta.env.VITE_MOCK) {
  const { network } = await import("virtual:msw");
  const { handlers, seed } = await import("../tests/mocks/handlers");
  const name = new URLSearchParams(location.search).get("seed");
  if (name === "fresh") localStorage.clear();
  // unreadable keys item: loadKeys throws
  else if (name === "broken") localStorage.setItem("hose.keys", "{");
  else if (name) localStorage.setItem("hose.keys", JSON.stringify({ runpod: "good-key", hf: "", vllm: "k1" }));
  // qwen is stored in the pre-2026-10-22 shape (no key/name) so every seed exercises the migration
  const qwen = { id: "Qwen/Qwen3-8B", params: { BF16: 8190735360 }, gpuId: "NVIDIA RTX 4090", gpuName: "RTX 4090", cloud: "SECURE", idleMin: 10 };
  const mistral = {
    key: "k-mistral",
    name: "Mistral-7B · A40",
    id: "mistralai/Mistral-7B-Instruct-v0.3",
    params: { BF16: 7248023552 },
    gpuId: "NVIDIA A40",
    gpuName: "A40",
    cloud: "SECURE",
    idleMin: 10,
    pastPodIds: ["old1"],
    spentPast: 1.24,
    last:{ dataCenter: "EU Romania 1", vcpu: 9, memoryGb: 50, diskGb: 42, image: "vllm/vllm-openai:v0.32.0", startedAt: "2026-10-21T09:00:00Z", runSpend: 0 },
  };
  const vol1 = { volumeId: "vol1", volumeDc: "US-TX-3", volumeGb: 25 }; // the model kept on a network volume
  // the quick start's Everyday questions model, saved and off
  const q9 = { key: "k-q9", name: "Qwen3.5-9B · A40", id: "Qwen/Qwen3.5-9B", params: { BF16: 9653100528, F32: 3840 }, gpuId: "NVIDIA A40", gpuName: "A40", cloud: "SECURE", idleMin: 10, price: 0.59, vram: 48, pastPodIds: [], spentPast: 0, volumeId: "vol1", volumeDc: "US-TX-3", volumeGb: 30 };
  // the quick start's Make pictures model, on (seed drawOn)
  const zi = { key: "k-z", name: "Z-Image-Turbo · A40", id: "Tongyi-MAI/Z-Image-Turbo", params: { F32: 6154908736 }, draws: true, gpuId: "NVIDIA A40", gpuName: "A40", cloud: "SECURE", idleMin: 10, price: 0.59, vram: 48, pastPodIds: [], spentPast: 0, podId: "pod1" };
  // the Qwen-Image-Edit preset on its recommended GPU, on (seed editOn)
  const qe = { key: "k-qe", name: "Qwen-Image-Edit · A100 SXM", id: "Qwen/Qwen-Image-Edit-2511", params: { BF16: 20430401088 }, draws: true, edits: true, gpuId: "NVIDIA A100-SXM4-80GB", gpuName: "A100 SXM", cloud: "SECURE", idleMin: 10, price: 2.19, vram: 80, pastPodIds: [], spentPast: 0, podId: "pod1" };
  // the quick start's Coding model, on (seed toolsOn): coding tools reach it through the relay
  const coder = { key: "k-coder", name: "Qwen3-Coder-30B · L40S", id: "Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8", params: { BF16: 636948480, F8_E4M3: 29896998912 }, gpuId: "NVIDIA L40S", gpuName: "L40S", cloud: "SECURE", idleMin: 10, price: 0.86, vram: 48, pastPodIds: [], spentPast: 0, podId: "pod1" };
  const models = { toolsOn: [coder], toolsNew: [coder], drawOn: [zi], editOn: [qe], off: [qwen], on: [{ ...qwen, podId: "pod1" }], two: [{ ...qwen, podId: "pod1" }, mistral], starting: [{ ...qwen, podId: "pod1" }], stored: [{ ...qwen, ...vol1 }], stuck: [{ ...qwen, podId: "pod1" }], storedOn: [{ ...qwen, ...vol1, podId: "pod1" }], presetOff: [q9], seeOn: [{ ...q9, podId: "pod1" }] }[name ?? ""];
  if (models) localStorage.setItem("hose.models", JSON.stringify(models));
  else if (name) localStorage.removeItem("hose.models");
  for (const k of ["hose.sel", "hose.details", "hose.theme", "hose.mockTools"]) if (name) localStorage.removeItem(k);
  // both coding tools installed, neither set up yet (api.ts pretend state)
  if (name === "toolsNew") localStorage.setItem("hose.mockTools", JSON.stringify({ claudeSetup: false, codexSetup: false }));
  seed(name);
  network.configure({ handlers });
  await network.enable();
}

// Appearance (Settings menu): System follows macOS, Light/Dark override it via data-theme.
try {
  const theme = localStorage.getItem("hose.theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {}

createApp(App).mount("#app");
