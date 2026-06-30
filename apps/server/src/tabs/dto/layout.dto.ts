import { createZodDto } from "nestjs-zod";
import { LayoutSchema } from "../schemas/tab.schema";

export class LayoutDto extends createZodDto(LayoutSchema) {}
