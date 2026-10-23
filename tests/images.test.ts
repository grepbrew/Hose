import { describe, it, expect } from "vitest";
import { fit } from "../src/images";

describe("fit", () => {
  it.each([
    [4032, 3024, { w: 2048, h: 1536 }],
    [800, 600, { w: 800, h: 600 }],
    [1000, 5000, { w: 410, h: 2048 }],
  ])("%i×%i", (w, h, want) => {
    expect(fit(w, h)).toEqual(want);
  });
});
