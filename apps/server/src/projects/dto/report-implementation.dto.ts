import { z } from "zod";
import { createZodDto } from "nestjs-zod";

/** CLI `status --report` / VS Code eklentisinin gönderdiği implementasyon
 *  sayaçları. Yapısal mutasyon değildir — graphRevision'a dokunmaz. */
const ImplementationEntrySchema = z
  .object({
    nodeId: z.string().uuid(),
    /** İşaretli üye toplamı (surgical marker sayısı). */
    total: z.number().int().nonnegative(),
    filled: z.number().int().nonnegative(),
    /** İmzaya göre AI'ın doldurduğu üye sayısı. */
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
