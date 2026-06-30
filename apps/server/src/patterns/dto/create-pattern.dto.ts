import { createZodDto } from "nestjs-zod";
import { CreatePatternSchema } from "../schemas/pattern.schema";

export class CreatePatternDto extends createZodDto(CreatePatternSchema) {}
