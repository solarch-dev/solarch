import { Module } from "@nestjs/common";
import { NodeTypesController } from "./node-types.controller";
import { NodeTypesService } from "./node-types.service";
import { RulesModule } from "../rules/rules.module";

@Module({
  imports: [RulesModule],
  controllers: [NodeTypesController],
  providers: [NodeTypesService],
})
export class NodeTypesModule {}
