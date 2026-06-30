import { describe, it, expect } from "vitest";
import { GRAPH_SCHEMA_VERSION } from "./version";

describe("GRAPH_SCHEMA_VERSION", () => {
  it("pozitif integer", () => {
    expect(Number.isInteger(GRAPH_SCHEMA_VERSION)).toBe(true);
    expect(GRAPH_SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
  });
});
