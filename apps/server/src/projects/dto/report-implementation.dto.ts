import { z } from "zod";
import { createZodDto } from "nestjs-zod";

/** Implementation counters sent by CLI `status --report` / VS Code extension.
 *  Not a structural mutation — does not touch graphRevision. */
const ImplementationEntrySchema = z
  .object({
    nodeId: z.string().uuid(),
    /** Total marked members (surgical marker count). */
    total: z.number().int().nonnegative(),
    filled: z.number().int().nonnegative(),
    /** Members filled by AI by signature. */
    filledAi: z.number().int().nonnegative(),
  })
  .strict()
  .refine((e) => e.filled <= e.total && e.filledAi <= e.filled, {
    message: "filled <= total and filledAi <= filled must hold.",
  });

export const ReportImplementationSchema = z
  .object({
    entries: z.array(ImplementationEntrySchema).max(500),
  })
  .strict();

export class ReportImplementationDto extends createZodDto(ReportImplementationSchema) {}
