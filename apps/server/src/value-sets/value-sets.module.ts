import { Module } from "@nestjs/common";
import { ValueSetsController } from "./value-sets.controller";
import { ValueSetsService } from "./value-sets.service";

@Module({
  controllers: [ValueSetsController],
  providers: [ValueSetsService],
  exports: [ValueSetsService],
})
export class ValueSetsModule {}
