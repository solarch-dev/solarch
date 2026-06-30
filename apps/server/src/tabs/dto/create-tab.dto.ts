import { createZodDto } from "nestjs-zod";
import { CreateTabSchema } from "../schemas/tab.schema";

export class CreateTabDto extends createZodDto(CreateTabSchema) {}
