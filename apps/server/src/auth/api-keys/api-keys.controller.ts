import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { ok } from "../../common/envelope";
import { CurrentAuth } from "../current-auth.decorator";
import type { AuthContext } from "../auth.types";
import { ApiKeysService } from "./api-keys.service";

const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(64).describe("Purpose of the key (e.g. 'CI pipeline', 'laptop')"),
});
class CreateApiKeyDto extends createZodDto(CreateApiKeySchema) {}

/** API key management for terminal clients such as CLI/MCP. */
@ApiTags("API Keys")
@Controller("api-keys")
export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: "Create new API key",
    description:
      "Personal access key for the CLI (`solarch login`). The plaintext key is returned only in this response — " +
      "the server stores only its SHA-256 hash, so it can never be shown again.",
  })
  @ApiResponse({ status: 201, description: "`data: { key, id, name, prefix, createdAt }`." })
  async create(@Body() body: CreateApiKeyDto, @CurrentAuth() auth: AuthContext) {
    const { key, record } = await this.service.create(auth.userId, body.name);
    return ok({ key, id: record.id, name: record.name, prefix: record.prefix, createdAt: record.createdAt });
  }

  @Get()
  @ApiOperation({ summary: "List my keys", description: "Plaintext key is not returned; prefix + metadata." })
  @ApiResponse({ status: 200, description: "`data: { keys: [...] }`." })
  async list(@CurrentAuth() auth: AuthContext) {
    const keys = await this.service.list(auth.userId);
    return ok({ keys });
  }

  @Delete(":keyId")
  @ApiOperation({ summary: "Revoke key", description: "The key is invalidated immediately." })
  @ApiResponse({ status: 200, description: "`data: { deleted: true }`." })
  @ApiResponse({ status: 404, description: "`ERR_API_KEY_NOT_FOUND`." })
  async remove(@Param("keyId") keyId: string, @CurrentAuth() auth: AuthContext) {
    const deleted = await this.service.remove(auth.userId, keyId);
    if (!deleted) {
      throw new NotFoundException({ code: "ERR_API_KEY_NOT_FOUND", message: "API key not found." });
    }
    return ok({ deleted: true });
  }
}
