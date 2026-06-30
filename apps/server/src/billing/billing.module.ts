import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { SubscriptionRepository } from "./subscription.repository";
import { PolarClient } from "./polar.client";

@Module({
  controllers: [BillingController],
  providers: [BillingService, SubscriptionRepository, PolarClient],
  exports: [BillingService],
})
export class BillingModule {}
