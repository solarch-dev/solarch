import type { GeneratedFile, NodeEmitter } from "../../types";
import { propsOf, type CodeNode } from "../../ir";
import { camelCase, filePathFor, importPathOf, pascalCase, relativeImportPath } from "../../naming";
import { ImportCollector } from "../../imports";
import { countSurgicalMarkers } from "../../surgical";
import { sqlTypeToTs } from "./sql-type-map";

/* ────────────────────────────────────────────────────────────────────────
 * dto.emitter.ts — DTONode -> <feature>/dto/<d>.dto.ts (class-validator).
 *
 * Mirrors enum.emitter.ts (canonical reference) exactly:
 *   - named `export const emitDto: NodeEmitter`; no default export.
 *   - PURE function (node, ctx) -> GeneratedFile[]; no I/O, no throw.
 *   - Path always via filePathFor(node, ctx.graph).
 *   - imports via ImportCollector (manual "import" FORBIDDEN).
 *   - DETERMINISTIC: fields in given ORDER, decorators in fixed order.
 *   - Content ends with single "\n".
 *
 * DTO BODY is NONE (pure data carrier) -> no surgical markers -> 0.
 *
 * Each Field -> property + class-validator decorators:
 *   ValidationRules:  Min->@Min, Max->@Max, MinLength->@MinLength,
 *                     MaxLength->@MaxLength, Email->@IsEmail, Url->@IsUrl,
 *                     Regex/Pattern->@Matches, Positive->@IsPositive,
 *                     Negative->@IsNegative.
 *   DataType:         string->@IsString, number/int/float->@IsNumber,
 *                     boolean->@IsBoolean, date->@IsDate.
 *   IsRequired=false -> @IsOptional + "?" (optional property).
 *   IsArray=true     -> @IsArray + "[]" ({ each: true } on each decorator).
 *   NestedDTORef     -> @ValidateNested + @Type(() => X) (class-transformer) + import.
 *   EnumRef          -> @IsEnum(X) + import.
 * ──────────────────────────────────────────────────────────────────────── */

export const emitDto: NodeEmitter = (node: CodeNode, ctx): GeneratedFile[] => {
  const props = propsOf<"DTO">(node);
  const className = pascalCase(node.name);
  const selfPath = filePathFor(node, ctx.graph);

  const imports = new ImportCollector();
  // class-validator symbols collected in one slot; render() sorts + dedupes.
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

    // Type reference for @ApiProperty: enum -> `enum: X`, nested DTO -> `type: () => X`.
    // Name written even when unresolved (resolveRef null); consistent with @IsEnum/@Type.
    let apiEnumName: string | null = null;
    let apiNestedName: string | null = null;

    if (field.Description) lines.push(`  /** ${field.Description} */`);

    // ── 1) Optionality ──
    if (optional) {
      validator("IsOptional");
      lines.push("  @IsOptional()");
    }

    // ── 2) Array ──
    if (isArray) {
      validator("IsArray");
      lines.push("  @IsArray()");
    }

    // ── 3) Type decorator (EnumRef > NestedDTORef > DataType) ──
    let tsType: string;
    if (field.EnumRef) {
      const enumNode = ctx.graph.resolveRef("Enum", field.EnumRef);
      // Class name from RESOLVED node (matches generated enum file export);
      // else derived from ref string.
      const enumName = pascalCase(enumNode ? enumNode.name : field.EnumRef);
      validator("IsEnum");
      lines.push(`  @IsEnum(${enumName}${eachOpt ? `, ${eachOpt}` : ""})`);
      tsType = enumName;
      apiEnumName = enumName;
      if (enumNode) {
        // feature layout: path via filePathFor(enumNode) (common/enums/... or
        // <feature>/enums/...); relative path derived from selfPath.
        imports.add(enumName, importPathOf(relativeImportPath(selfPath, filePathFor(enumNode, ctx.graph))));
      } else {
        // Missing ref -> skip import (resolveRef null); type still written.
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
        // SELF-REF (tree/recursive, e.g. children: CategoryResponse[]): class already
        // defined in THIS file -> do NOT self-import (self-import TS error).
        // Else nested DTO path resolved by feature layout (same feature ->
        // "./<base>.dto", else "../<other-feature>/dto/<base>.dto").
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
        // Free type (unknown identifier) returned raw -> resolve to generated DTO/Model/Enum
        // class: use canonical name (pascalCase) + import. Else raw graph string
        // (e.g. "ComplaintResponseDTO") causes TS2304.
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

    // ── 4) ValidationRules (schema order) ──
    for (const rule of field.ValidationRules ?? []) {
      const dec = mapValidationRule(rule.Rule, rule.Value, eachOpt);
      if (!dec) continue;
      validator(dec.symbol);
      lines.push(`  @${dec.symbol}(${dec.args})`);
    }

    // ── 5) @ApiProperty (self-documenting generated app) ──
    // Each field carries an OpenAPI property descriptor (same key order as
    // @ApiResponse/@ApiOperation in controller.emitter: required, description,
    // type/enum, isArray). `required` reflects IsRequired; enum field references
    // enum class as runtime VALUE; nested DTO uses forward-ref-safe `type: () => X`
    // thunk; array field gets isArray:true.
    imports.add("ApiProperty", "@nestjs/swagger");
    const apiParts: string[] = [`required: ${!optional}`];
    if (field.Description) apiParts.push(`description: ${JSON.stringify(field.Description)}`);
    if (apiEnumName) apiParts.push(`enum: ${apiEnumName}`);
    else if (apiNestedName) apiParts.push(`type: () => ${apiNestedName}`);
    if (isArray) apiParts.push(`isArray: true`);
    lines.push(`  @ApiProperty({ ${apiParts.join(", ")} })`);

    // ── 6) Property line ──
    // Required (no initializer) fields get definite-assignment "!" so strict:true
    // (strictPropertyInitialization) compiles without TS2564 — DTO standard.
    // Optional "?" fields untouched.
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

/* ── DataType -> (TS type, class-validator decorator) ─────────────────────
 * DataType is a free string; common synonyms normalized (case-insensitive).
 * Unknown type -> tsType as pascal'd reference, no primitive decorator (avoid
 * wrong validation). */
function mapDataType(dataType: string): { tsType: string; decorator: string | null } {
  // TS type from sql-type-map SINGLE SOURCE (consistent with entity/Model); DTO
  // is free type so unknown passes AS-IS (unknownAsString=false).
  // Decorator (class-validator) mapping is DTO-specific.
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
      // JSON/JSONB free object -> no validatable primitive decorator.
      return { tsType, decorator: null };
    default:
      // Unknown free type: use as-is; do not add wrong validation.
      return { tsType: tsType.length > 0 ? tsType : "unknown", decorator: null };
  }
}

/* ── ValidationRule -> class-validator decorator ──────────────────────────
 * When eachOpt given (array field) append { each: true } to numeric/length
 * decorators. Rule skipped silently when value unparseable (no throw). */
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

/** Convert a pattern string to a safe RegExp literal. If already "/.../"
 *  form keep it; else escape "/" and wrap. */
function toRegexLiteral(pattern: string): string {
  if (pattern.length >= 2 && pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
    return pattern;
  }
  return `/${pattern.replace(/\//g, "\\/")}/`;
}
