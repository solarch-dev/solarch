import { Injectable, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
