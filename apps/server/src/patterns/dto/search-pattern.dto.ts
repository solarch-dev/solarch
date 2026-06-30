import { createZodDto } from "nestjs-zod";
import { SearchPatternSchema } from "../schemas/pattern.schema";

export class SearchPatternDto extends createZodDto(SearchPatternSchema) {}
