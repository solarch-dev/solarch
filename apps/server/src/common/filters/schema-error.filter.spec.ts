import { describe, it, expect, vi } from "vitest";
import { z, ZodError } from "zod";
import { SchemaErrorFilter } from "./schema-error.filter";

function makeHostMock() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return {
    host: {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    } as any,
    status,
    json,
  };
}

describe("SchemaErrorFilter", () => {
  it("converts ZodError to 400 + ERR_SCHEMA_INVALID envelope", () => {
    const filter = new SchemaErrorFilter();
    const { host, status, json } = makeHostMock();

    let zerr: ZodError;
    try {
      z.object({ name: z.string() }).parse({});
    } catch (e) {
      zerr = e as ZodError;
    }

    filter.catch(zerr!, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "ERR_SCHEMA_INVALID",
        message: "The submitted properties do not match the schema.",
        details: expect.any(Array),
      },
    });

    const arg = json.mock.calls[0][0];
    expect(arg.error.details).toHaveLength(1);
    expect(arg.error.details[0].field).toBe("name");
  });

  it("converts nested paths to dotted strings", () => {
    const filter = new SchemaErrorFilter();
    const { host, json } = makeHostMock();

    let zerr: ZodError;
    try {
      z.object({ properties: z.object({ Columns: z.array(z.object({ Name: z.string() })) }) })
        .parse({ properties: { Columns: [{}] } });
    } catch (e) {
      zerr = e as ZodError;
    }

    filter.catch(zerr!, host);
    const arg = json.mock.calls[0][0];
    expect(arg.error.details[0].field).toBe("properties.Columns.0.Name");
  });
});
