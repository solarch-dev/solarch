import type { GeneratedFile, NodeEmitter } from "../../types";
import { propsOf, type CodeNode } from "../../ir";
import { camelCase, filePathFor, importPathOf, pascalCase, relativeImportPath } from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers } from "../../surgical";
import { sqlTypeToTs } from "./sql-type-map";

/* ────────────────────────────────────────────────────────────────────────
 * dto.emitter.ts — DTONode -> <feature>/dto/<d>.dto.ts (class-validator).
 *
 * enum.emitter.ts'i (kanonik referans) birebir taklit eder:
 *   - named `export const emitDto: NodeEmitter`; default export YOK.
 *   - SAF fonksiyon (node, ctx) -> GeneratedFile[]; I/O yok, throw YOK.
 *   - Yol her zaman filePathFor(node, ctx.graph) ile.
 *   - import'lar ImportCollector ile (elle "import" YASAK).
 *   - DETERMİNİSTİK: alanlar verildiği SIRADA, dekoratörler sabit sırada.
 *   - İçerik tek "\n" ile biter.
 *
 * DTO'nun GÖVDESİ YOKTUR (saf veri taşıyıcı) -> surgical marker YOK -> 0.
 *
 * Her Field -> property + class-validator dekoratörleri:
 *   ValidationRules:  Min->@Min, Max->@Max, MinLength->@MinLength,
 *                     MaxLength->@MaxLength, Email->@IsEmail, Url->@IsUrl,
 *                     Regex/Pattern->@Matches, Positive->@IsPositive,
 *                     Negative->@IsNegative.
 *   DataType:         string->@IsString, number/int/float->@IsNumber,
 *                     boolean->@IsBoolean, date->@IsDate.
 *   IsRequired=false -> @IsOptional + "?" (property opsiyonel).
 *   IsArray=true     -> @IsArray + "[]" (her dekoratöre { each: true }).
 *   NestedDTORef     -> @ValidateNested + @Type(() => X) (class-transformer) + import.
 *   EnumRef          -> @IsEnum(X) + import.
 * ──────────────────────────────────────────────────────────────────────── */

export const emitDto: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = propsOf<"DTO">(node);
  const className = pascalCase(node.name);
  const selfPath = filePathFor(node, ctx.graph);

  const imports = new ImportCollector();
  // class-validator sembolleri tek slot'ta toplanır; render() sıralar + tekilleştirir.
  const validator = (symbol: string) => imports.add(symbol, "class-validator");

  const lines: string[] = [];
  if (props.Description) {
    lines.push(`/** ${props.Description} */`);
  }
  lines.push(`export class ${className} {`);

  const fields = props.Fields ?? [];
  fields.forEach((field, idx) => {
    if (idx > 0) lines.push("");

    const isArray = field.IsArray === true;
    const optional = field.IsRequired === false;
    const eachOpt = isArray ? "{ each: true }" : "";

    // @ApiProperty için tip referansı: enum -> `enum: X`, nested DTO -> `type: () => X`.
    // Çözülemese de (resolveRef null) ad yazılır; @IsEnum/@Type davranışıyla tutarlı.
    let apiEnumName: string | null = null;
    let apiNestedName: string | null = null;

    if (field.Description) lines.push(`  /** ${field.Description} */`);

    // ── 1) İsteğe bağlılık ──
    if (optional) {
      validator("IsOptional");
      lines.push("  @IsOptional()");
    }

    // ── 2) Dizi ──
    if (isArray) {
      validator("IsArray");
      lines.push("  @IsArray()");
    }

    // ── 3) Tip dekoratörü (EnumRef > NestedDTORef > DataType) ──
    let tsType: string;
    if (field.EnumRef) {
      const enumNode = ctx.graph.resolveRef("Enum", field.EnumRef);
      // Sınıf adı ÇÖZÜLEN node'un adından gelir (üretilen enum dosyasının export
      // adıyla birebir eşleşsin); çözülemezse ref string'inden türetilir.
      const enumName = pascalCase(enumNode ? enumNode.name : field.EnumRef);
      validator("IsEnum");
      lines.push(`  @IsEnum(${enumName}${eachOpt ? `, ${eachOpt}` : ""})`);
      tsType = enumName;
      apiEnumName = enumName;
      if (enumNode) {
        // feature layout: yol filePathFor(enumNode) ile (common/enums/... veya
        // <feature>/enums/...) çözülür; göreli yol selfPath'e göre türetilir.
        imports.add(enumName, importPathOf(relativeImportPath(selfPath, filePathFor(enumNode, ctx.graph))));
      } else {
        // Kayıp ref -> import atlanır (resolveRef null); tip yine de yazılır.
        lines.push(`  // TODO(solarch): Enum ref "${field.EnumRef}" could not be resolved`);
      }
    } else if (field.NestedDTORef) {
      const dtoNode = ctx.graph.resolveRef("DTO", field.NestedDTORef);
      const nestedName = pascalCase(dtoNode ? dtoNode.name : field.NestedDTORef);
      validator("ValidateNested");
      imports.add("Type", "class-transformer");
      lines.push(`  @ValidateNested(${eachOpt})`);
      lines.push(`  @Type(() => ${nestedName})`);
      tsType = nestedName;
      apiNestedName = nestedName;
      if (dtoNode) {
        // SELF-REF (tree/özyinelemeli, ör. children: CategoryResponse[]): sınıf zaten
        // KENDİ dosyasında tanımlı -> kendini import ETME (self-import TS hatası).
        // Aksi halde iç içe DTO yolu feature layout'a göre çözülür (aynı feature ise
        // "./<base>.dto", farklıysa "../<other-feature>/dto/<base>.dto").
        if (dtoNode.id !== node.id) {
          imports.add(nestedName, importPathOf(relativeImportPath(selfPath, filePathFor(dtoNode, ctx.graph))));
        }
      } else {
        lines.push(`  // TODO(solarch): NestedDTO ref "${field.NestedDTORef}" could not be resolved`);
      }
    } else {
      const mapped = mapDataType(field.DataType);
      tsType = mapped.tsType;
      if (mapped.decorator) {
        validator(mapped.decorator);
        lines.push(`  @${mapped.decorator}(${eachOpt})`);
      } else {
        // Serbest tip (bilinmeyen identifier) ham döndü → üretilen bir DTO/Model/Enum
        // sınıfına çöz: kanonik adı (pascalCase) kullan + import et. Aksi halde
        // graf'taki ham string (örn. "ComplaintResponseDTO") TS2304 verir.
        const ref =
          ctx.graph.resolveRef("DTO", field.DataType) ??
          ctx.graph.resolveRef("Model", field.DataType) ??
          ctx.graph.resolveRef("Enum", field.DataType);
        if (ref) {
          tsType = pascalCase(ref.name);
          imports.add(tsType, importPathOf(relativeImportPath(selfPath, filePathFor(ref, ctx.graph))));
        }
      }
    }

    // ── 4) ValidationRules (şema sırasında) ──
    for (const rule of field.ValidationRules ?? []) {
      const dec = mapValidationRule(rule.Rule, rule.Value, eachOpt);
      if (!dec) continue;
      validator(dec.symbol);
      lines.push(`  @${dec.symbol}(${dec.args})`);
    }

    // ── 5) @ApiProperty (kendini-belgeleyen üretilmiş uygulama) ──
    // Her alan bir OpenAPI property tanımlayıcısı taşır (controller.emitter'daki
    // @ApiResponse/@ApiOperation ile aynı anahtar sırası: required, description,
    // type/enum, isArray). `required` IsRequired'i yansıtır; enum alanı enum
    // sınıfını çalışma-zamanı DEĞER'i olarak referanslar; nested DTO ileri-referans
    // güvenli `type: () => X` thunk'ı kullanır; dizi alanı isArray:true alır.
    imports.add("ApiProperty", "@nestjs/swagger");
    const apiParts: string[] = [`required: ${!optional}`];
    if (field.Description) apiParts.push(`description: ${JSON.stringify(field.Description)}`);
    if (apiEnumName) apiParts.push(`enum: ${apiEnumName}`);
    else if (apiNestedName) apiParts.push(`type: () => ${apiNestedName}`);
    if (isArray) apiParts.push(`isArray: true`);
    lines.push(`  @ApiProperty({ ${apiParts.join(", ")} })`);

    // ── 6) Property satırı ──
    // Zorunlu (initializer'sız) alanlar definite-assignment "!" alır; strict:true
    // (strictPropertyInitialization) altında TS2564 vermeden derlenir — DTO standardı.
    // Opsiyonel "?" alanlar dokunulmaz.
    const opt = optional ? "?" : "";
    const assertion = optional ? "" : "!";
    const arr = isArray ? "[]" : "";
    lines.push(`  ${camelCase(field.Name)}${opt}${assertion}: ${tsType}${arr};`);
  });

  lines.push("}");

  const importBlock = imports.render();
  const body = (importBlock ? `${importBlock}\n\n` : "") + lines.join("\n") + "\n";

  const file: GeneratedFile = {
    path: selfPath,
    content: body,
    language: "typescript",
    surgicalMarkers: countSurgicalMarkers(body),
  };
  return [file];
};

/* ── DataType -> (TS tipi, class-validator dekoratörü) ─────────────────────
 * DataType serbest string'tir; yaygın eş anlamlılar normalize edilir
 * (büyük/küçük harf duyarsız). Tanınmayan tip -> tsType olduğu gibi pascal'lı
 * referans, primitif dekoratör YOK (yanlış doğrulama eklemekten kaçınılır). */
function mapDataType(dataType: string): { tsType: string; decorator: string | null } {
  // TS tipi sql-type-map TEK KAYNAĞINDAN gelir (entity/Model ile tutarlı); DTO
  // serbest tip olduğundan bilinmeyen tip OLDUĞU GİBİ geçer (unknownAsString=false).
  // Dekoratör (class-validator) eşlemesi DTO'ya özeldir.
  const tsType = sqlTypeToTs(dataType, false);
  switch (tsType) {
    case "string":
      return { tsType, decorator: "IsString" };
    case "number":
      return { tsType, decorator: "IsNumber" };
    case "boolean":
      return { tsType, decorator: "IsBoolean" };
    case "Date":
      return { tsType, decorator: "IsDate" };
    case "Record<string, unknown>":
      // JSON/JSONB serbest nesne -> doğrulanabilir primitif dekoratör YOK.
      return { tsType, decorator: null };
    default:
      // Bilinmeyen serbest tip: olduğu gibi kullan; yanlış doğrulama ekleme.
      return { tsType: tsType.length > 0 ? tsType : "unknown", decorator: null };
  }
}

/* ── ValidationRule -> class-validator dekoratörü ──────────────────────────
 * eachOpt verilirse (dizi alanı) sayısal/uzunluk dekoratörlere { each: true }
 * eklenir. Değer parse edilemezse kural sessizce atlanır (throw YOK). */
function mapValidationRule(
  rule: string,
  value: string | undefined,
  eachOpt: string,
): { symbol: string; args: string } | null {
  const withEach = (primary: string) => (eachOpt ? `${primary}, ${eachOpt}` : primary);
  const num = (): number | null => {
    if (value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  switch (rule) {
    case "Min": {
      const n = num();
      return n === null ? null : { symbol: "Min", args: withEach(String(n)) };
    }
    case "Max": {
      const n = num();
      return n === null ? null : { symbol: "Max", args: withEach(String(n)) };
    }
    case "MinLength": {
      const n = num();
      return n === null ? null : { symbol: "MinLength", args: withEach(String(n)) };
    }
    case "MaxLength": {
      const n = num();
      return n === null ? null : { symbol: "MaxLength", args: withEach(String(n)) };
    }
    case "Email":
      return { symbol: "IsEmail", args: eachOpt ? `undefined, ${eachOpt}` : "" };
    case "Url":
      return { symbol: "IsUrl", args: eachOpt ? `undefined, ${eachOpt}` : "" };
    case "Regex":
    case "Pattern": {
      if (value === undefined || value === "") return null;
      return { symbol: "Matches", args: withEach(toRegexLiteral(value)) };
    }
    case "Positive":
      return { symbol: "IsPositive", args: eachOpt };
    case "Negative":
      return { symbol: "IsNegative", args: eachOpt };
    default:
      return null;
  }
}

/** Bir pattern string'ini güvenli RegExp literaline çevirir. Zaten "/.../"
 *  biçimindeyse korunur; değilse "/" kaçışlanıp sarmalanır. */
function toRegexLiteral(pattern: string): string {
  if (pattern.length >= 2 && pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
    return pattern;
  }
  return `/${pattern.replace(/\//g, "\\/")}/`;
}
