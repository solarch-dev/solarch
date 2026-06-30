import { Module } from "@nestjs/common";
import { EdgeTypesController } from "./edge-types.controller";
import { EdgeTypesService } from "./edge-types.service";
import { RulesModule } from "../rules/rules.module";

@Module({
  imports: [RulesModule],
  controllers: [EdgeTypesController],
  providers: [EdgeTypesService],
})
export class EdgeTypesModule {}
