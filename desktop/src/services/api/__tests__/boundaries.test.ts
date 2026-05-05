import { describe, expect, it } from "vitest";
import { api } from "@/services/api";

describe("api registry boundary", () => {
  it("exposes only domain accessors", () => {
    expect(typeof api.cron).toBe("function");
    expect(typeof api.model).toBe("function");
    expect(typeof api.overlays).toBe("function");
    expect(typeof api.settings).toBe("function");
    expect(typeof api.state).toBe("function");
  });
});
