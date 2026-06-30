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

describe("case dönüşümleri", () => {
  it("splitWords karışık girdileri böler", () => {
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

  it("ünlüden sonra -y -> -ys", () => {
    expect(pluralizeSnake("Day")).toBe("days");
  });
});

describe("tableSqlName (fiziksel tablo adı — çoğullamaz)", () => {
  it("açık TableName'i LİTERAL kabul eder (tekrar çoğullamaz)", () => {
    // Eski hata: pluralizeSnake("users")="userses". tableSqlName bunu yapmaz.
    expect(tableSqlName("users")).toBe("users");
    expect(tableSqlName("orders")).toBe("orders");
    expect(tableSqlName("categories")).toBe("categories");
  });
  it("yalnız snake_case'ler (tekil/PascalCase olduğu gibi)", () => {
    expect(tableSqlName("User")).toBe("user");
    expect(tableSqlName("OrderItem")).toBe("order_item");
  });
});

describe("scalarTsType (şema tipi -> geçerli TS skaleri)", () => {
  it("yaygın tipleri normalize eder", () => {
    expect(scalarTsType("uuid")).toBe("string");
    expect(scalarTsType("text")).toBe("string");
    expect(scalarTsType("int")).toBe("number");
    expect(scalarTsType("long")).toBe("number");
    expect(scalarTsType("decimal")).toBe("number");
    expect(scalarTsType("bool")).toBe("boolean");
    expect(scalarTsType("datetime")).toBe("Date");
    expect(scalarTsType("")).toBe("string");
  });
  it("bilinmeyen tipi olduğu gibi bırakır (özel sınıf/DTO adı)", () => {
    expect(scalarTsType("UserDto")).toBe("UserDto");
  });
  it("generic SQL ENUM/JSON tiplerini GEÇERLİ TS'e çevirir (bare ENUM/JSON üretmez)", () => {
    // EnumRef'siz generic SQL ENUM (ör. repository CustomQuery param Type="ENUM")
    //   -> string. Eskiden bare `ENUM` -> TS2304 (derleme kırık). sql-type-map ile tutarlı.
    expect(scalarTsType("ENUM")).toBe("string");
    expect(scalarTsType("enum")).toBe("string");
    expect(scalarTsType("JSON")).toBe("Record<string, unknown>");
    expect(scalarTsType("jsonb")).toBe("Record<string, unknown>");
    // Ek SQL skaler varyantları (sql-type-map ile tutarlı).
    expect(scalarTsType("bigint")).toBe("number");
    expect(scalarTsType("smallint")).toBe("number");
    expect(scalarTsType("char")).toBe("string");
    expect(scalarTsType("timestamptz")).toBe("Date");
    expect(scalarTsType("time")).toBe("Date");
  });
});

describe("import yolları", () => {
  it("importPathOf uzantıyı atar", () => {
    expect(importPathOf("users/users.service.ts")).toBe("users/users.service");
  });

  it("relativeImportPath aynı klasör", () => {
    expect(relativeImportPath("users/users.controller.ts", "users/users.service.ts")).toBe(
      "./users.service",
    );
  });

  it("relativeImportPath kardeş klasör", () => {
    expect(relativeImportPath("users/users.service.ts", "common/enums/role.enum.ts")).toBe(
      "../common/enums/role.enum",
    );
  });

  it("relativeImportPath alt klasör", () => {
    expect(relativeImportPath("users/users.service.ts", "users/dto/create-user.dto.ts")).toBe(
      "./dto/create-user.dto",
    );
  });
});

describe("resolveTypeRef — çözülemeyen serbest tip GÜVENLİ degrade olur (TS2304 önle)", () => {
  // Boş graf: hiçbir node yok -> her PascalCase tip adı ÇÖZÜLEMEZ. Eskiden token
  // olduğu gibi geçip `Promise<TokenPair>` (TS2304) üretiyordu. Artık açık-uçlu
  // `Record<string, unknown>`'a degrade olur: hem dönüş (obje inşası) hem tüketim
  // (member access -> unknown) derlenir; contract-lint ayrıca uyarı verir.
  const g = buildCodeGraph([], []);
  const ref = (raw: string) => resolveTypeRef(raw, g, "src/x.ts", new ImportCollector());

  it("çıplak çözülemeyen tip -> Record<string, unknown>", () => {
    expect(ref("TokenPair")).toBe("Record<string, unknown>");
    expect(ref("PaymentResult")).toBe("Record<string, unknown>");
  });

  it("sarmalayıcı korunur: Promise<X>, X[]", () => {
    expect(ref("Promise<PaymentResult>")).toBe("Promise<Record<string, unknown>>");
    expect(ref("Cart[]")).toBe("Record<string, unknown>[]");
  });

  it("skaler ve TS keyword'leri ETKİLENMEZ", () => {
    expect(ref("UUID")).toBe("string");
    expect(ref("Promise<string>")).toBe("Promise<string>");
    expect(ref("number")).toBe("number");
    expect(ref("void")).toBe("void");
  });
});
