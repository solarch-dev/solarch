import { Module } from "@nestjs/common";
import { EmbeddingsService } from "./embeddings.service";
import { EMBEDDINGS } from "./embeddings.types";

@Module({
  providers: [EmbeddingsService, { provide: EMBEDDINGS, useExisting: EmbeddingsService }],
  exports: [EMBEDDINGS, EmbeddingsService],
})
export class EmbeddingsModule {}
