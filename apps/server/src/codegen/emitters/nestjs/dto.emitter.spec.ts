import { describe, it, expect } from "vitest";
import { emitDto } from "./dto.emitter";
import { buildCodeGraph } from "../../ir";
import type { EmitterContext } from "../../types";
import type { StoredNode } from "../../../nodes/nodes.repository";

/* ── Fixture helpers ──────────────────────────────────────────────── */
function storedNode(
  type: StoredNode["type"],
  properties: Record<string, unknown>,
  id: string,
): StoredNode {
  return {
    id,
    type,
    projectId: "00000000-0000-4000-8000-000000000000",
    positionX: 0,
    positionY: 0,
    homeTabId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    properties,
  };
}

function ctxFor(...nodes: StoredNode[]): EmitterContext {
  const graph = buildCodeGraph(nodes, []);
  return { graph, target: "nestjs" };
}

const DTO_ID = "11111111-1111-4111-8111-111111111111";
const ADDRESS_DTO_ID = "33333333-3333-4333-8333-333333333333";
const ROLE_ENUM_ID = "44444444-4444-4444-8444-444444444444";

/** Ic ice DTO referansi (CreateUserDto.addresses -> AddressDto). */
const ADDRESS_DTO = storedNode(
  "DTO",
  {
    Name: "AddressDto",
    Description: "Adres",
    Fields: [
      { Name: "city", DataType: "string", IsRequired: true, IsArray: false, ValidationRules: [] },
    ],
  },
  ADDRESS_DTO_ID,
);

/** Enum referansi (CreateUserDto.role -> UserRole). */
const ROLE_ENUM = storedNode(
  "Enum",
  {
    Name: "UserRole",
    Description: "User rolu",
    BackingType: "string",
    Values: [{ Key: "ADMIN" }, { Key: "MEMBER" }],
  },
  ROLE_ENUM_ID,
);

/** Zengin, gercekci DTO: primitif + dogrulama + opsiyonel + dizi + enum + nested. */
const CREATE_USER_DTO = storedNode(
  "DTO",
  {
    Name: "CreateUserDto",
    Description: "User olusturma payload'i",
    Fields: [
      {
        Name: "email",
        DataType: "string",
        IsRequired: true,
        IsArray: false,
        ValidationRules: [{ Rule: "Email" }, { Rule: "MaxLength", Value: "255" }],
        Description: "Benzersiz e-posta",
      },
      {
        Name: "age",
        DataType: "int",
        IsRequired: false,
        IsArray: false,
        ValidationRules: [{ Rule: "Min", Value: "18" }, { Rule: "Max", Value: "120" }],
      },
      {
        Name: "tags",
        DataType: "string",
        IsRequired: false,
        IsArray: true,
        ValidationRules: [{ Rule: "MaxLength", Value: "32" }],
      },
      {
        Name: "role",
        DataType: "string",
        IsRequired: true,
        IsArray: false,
        ValidationRules: [],
        EnumRef: "UserRole",
      },
      {
        Name: "addresses",
        DataType: "object",
        IsRequired: false,
        IsArray: true,
        ValidationRules: [],
        NestedDTORef: "AddressDto",
      },
    ],
  },
  DTO_ID,
);

describe("emitDto", () => {
  it("zengin DTO — snapshot", () => {
    const ctx = ctxFor(CREATE_USER_DTO, ADDRESS_DTO, ROLE_ENUM);
    const [file] = emitDto(ctx.graph.byId(DTO_ID)!, ctx);
    expect(file).toMatchInlineSnapshot(`
      {
        "content": "import { ApiProperty } from "@nestjs/swagger";
      import { Type } from "class-transformer";
      import { IsArray, IsEmail, IsEnum, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from "class-validator";
      import { UserRole } from "../enums/user-role.enum";
      import { AddressDto } from "./address.dto";

      /** User olusturma payload'i */
      export class CreateUserDto {
        /** Benzersiz e-posta */
        @IsString()
        @IsEmail()
        @MaxLength(255)
        @ApiProperty({ required: true, description: "Benzersiz e-posta" })
        email!: string;

        @IsOptional()
        @IsNumber()
        @Min(18)
        @Max(120)
        @ApiProperty({ required: false })
        age?: number;

        @IsOptional()
        @IsArray()
        @IsString({ each: true })
        @MaxLength(32, { each: true })
        @ApiProperty({ required: false, isArray: true })
        tags?: string[];

        @IsEnum(UserRole)
        @ApiProperty({ required: true, enum: UserRole })
        role!: UserRole;

        @IsOptional()
        @IsArray()
        @ValidateNested({ each: true })
        @Type(() => AddressDto)
        @ApiProperty({ required: false, type: () => AddressDto, isArray: true })
        addresses?: AddressDto[];
      }
      ",
        "language": "typescript",
        "path": "common/dto/create-user.dto.ts",
        "surgicalMarkers": 0,
      }
    `);
  });

  it("dosya yolu kebab-case <feature>/dto altinda", () => {
    const ctx = ctxFor(CREATE_USER_DTO, ADDRESS_DTO, ROLE_ENUM);
    const [file] = emitDto(ctx.graph.byId(DTO_ID)!, ctx);
    // DTO tek basina (tuketen Controller/Service yok) -> "common" feature; dosya
    // adi rol son-ekini ("DTO"/"Dto") TEKRARLAMAZ (create-user.dto.ts).
    expect(file.path).toBe("common/dto/create-user.dto.ts");
    expect(file.path).toMatch(/\/dto\/.+\.dto\.ts$/);
    expect(file.language).toBe("typescript");
  });

  it("class-validator + class-transformer import'lari sirali ve dogru", () => {
    const ctx = ctxFor(CREATE_USER_DTO, ADDRESS_DTO, ROLE_ENUM);
    const [file] = emitDto(ctx.graph.byId(DTO_ID)!, ctx);
    // Paket import'lari goreli import'lardan once gelir.
    expect(file.content).toContain('from "class-validator";');
    expect(file.content).toContain('import { Type } from "class-transformer";');
    const validatorIdx = file.content.indexOf('from "class-validator"');
    const enumImportIdx = file.content.indexOf('from "../enums/user-role.enum"');
    expect(validatorIdx).toBeGreaterThanOrEqual(0);
    expect(enumImportIdx).toBeGreaterThan(validatorIdx);
  });

  it("EnumRef -> @IsEnum + goreli import; NestedDTORef -> @ValidateNested + @Type + import", () => {
    const ctx = ctxFor(CREATE_USER_DTO, ADDRESS_DTO, ROLE_ENUM);
    const [file] = emitDto(ctx.graph.byId(DTO_ID)!, ctx);
    expect(file.content).toContain("@IsEnum(UserRole)");
    expect(file.content).toContain("role!: UserRole;");
    expect(file.content).toContain("@ValidateNested({ each: true })");
    expect(file.content).toContain("@Type(() => AddressDto)");
    expect(file.content).toContain("addresses?: AddressDto[];");
    expect(file.content).toContain('import { AddressDto } from "./address.dto";');
  });

  it("IsRequired=false -> @IsOptional + '?'; IsArray -> @IsArray + '[]' + { each: true }", () => {
    const ctx = ctxFor(CREATE_USER_DTO, ADDRESS_DTO, ROLE_ENUM);
    const [file] = emitDto(ctx.graph.byId(DTO_ID)!, ctx);
    expect(file.content).toContain("@IsOptional()");
    expect(file.content).toContain("age?: number;");
    expect(file.content).toContain("@IsArray()");
    expect(file.content).toContain("tags?: string[];");
    expect(file.content).toContain("@IsString({ each: true })");
  });

  it("DTO govdesi yok -> surgical marker 0; content ends with single newline", () => {
    const ctx = ctxFor(CREATE_USER_DTO, ADDRESS_DTO, ROLE_ENUM);
    const [file] = emitDto(ctx.graph.byId(DTO_ID)!, ctx);
    expect(file.surgicalMarkers).toBe(0);
    expect(file.content.endsWith("}\n")).toBe(true);
    expect(file.content.endsWith("}\n\n")).toBe(false);
  });

  it("DETERMINISM: same node twice -> byte-identical", () => {
    const ctx = ctxFor(CREATE_USER_DTO, ADDRESS_DTO, ROLE_ENUM);
    const a = emitDto(ctx.graph.byId(DTO_ID)!, ctx)[0].content;
    const b = emitDto(ctx.graph.byId(DTO_ID)!, ctx)[0].content;
    expect(a).toBe(b);
  });

  it("EDGE-CASE: kayip Enum/NestedDTO ref -> throw NONE, import atlanir, TODO birakilir", () => {
    // Sadece DTO eklenir; UserRole enum ve AddressDto graph'ta NONE.
    const ctx = ctxFor(CREATE_USER_DTO);
    const [file] = emitDto(ctx.graph.byId(DTO_ID)!, ctx);
    // Tip dekoratoru/tip hâlâ yazilir.
    expect(file.content).toContain("@IsEnum(UserRole)");
    expect(file.content).toContain("@Type(() => AddressDto)");
    // Cozulemeyen import'lar eklenmez.
    expect(file.content).not.toContain('from "../../common/enums/user-role.enum"');
    expect(file.content).not.toContain('from "./address.dto"');
    // TODO isaretleri birakilir.
    expect(file.content).toContain('// TODO(solarch): Enum ref "UserRole" could not be resolved');
    expect(file.content).toContain('// TODO(solarch): NestedDTO ref "AddressDto" could not be resolved');
  });

  it("EDGE-CASE: bilinmeyen DataType -> tip oldugu gibi, primitif dekorator eklenmez", () => {
    const weird = storedNode(
      "DTO",
      {
        Name: "WeirdDto",
        Description: "tuhaf",
        Fields: [
          { Name: "payload", DataType: "Buffer", IsRequired: true, IsArray: false, ValidationRules: [] },
        ],
      },
      "55555555-5555-4555-8555-555555555555",
    );
    const ctx = ctxFor(weird);
    const [file] = emitDto(ctx.graph.byId(weird.id)!, ctx);
    expect(file.content).toContain("payload!: Buffer;");
    expect(file.content).not.toContain("@IsString");
    expect(file.content).not.toContain("@IsNumber");
  });

  /* ── SELF-REFERENTIAL DTO (tree/ozyinelemeli — CategoryResponse.children) ──
   * Audit #5/#28: agac DTO'su temsil edilemiyordu. NestedDTORef DTO'nun KENDISINE
   * isaret ederse (children: CategoryResponse[]), tip+@Type uretilir ama sinif KENDI
   * dosyasindan import EDILMEZ (zaten kapsamda; self-import = TS hatasi). Bu, agac/
   * ozyinelemeli DTO'lari mumkun kilar (kardinalite ReturnsCollection ile zaten dizi). */
  it("self-referential nested DTO (children) -> Self[] + @Type, kendini import ETMEZ", () => {
    const cat = storedNode(
      "DTO",
      {
        Name: "CategoryResponse",
        Description: "kategori agaci dugumu",
        Fields: [
          { Name: "id", DataType: "string", IsRequired: true, IsArray: false },
          { Name: "children", DataType: "CategoryResponse", IsRequired: false, IsArray: true, NestedDTORef: "CategoryResponse" },
        ],
      },
      "ca700000-0000-4000-8000-000000000001",
    );
    const ctx = ctxFor(cat);
    const [file] = emitDto(ctx.graph.byId(cat.id)!, ctx);
    // Ozyinelemeli alan: tip Self[] + @Type(() => Self) + @ValidateNested.
    expect(file.content).toMatch(/children\??:\s*CategoryResponse\[\]/);
    expect(file.content).toContain("@Type(() => CategoryResponse)");
    expect(file.content).toContain("@ValidateNested");
    // KENDINI import ETMEZ (self-import kirik olurdu).
    expect(file.content).not.toMatch(/import \{[^}]*CategoryResponse[^}]*\} from/);
  });

  /* ── Task 7: @ApiProperty decorators (self-documenting generated app) ──
   * Each generated DTO field carries an @ApiProperty descriptor so the generated
   * app's OpenAPI schema is rich. `required` reflects IsRequired; enum fields
   * reference the enum class as a runtime value; nested DTOs use a `type: () => X`
   * thunk; arrays set isArray:true; Description carries through. Mirrors the
   * controller emitter's @ApiResponse/@ApiOperation key order. */
  it("emits @ApiProperty per field + imports ApiProperty from @nestjs/swagger", () => {
    const ctx = ctxFor(CREATE_USER_DTO, ADDRESS_DTO, ROLE_ENUM);
    const [file] = emitDto(ctx.graph.byId(DTO_ID)!, ctx);
    // one @ApiProperty per field (CreateUserDto has 5 fields)
    const count = (file.content.match(/@ApiProperty\(/g) ?? []).length;
    expect(count).toBe(5);
    // ApiProperty imported from @nestjs/swagger (value import)
    expect(file.content).toContain('import { ApiProperty } from "@nestjs/swagger";');
    // required reflects IsRequired; Description carried through
    expect(file.content).toContain('@ApiProperty({ required: true, description: "Benzersiz e-posta" })');
    expect(file.content).toContain("@ApiProperty({ required: false })");
    // enum field references the enum class as a runtime value
    expect(file.content).toContain("@ApiProperty({ required: true, enum: UserRole })");
    // array primitive sets isArray:true
    expect(file.content).toContain("@ApiProperty({ required: false, isArray: true })");
    // nested DTO uses a forward-ref thunk + isArray
    expect(file.content).toContain("@ApiProperty({ required: false, type: () => AddressDto, isArray: true })");
  });
});
