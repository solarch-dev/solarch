import { createZodDto } from "nestjs-zod";
import { UpdateTabSchema } from "../schemas/tab.schema";

export class UpdateTabDto extends createZodDto(UpdateTabSchema) {}
