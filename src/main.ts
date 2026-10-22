import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

// Mock mode for screen tests: fake RunPod/HF answer every request. `?seed=` picks the precondition.
if (import.meta.env.DEV && import.meta.env.VITE_MOCK) {
  const { network } = await import("virtual:msw");
  const { handlers, seed } = await import("../tests/mocks/handlers");
  const name = new URLSearchParams(location.search).get("seed");
  if (name === "fresh") localStorage.clear();
  else if (name) localStorage.setItem("hose.runpod", "good-key");
  seed(name);
  network.configure({ handlers });
  await network.enable();
}

createApp(App).mount("#app");
