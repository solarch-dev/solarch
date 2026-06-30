import { describe, it, expect } from "vitest";
import {
  pascalCase,
  camelCase,
  kebabCase,
  snakeCase,
  pluralizeSnake,
  tableSqlName,
  scalarTsType,
  splitWords,
  relativeImportPath,
  importPathOf,
  resolveTypeRef,
} from "./naming";
import { buildCodeGraph } from "./ir";
import { ImportCollector } from "./imports";

describe("case donusumleri", () => {
  it("splitWords karisik girdileri boler", () => {
    expect(splitWords("userId")).toEqual(["user", "Id"]);
    expect(splitWords("UserProfile")).toEqual(["User", "Profile"]);
    expect(splitWords("user_profile")).toEqual(["user", "profile"]);
    expect(splitWords("user-profile")).toEqual(["user", "profile"]);
    expect(splitWords("HTTPServer")).toEqual(["HTTP", "Server"]);
  });

  it("pascalCase", () => {
    expect(pascalCase("user_profile")).toBe("UserProfile");
    expect(pascalCase("order-status")).toBe("OrderStatus");
    expect(pascalCase("UsersService")).toBe("UsersService");
  });

  it("camelCase", () => {
    expect(camelCase("UserProfile")).toBe("userProfile");
    expect(camelCase("order_status")).toBe("orderStatus");
  });

  it("kebabCase", () => {
    expect(kebabCase("UserProfile")).toBe("user-profile");
    expect(kebabCase("OrderStatus")).toBe("order-status");
    expect(kebabCase("HTTPServer")).toBe("http-server");
  });

  it("snakeCase", () => {
    expect(snakeCase("UserProfile")).toBe("user_profile");
    expect(snakeCase("orderStatus")).toBe("order_status");
  });
});

describe("pluralizeSnake", () => {
  it("temel kurallar", () => {
    expect(pluralizeSnake("User")).toBe("users");
    expect(pluralizeSnake("Category")).toBe("categories");
    expect(pluralizeSnake("Box")).toBe("boxes");
    expect(pluralizeSnake("OrderItem")).toBe("order_items");
    expect(pluralizeSnake("Address")).toBe("addresses");
  });

  it("unluden sonra -y -> -ys", () => {
    expect(pluralizeSnake("Day")).toBe("days");
  });
});

describe("tableSqlName (fiziksel tablo adi — cogullamaz)", () => {
  it("acik TableName'i LITERAL kabul eder (tekrar cogullamaz)", () => {
    // Eski hata: pluralizeSnake("users")="userses". tableSqlName bunu yapmaz.
    expect(tableSqlName("users")).toBe("users");
    expect(tableSqlName("orders")).toBe("orders");
    expect(tableSqlName("categories")).toBe("categories");
  });
  it("yalniz snake_case'ler (tekil/PascalCase oldugu gibi)", () => {
    expect(tableSqlName("User")).toBe("user");
    expect(tableSqlName("OrderItem")).toBe("order_item");
  });
});

describe("scalarTsType (sema tipi -> gecerli TS skaleri)", () => {
  it("yaygin tipleri normalize eder", () => {
    expect(scalarTsType("uuid")).toBe("string");
    expect(scalarTsType("text")).toBe("string");
    expect(scalarTsType("int")).toBe("number");
    expect(scalarTsType("long")).toBe("number");
    expect(scalarTsType("decimal")).toBe("number");
    expect(scalarTsType("bool")).toBe("boolean");
    expect(scalarTsType("datetime")).toBe("Date");
    expect(scalarTsType("")).toBe("string");
  });
  it("bilinmeyen tipi oldugu gibi birakir (ozel sinif/DTO adi)", () => {
    expect(scalarTsType("UserDto")).toBe("UserDto");
  });
  it("generic SQL ENUM/JSON tiplerini GECERLI TS'e cevirir (bare ENUM/JSON uretmez)", () => {
    // EnumRef'siz generic SQL ENUM (or. repository CustomQuery param Type="ENUM")
    //   -> string. Eskiden bare `ENUM` -> TS2304 (derleme kirik). sql-type-map ile tutarli.
    expect(scalarTsType("ENUM")).toBe("string");
    expect(scalarTsType("enum")).toBe("string");
    expect(scalarTsType("JSON")).toBe("Record<string, unknown>");
    expect(scalarTsType("jsonb")).toBe("Record<string, unknown>");
    // Ek SQL skaler varyantlari (sql-type-map ile tutarli).
    expect(scalarTsType("bigint")).toBe("number");
    expect(scalarTsType("smallint")).toBe("number");
    expect(scalarTsType("char")).toBe("string");
    expect(scalarTsType("timestamptz")).toBe("Date");
    expect(scalarTsType("time")).toBe("Date");
  });
});

describe("import yollari", () => {
  it("importPathOf uzantiyi atar", () => {
    expect(importPathOf("users/users.service.ts")).toBe("users/users.service");
  });

  it("relativeImportPath ayni klasor", () => {
    expect(relativeImportPath("users/users.controller.ts", "users/users.service.ts")).toBe(
      "./users.service",
    );
  });

  it("relativeImportPath kardes klasor", () => {
    expect(relativeImportPath("users/users.service.ts", "common/enums/role.enum.ts")).toBe(
      "../common/enums/role.enum",
    );
  });

  it("relativeImportPath alt klasor", () => {
    expect(relativeImportPath("users/users.service.ts", "users/dto/create-user.dto.ts")).toBe(
      "./dto/create-user.dto",
    );
  });
});

describe("resolveTypeRef — cozulemeyen serbest tip GUVENLI degrade olur (TS2304 onle)", () => {
  // Bos graf: hicbir node yok -> her PascalCase tip adi COZULEMEZ. Eskiden token
  // oldugu gibi gecip `Promise<TokenPair>` (TS2304) uretiyordu. Artik acik-uclu
  // `Record<string, unknown>`'a degrade olur: hem donus (obje insasi) hem tuketim
  // (member access -> unknown) derlenir; contract-lint ayrica uyari verir.
  const g = buildCodeGraph([], []);
  const ref = (raw: string) => resolveTypeRef(raw, g, "src/x.ts", new ImportCollector());

  it("ciplak cozulemeyen tip -> Record<string, unknown>", () => {
    expect(ref("TokenPair")).toBe("Record<string, unknown>");
    expect(ref("PaymentResult")).toBe("Record<string, unknown>");
  });

  it("sarmalayici korunur: Promise<X>, X[]", () => {
    expect(ref("Promise<PaymentResult>")).toBe("Promise<Record<string, unknown>>");
    expect(ref("Cart[]")).toBe("Record<string, unknown>[]");
  });

  it("skaler ve TS keyword'leri ETKILENMEZ", () => {
    expect(ref("UUID")).toBe("string");
    expect(ref("Promise<string>")).toBe("Promise<string>");
    expect(ref("number")).toBe("number");
    expect(ref("void")).toBe("void");
  });
});
