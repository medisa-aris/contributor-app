import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { PERMISSIONS } from '@bara/shared';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';

interface ProviderStatus {
  name: string;
  configured: boolean;
  model: string | null;
  baseUrl: string | null;
  isDefault: boolean;
}

/** Ringkasan konfigurasi provider AI - kredensial tidak pernah dikembalikan. */
@ApiTags('admin-providers')
@Controller('admin/providers')
export class ProvidersController {
  constructor(private readonly config: ConfigService) {}

  @RequirePermission(PERMISSIONS.providersHealthRead)
  @Get()
  list(): { defaultProvider: string; providers: ProviderStatus[] } {
    const defaultProvider = this.config.get<string>('app.aiProvider') ?? 'openrouter';
    const model = this.config.get<string>('app.aiModel') ?? null;
    const baseUrl = this.config.get<string>('app.aiBaseUrl') ?? null;
    const openrouter = Boolean(this.config.get<string | null>('app.openrouterApiKey'));
    const ollamaUrl = process.env.OLLAMA_BASE_URL ?? null;
    const providers: ProviderStatus[] = [
      { name: 'openrouter', configured: openrouter, model, baseUrl, isDefault: defaultProvider === 'openrouter' },
      {
        name: 'ollama',
        configured: Boolean(ollamaUrl),
        model: null,
        baseUrl: ollamaUrl,
        isDefault: defaultProvider === 'ollama',
      },
      {
        name: 'openai',
        configured: Boolean(process.env.OPENAI_API_KEY),
        model: null,
        baseUrl: 'https://api.openai.com/v1',
        isDefault: defaultProvider === 'openai',
      },
      {
        name: 'anthropic',
        configured: Boolean(process.env.ANTHROPIC_API_KEY),
        model: null,
        baseUrl: 'https://api.anthropic.com',
        isDefault: defaultProvider === 'anthropic',
      },
    ];
    return { defaultProvider, providers };
  }
}
