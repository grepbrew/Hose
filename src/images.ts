import { invoke, isTauri } from "@tauri-apps/api/core";

// Photos, screenshots and PDF pages for a model that reads images: JPEG data URLs, the longest side at most MAX_SIDE.
// ponytail: 2048 px keeps a page near 3–4k tokens and its text sharp; raise it if small print gets misread.
export const MAX_SIDE = 2048;
/** Images in one message, PDF pages included; later ones are left out. */
export const MAX_IMAGES = 10;

/** w×h shrunk to fit MAX_SIDE, never enlarged. */
export function fit(w: number, h: number, max = MAX_SIDE) {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

// white first: a transparent screenshot would turn black as a JPEG
function canvasOf(w: number, h: number) {
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  return { canvas, ctx };
}
const jpeg = (canvas: HTMLCanvasElement) => canvas.toDataURL("image/jpeg", 0.9);

/** One data URL for an image, one per page for a PDF (at most room); more = pages left out. Throws if it can't be read. */
export async function toImages(file: File, room = MAX_IMAGES): Promise<{ images: string[]; more: boolean }> {
  if (file.type === "application/pdf") return pdfPages(file, room);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode(); // the web view's own decoder: HEIC opens in the app (WebKit), not in Chrome
    const { w, h } = fit(img.naturalWidth, img.naturalHeight);
    const { canvas, ctx } = canvasOf(w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { images: [jpeg(canvas)], more: false };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// pdf.js loads only when a PDF is attached. ponytail: no cMapUrl or standard fonts, so a PDF that doesn't embed its
// fonts (some CJK ones) may render blank; add them if that shows up.
async function pdfPages(file: File, room: number) {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  try {
    const doc = await task.promise;
    const images: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, room); n++) {
      const page = await doc.getPage(n);
      const pt = page.getViewport({ scale: 1 }); // in points, ~600 wide: render it up to MAX_SIDE
      const viewport = page.getViewport({ scale: MAX_SIDE / Math.max(pt.width, pt.height) });
      const { canvas } = canvasOf(Math.floor(viewport.width), Math.floor(viewport.height));
      await page.render({ canvas, viewport }).promise;
      images.push(jpeg(canvas));
    }
    return { images, more: doc.numPages > room };
  } finally {
    void task.destroy(); // frees the worker's copy
  }
}

// --- pictures a picture model made -----------------------------------------------------------------

/** 2026-10-23-153000-a-red-fox.png: when it was made, then the prompt's first words. */
export function imageName(prompt: string, at = new Date()) {
  const two = (n: number) => String(n).padStart(2, "0");
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-+|-+$/g, "") || "picture";
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}-${slug}.png`;
}

/** Writes a PNG data URL to ~/Pictures/Hose and returns its path; "" outside the app (vite dev keeps it in the page only). */
export async function saveImage(dataUrl: string, prompt: string): Promise<string> {
  if (!isTauri()) return "";
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (c) => c.charCodeAt(0));
  return invoke<string>("save_image", bytes, { headers: { name: imageName(prompt) } });
}

/** Shows the file selected in a Finder window. */
export const showInFinder = (path: string) => invoke("plugin:opener|reveal_item_in_dir", { paths: [path] });
