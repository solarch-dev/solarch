import { Module } from "@nestjs/common";
import { RulesEngine } from "./rules.engine";
import { RulesController } from "./rules.controller";
import { ReviewController } from "./review.controller";
import { CircularDependencyChecker } from "./checkers/circular-dependency.checker";
import { TypeMismatchChecker } from "./checkers/type-mismatch.checker";
import { EmptySchemaChecker } from "./checkers/empty-schema.checker";

@Module({
  controllers: [RulesController, ReviewController],
  providers: [RulesEngine, CircularDependencyChecker, TypeMismatchChecker, EmptySchemaChecker],
  exports: [RulesEngine],
})
export class RulesModule {}
