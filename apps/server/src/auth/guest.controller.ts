import { Controller, HttpCode, Post, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Public } from "./public.decorator";
import { ok } from "../common/envelope";
import { guestModeEnabled, mintGuestToken } from "./guest-token";

@ApiTags("Auth")
@Controller("auth")
export class GuestController {
  /** Login'siz deneme bileti. Frontend ilk ziyarette çağırır, localStorage'da tutar.
   *  Anonim spam'e karşı IP başına throttle. 20/dk: mobil operatör / ofis NAT'ı
   *  arkasında onlarca gerçek ziyaretçi aynı IP'den gelir — 5/dk onları login'e
   *  düşürüyordu; bilet basmak ucuz, asıl koruma HMAC imzası. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post("guest")
  @HttpCode(201)
  @ApiOperation({
    summary: "Mint a guest ticket",
    description:
      "Signed guest ticket (30 days) for visitors without login. The ticket is sent via the `X-Guest-Token` header; a guest can draw 1 project and AI is disabled.",
  })
  @ApiResponse({ status: 201, description: "`data: { token, guestId, expiresAt }`." })
  @ApiResponse({ status: 503, description: "`ERR_GUEST_DISABLED` — GUEST_TOKEN_SECRET is not set." })
  mint() {
    if (!guestModeEnabled()) {
      throw new ServiceUnavailableException({
        code: "ERR_GUEST_DISABLED",
        message: "Guest mode is not enabled.",
      });
    }
    return ok(mintGuestToken());
  }
}
