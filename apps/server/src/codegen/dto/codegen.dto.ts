import { z } from "zod";
import { createZodDto } from "nestjs-zod";

/** POST /projects/:projectId/codegen body. target optional (default nestjs). */
export const CodegenRequestSchema = z
  .object({
    target: z.enum(["nestjs"]).default("nestjs"),
  })
  .strict();

export type CodegenRequest = z.infer<typeof CodegenRequestSchema>;

export class CodegenRequestDto extends createZodDto(CodegenRequestSchema) {}
