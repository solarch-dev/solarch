import { describe, it, expect, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { InternalFilter } from "./internal.filter";

function makeHostMock() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return {
    host: {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as any,
    status,
    json,
  };
}

describe("InternalFilter", () => {
  it("HttpException'ı kendi status + code'uyla döner", () => {
    const filter = new InternalFilter();
    const { host, status, json } = makeHostMock();
    filter.catch(new BadRequestException({ code: "ERR_X", message: "neden" }), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].error.code).toBe("ERR_X");
  });

  it("code'suz BadRequest (NestJS builtin, ör. bozuk JSON) → ERR_BAD_JSON + ham mesaj sızmaz", () => {
    const filter = new InternalFilter();
    const { host, status, json } = makeHostMock();
    // NestJS mapExternalException, body-parser SyntaxError'ını böyle bir BadRequest'e çevirir.
    filter.catch(new BadRequestException("Unexpected token } in JSON at position 6 {\"a\": }"), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].error.code).toBe("ERR_BAD_JSON");
    expect(json.mock.calls[0][0].error.message).not.toContain("position"); // ham parser mesajı sızmamalı
  });

  it("body-parser PayloadTooLarge (413) → ERR_PAYLOAD_TOO_LARGE", () => {
    const filter = new InternalFilter();
    const { host, status, json } = makeHostMock();
    // http-errors şekli (NestJS HttpException değil)
    filter.catch({ statusCode: 413, type: "entity.too.large", message: "too large" }, host);
    expect(status).toHaveBeenCalledWith(413);
    expect(json.mock.calls[0][0].error.code).toBe("ERR_PAYLOAD_TOO_LARGE");
  });

  it("bozuk JSON (400 entity.parse.failed) → ERR_BAD_JSON", () => {
    const filter = new InternalFilter();
    const { host, status, json } = makeHostMock();
    filter.catch({ statusCode: 400, type: "entity.parse.failed", message: "bad json" }, host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].error.code).toBe("ERR_BAD_JSON");
  });

  it("bilinmeyen hata → 500 ERR_INTERNAL", () => {
    const filter = new InternalFilter();
    const { host, status, json } = makeHostMock();
    filter.catch(new Error("patladı"), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json.mock.calls[0][0].error.code).toBe("ERR_INTERNAL");
  });
});
