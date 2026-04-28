import { Module, Controller, Post, Body, Req, HttpException, HttpStatus, InternalServerErrorException, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { AxiosResponse } from 'axios';
import { randomUUID } from 'crypto';
import { buildAIConsultSystemPrompt } from './ai-consult-system-prompt.js';

type GigaChatTokenPayload = {
  access_token: string;
  expires_at?: number;
};

class AIConsultDto {
  @ApiPropertyOptional({
    type: String,
    description: 'Необязательно: ID записи дневника для привязки сохранённой консультации (пустая строка = без привязки)',
    example: '2c5ef4be-2d87-4f62-babc-23f984f2be14',
  })
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsOptional()
  @IsString()
  diaryEntryId?: string;

  @ApiProperty({ type: String, description: 'Промпт для AI', example: 'Помоги разобрать мои эмоции в этой ситуации.' })
  @IsString()
  prompt!: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Идентификатор текущей чат-сессии (для контекста сообщений). По умолчанию: default',
    example: 'chat-main',
  })
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsOptional()
  @IsString()
  sessionId?: string;
}

class AIAcceptDto {
  @ApiProperty({ type: String, description: 'ID записи дневника', example: '2c5ef4be-2d87-4f62-babc-23f984f2be14' })
  @IsString()
  diaryEntryId!: string;

  @ApiProperty({ type: String, description: 'ID эмоции из каталога Emotion', example: '8d8aee17-8333-449f-a41d-f58f0af3df13' })
  @IsString()
  emotionId!: string;

  @ApiPropertyOptional({ type: Number, description: 'Уверенность AI (0..1)', example: 0.74 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}

class AIRejectDto {
  @ApiProperty({ type: String, description: 'ID AI-консультации', example: '660fc15b-5f27-4e4c-b8f6-7bf59570ca72' })
  @IsString()
  consultationId!: string;
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
class AIController {
  private cachedToken: { token: string; expiresAtMs: number } | null = null;
  private readonly sessionMemory = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>();

  constructor(@Inject(PrismaService) private prisma: PrismaService, @Inject(ConfigService) private config: ConfigService) {}

  private async getGigaChatAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs - 30_000 > now) {
      return this.cachedToken.token;
    }

    const authUrl = this.config.get<string>('GIGACHAT_AUTH_URL') ?? 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
    const authorizationKey = this.config.get<string>('GIGACHAT_AUTHORIZATION_KEY');
    const scope = this.config.get<string>('GIGACHAT_SCOPE') ?? 'GIGACHAT_API_PERS';
    if (!authorizationKey) {
      throw new InternalServerErrorException('GIGACHAT_AUTHORIZATION_KEY is not configured');
    }

    const form = new URLSearchParams({ scope });
    const tokenResponse = await axios.post<GigaChatTokenPayload>(authUrl, form.toString(), {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${authorizationKey}`,
        RqUID: randomUUID(),
      },
    });

    const token = tokenResponse.data.access_token;
    if (!token) {
      throw new InternalServerErrorException('GigaChat token response does not contain access_token');
    }
    const expiresAtMs = tokenResponse.data.expires_at ?? now + 29 * 60 * 1000;
    this.cachedToken = { token, expiresAtMs };
    return token;
  }

  private getChatCompletionUrls(): string[] {
    const configured = this.config.get<string>('GIGACHAT_API_URL')?.trim();
    const defaults = [
      'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
      'https://gigachat.devices.sberbank.ru/api/v1/chat/completions/',
    ];
    if (!configured) return defaults;

    const normalized = configured.replace(/\/+$/, '');
    if (normalized.endsWith('/api/v1/chat/completions')) {
      return [configured, `${normalized}/`, ...defaults].filter((v, i, a) => a.indexOf(v) === i);
    }
    if (normalized.endsWith('/api/v1')) {
      return [
        `${normalized}/chat/completions`,
        `${normalized}/chat/completions/`,
        configured,
        ...defaults,
      ].filter((v, i, a) => a.indexOf(v) === i);
    }
    return [configured, ...defaults].filter((v, i, a) => a.indexOf(v) === i);
  }

  private getNonEmptyConfig(...keys: string[]): string | undefined {
    for (const key of keys) {
      const value = this.config.get<string>(key);
      if (value && value.trim().length > 0) return value.trim();
    }
    return undefined;
  }

  private buildSessionKey(userId: string, sessionId?: string): string {
    const normalizedSessionId = sessionId?.trim() || 'default';
    return `${userId}:${normalizedSessionId}`;
  }

  private limitText(value: string, max = 1200): string {
    if (value.length <= max) return value;
    return `${value.slice(0, max)}...`;
  }

  private pushSessionMessage(sessionKey: string, role: 'user' | 'assistant', content: string) {
    const memory = this.sessionMemory.get(sessionKey) ?? [];
    memory.push({ role, content: this.limitText(content, 1200) });
    if (memory.length > 20) {
      memory.splice(0, memory.length - 20);
    }
    this.sessionMemory.set(sessionKey, memory);
  }

  private getSessionMessages(sessionKey: string): Array<{ role: 'user' | 'assistant'; content: string }> {
    return this.sessionMemory.get(sessionKey) ?? [];
  }

  private extractAssistantText(payload: any): string {
    const direct = payload?.choices?.[0]?.message?.content;
    if (typeof direct === 'string' && direct.trim().length > 0) return direct;
    return JSON.stringify(payload);
  }

  private isUnknownUserIdArgError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return (
      error.name === 'PrismaClientValidationError' &&
      error.message.includes('Unknown argument `userId`')
    );
  }

  private async countRecentConsultations(userId: string, since: Date): Promise<number> {
    try {
      return await this.prisma.aIConsultation.count({
        where: { userId, createdAt: { gte: since } } as any,
      });
    } catch (error) {
      if (!this.isUnknownUserIdArgError(error)) throw error;

      // Fallback for older Prisma clients/schemas where AIConsultation has no userId column.
      return this.prisma.aIConsultation.count({
        where: {
          createdAt: { gte: since },
          diaryEntry: { alexithymicId: userId },
        } as any,
      });
    }
  }

  private async createConsultationCompat(params: {
    userId: string;
    diaryEntryId: string | null;
    prompt: string;
    response: string;
    modelVersion: string;
  }) {
    const { userId, diaryEntryId, prompt, response, modelVersion } = params;
    try {
      return await this.prisma.aIConsultation.create({
        data: {
          userId,
          diaryEntryId: diaryEntryId ?? undefined,
          prompt,
          response,
          modelVersion,
        } as any,
      });
    } catch (error) {
      if (!this.isUnknownUserIdArgError(error)) throw error;

      // Fallback for older Prisma clients/schemas where AIConsultation has no userId column.
      return this.prisma.aIConsultation.create({
        data: {
          diaryEntryId: diaryEntryId ?? undefined,
          prompt,
          response,
          modelVersion,
        } as any,
      });
    }
  }

  private buildChatMessages(
    prompt: string,
    diaryContext: string,
    sessionMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    compact = false,
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    if (compact) {
      return [
        { role: 'system', content: buildAIConsultSystemPrompt() },
        { role: 'user', content: this.limitText(prompt, 2000) },
      ];
    }
    const shortSession = sessionMessages.slice(-8).map((m) => ({
      role: m.role,
      content: this.limitText(m.content, 800),
    }));
    const systemWithDiary = [
      buildAIConsultSystemPrompt(),
      '',
      'Контекст последних 3 записей дневника:',
      this.limitText(diaryContext, 3000),
    ].join('\n');
    return [
      { role: 'system', content: systemWithDiary },
      ...shortSession,
      { role: 'user', content: this.limitText(prompt, 2000) },
    ];
  }

  private async buildRecentDiaryContext(userId: string): Promise<string> {
    const entries = await this.prisma.diaryEntry.findMany({
      where: { alexithymicId: userId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: {
        createdAt: true,
        situation: true,
        thought: true,
        reaction: true,
        emotion: true,
        behavior: true,
        behaviorAlt: true,
        tags: true,
      },
    });
    if (!entries.length) {
      return 'Последние записи дневника отсутствуют.';
    }
    return entries
      .map((entry, idx) => {
        const date = entry.createdAt.toISOString();
        return [
          `Запись ${idx + 1} (${date}):`,
          `- situation: ${entry.situation ?? '-'}`,
          `- thought: ${entry.thought ?? '-'}`,
          `- reaction: ${entry.reaction ?? '-'}`,
          `- emotion: ${entry.emotion ?? '-'}`,
          `- behavior: ${entry.behavior ?? '-'}`,
          `- behaviorAlt: ${entry.behaviorAlt ?? '-'}`,
          `- tags: ${entry.tags ?? '-'}`,
        ].join('\n');
      })
      .join('\n\n');
  }

  @Post('consult')
  @ApiOperation({
    summary: 'AI консультация через GigaChat',
    description:
      'Модель получает системный промпт рефлексии (без диагноза, JSON: reply, emotions×5 из каталога GET /emotions, suggested_next). ' +
        'Поле diaryEntryId необязательно; лимит запросов считается по пользователю.',
  })
  @ApiBody({ type: AIConsultDto })
  async consult(@Req() req: any, @Body() body: AIConsultDto) {
    const rawDiaryEntryId = typeof body.diaryEntryId === 'string' ? body.diaryEntryId.trim() : '';
    let diaryEntryId: string | null = null;
    if (rawDiaryEntryId) {
      const entry = await this.prisma.diaryEntry.findFirst({
        where: { id: rawDiaryEntryId, alexithymicId: req.user.sub, isDeleted: false },
        select: { id: true },
      });
      diaryEntryId = entry?.id ?? null;
    }

    const since = new Date(Date.now() - 60 * 60 * 1000);
    const cnt = await this.countRecentConsultations(req.user.sub, since);
    if (cnt >= 10) throw new HttpException('Limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    const sessionKey = this.buildSessionKey(req.user.sub, body.sessionId);
    const sessionMessages = this.getSessionMessages(sessionKey);
    const diaryContext = await this.buildRecentDiaryContext(req.user.sub);
    const model = this.getNonEmptyConfig('GIGACHAT_MODEL', 'AI_MODEL_VERSION') ?? 'GigaChat';
    const accessToken = await this.getGigaChatAccessToken();
    let response: AxiosResponse<any> | null = null;
    let lastError: unknown;
    const failed: string[] = [];
    const chatUrls = this.getChatCompletionUrls();
    for (const chatUrl of chatUrls) {
      const messageVariants = [
        this.buildChatMessages(body.prompt, diaryContext, sessionMessages, false),
        this.buildChatMessages(body.prompt, diaryContext, sessionMessages, true),
      ];
      try {
        for (let i = 0; i < messageVariants.length; i++) {
          try {
            response = await axios.post(chatUrl, {
              model,
              messages: messageVariants[i],
              temperature: 0.7,
            }, {
              headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
            });
            break;
          } catch (inner) {
            if (!axios.isAxiosError(inner)) throw inner;
            const status = inner.response?.status ?? 'NO_RESPONSE';
            failed.push(`${chatUrl}[variant:${i}] -> ${status}`);
            if (inner.response?.status === 422 && i === 0) {
              continue;
            }
            if (inner.response?.status === 404) {
              throw inner;
            }
            throw inner;
          }
        }
        if (!response) throw new HttpException('No response from chat variants', HttpStatus.BAD_GATEWAY);
        break;
      } catch (e) {
        lastError = e;
        if (!axios.isAxiosError(e)) throw e;
        failed.push(`${chatUrl} -> ${e.response?.status ?? 'NO_RESPONSE'}`);
        if (e.response?.status !== 404) throw e;
      }
    }
    if (!response) {
      if (axios.isAxiosError(lastError) && lastError.response?.status === 404) {
        throw new HttpException(
          `GigaChat endpoint/model not found (model=${model}). Tried: ${failed.join(', ')}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      throw lastError;
    }

    const text = JSON.stringify(response.data);
    const assistantText = this.extractAssistantText(response.data);
    this.pushSessionMessage(sessionKey, 'user', body.prompt);
    this.pushSessionMessage(sessionKey, 'assistant', assistantText);
    const saved = await this.createConsultationCompat({
      userId: req.user.sub,
      diaryEntryId,
      prompt: body.prompt,
      response: text,
      modelVersion: model,
    });
    return { consultationId: saved.id, result: response.data };
  }

  @Post('accept')
  @ApiOperation({ summary: 'Принять эмоцию из AI' })
  @ApiBody({ type: AIAcceptDto })
  accept(@Body() body: AIAcceptDto) { return this.prisma.diaryEntryEmotion.create({ data: { diaryEntryId: body.diaryEntryId, emotionId: body.emotionId, confidence: body.confidence, source: 'AI' } }); }

  @Post('reject')
  @ApiOperation({ summary: 'Отклонить AI консультацию' })
  @ApiBody({ type: AIRejectDto })
  reject(@Req() req: any, @Body() body: AIRejectDto) { return this.prisma.auditLog.create({ data: { userId: req.user.sub, eventType: 'AI_REJECTED', description: `consultationId=${body.consultationId}` } }); }
}
@Module({ controllers: [AIController] })
export class AIModule {}
