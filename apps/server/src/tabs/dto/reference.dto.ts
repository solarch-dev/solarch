import { createZodDto } from "nestjs-zod";
import { ReferenceSchema } from "../schemas/tab.schema";

export class ReferenceDto extends createZodDto(ReferenceSchema) {}
