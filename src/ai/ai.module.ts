// ai.module.ts
import { DIARY_RATED_EMOTIONS_FOR_VALIDATION } from '../diary-entries/diary-rated-emotions.constants.js';
import { Module, Controller, Post, Body, Req, HttpException, HttpStatus, InternalServerErrorException, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { AxiosResponse } from 'axios';
import { randomUUID } from 'crypto';
import {
  AI_REPLY_SYSTEM_PROMPT,
  AI_EMOTION_SYSTEM_PROMPT,
  buildDiaryContextPrompt,
  buildSessionContextPrompt,
} from './ai-consult-system-prompt.js';

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

  // ------------------- НОВЫЕ МЕТОДЫ ДЛЯ ДВУХСТАДИЙНОГО ВЫЗОВА -------------------

  private buildReplyMessages(
    prompt: string,
    diaryContext: string,
    sessionMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const systemContent = [
      AI_REPLY_SYSTEM_PROMPT,
      buildDiaryContextPrompt(diaryContext),
      buildSessionContextPrompt(sessionMessages.slice(-8)),
    ].join('\n\n');

    return [
      { role: 'system', content: this.limitText(systemContent, 4000) },
      { role: 'user', content: this.limitText(prompt, 2000) },
    ];
  }

  private buildEmotionMessages(prompt: string): Array<{ role: 'system' | 'user'; content: string }> {
    return [
      { role: 'system', content: AI_EMOTION_SYSTEM_PROMPT },
      { role: 'user', content: this.limitText(prompt, 2000) },
    ];
  }

 private async callGigaChatWithRetry(
  messages: Array<{ role: string; content: string }>,
  model: string,
  accessToken: string,
  temperature: number, // ДОБАВЛЕН ПАРАМЕТР
): Promise<string> {
  const chatUrls = this.getChatCompletionUrls();
  let lastError: unknown;
  const failed: string[] = [];

  for (const chatUrl of chatUrls) {
    try {
      const response = await axios.post(
        chatUrl,
        { model, messages, temperature }, // ИСПОЛЬЗУЕМ ПЕРЕДАННЫЙ temperature
        { headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } },
      );
      const content = response.data?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) {
        return content;
      }
      throw new Error('Empty or invalid response content');
    } catch (e) {
      lastError = e;
      if (axios.isAxiosError(e)) {
        failed.push(`${chatUrl} -> ${e.response?.status ?? 'NO_RESPONSE'}`);
        if (e.response?.status !== 404) throw e;
      } else {
        throw e;
      }
    }
  }
  if (axios.isAxiosError(lastError) && lastError.response?.status === 404) {
    throw new HttpException(
      `GigaChat endpoint/model not found (model=${model}). Tried: ${failed.join(', ')}`,
      HttpStatus.BAD_GATEWAY,
    );
  }
  throw lastError;
}

// НОВЫЙ МЕТОД для вызова эмоций с retry и валидацией
private async callEmotionWithRetry(
  messages: Array<{ role: string; content: string }>,
  model: string,
  accessToken: string,
): Promise<Array<{ name: string; probability: number }>> {
  const MAX_RETRIES = 1; // Одна попытка повторения
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Эмоции всегда с temperature = 0
      const emotionResponse = await this.callGigaChatWithRetry(
        messages, 
        model, 
        accessToken, 
        0 // температура 0 для эмоций
      );
      
      const emotions = this.parseEmotionsFromReply(emotionResponse);
      
      // Валидация: проверяем, что все эмоции из разрешенного списка
      const validEmotions = this.validateEmotions(emotions);
      
      if (validEmotions.length === 5) {
        // Все эмоции валидны
        return validEmotions;
      }
      
      // Если эмоций меньше 5 или есть невалидные, пробуем повторить
      if (attempt < MAX_RETRIES) {
        console.warn(`Invalid emotions detected (got ${validEmotions.length}/5), retrying...`);
        continue; // Повторяем запрос
      }
      
      // Если это последняя попытка, возвращаем то, что есть
      return validEmotions;
      
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        console.warn(`Emotion call failed (attempt ${attempt + 1}), retrying...`, error);
        continue;
      }
      throw error;
    }
  }
  
  throw lastError;
}


  private parseEmotionsFromReply(replyContent: string): Array<{ name: string; probability: number }> {
    try {
      // Ищем JSON-блок в ответе (на случай, если модель добавила лишний текст)
      const jsonMatch = replyContent.match(/\{[\s\S]*"emotions"[\s\S]*\}/);
      if (!jsonMatch) return [];
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed?.emotions)) return [];
      return parsed.emotions
        .filter((e: any) => typeof e.name === 'string' && typeof e.probability === 'number')
        .slice(0, 5);
    } catch {
      return [];
    }
  }


private isSafetyRefusal(text: string): boolean {
  const normalized = text.toLowerCase();

  return (
    normalized.includes('временно ограничены') ||
    normalized.includes('связанные с чувствительными темами') ||
    normalized.includes('не обладает собственным мнением') ||
    normalized.includes('может содержаться неточная или ошибочная информация')
  );
}
// НОВЫЙ МЕТОД для валидации эмоций из разрешенного списка
private validateEmotions(
  emotions: Array<{ name: string; probability: number }>
): Array<{ name: string; probability: number }> {

  return emotions.filter(emotion => 
    DIARY_RATED_EMOTIONS_FOR_VALIDATION.includes(emotion.name) &&
    typeof emotion.probability === 'number' &&
    emotion.probability >= 0 &&
    emotion.probability <= 1
  ).slice(0, 5);
}

  private async buildRecentDiaryContext(userId: string): Promise<string> {
    const entries = await this.prisma.diaryEntry.findMany({
      where: { alexithymicId: userId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      take: 5,
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

  private getConsultLimitSettings(): { maxRequests: number; windowMinutes: number } {
    const rawMaxRequests = this.config.get<string>('AI_CONSULT_LIMIT_PER_WINDOW') ?? this.config.get<string>('AI_CONSULT_LIMIT_PER_HOUR');
    const rawWindowMinutes = this.config.get<string>('AI_CONSULT_LIMIT_WINDOW_MINUTES') ?? '60';

    const parsedMaxRequests = parseInt(rawMaxRequests ?? '', 10);
    const parsedWindowMinutes = parseInt(rawWindowMinutes, 10);

    const maxRequests = Number.isFinite(parsedMaxRequests) && parsedMaxRequests > 0 ? parsedMaxRequests : 0;
    const windowMinutes = Number.isFinite(parsedWindowMinutes) && parsedWindowMinutes > 0 ? parsedWindowMinutes : 60;

    return { maxRequests, windowMinutes };
  }

  // ------------------- ОСНОВНОЙ ЭНДПОИНТ CONSULT (ДВУХСТАДИЙНЫЙ) -------------------

  

// ОБНОВЛЕННЫЙ ОСНОВНОЙ МЕТОД consult
// ОБНОВЛЕННЫЙ ОСНОВНОЙ МЕТОД consult
@Post('consult')
@ApiOperation({
  summary: 'AI консультация через GigaChat (двухстадийная: reply + эмоции)',
  description:
    'Сначала генерируется рефлексивный ответ (обычный текст). Затем на основе того же текста определяются 5 эмоций с вероятностями. ' +
    'Поле diaryEntryId необязательно; лимит запросов считается по пользователю.',
})
@ApiBody({ type: AIConsultDto })
async consult(@Req() req: any, @Body() body: AIConsultDto) {
  // Проверка привязки к дневнику
  const rawDiaryEntryId = typeof body.diaryEntryId === 'string' ? body.diaryEntryId.trim() : '';
  let diaryEntryId: string | null = null;
  if (rawDiaryEntryId) {
    const entry = await this.prisma.diaryEntry.findFirst({
      where: { id: rawDiaryEntryId, alexithymicId: req.user.sub, isDeleted: false },
      select: { id: true },
    });
    diaryEntryId = entry?.id ?? null;
  }

  // Лимиты
  const { maxRequests, windowMinutes } = this.getConsultLimitSettings();
  if (maxRequests > 0) {
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);
    const cnt = await this.countRecentConsultations(req.user.sub, since);
    if (cnt >= maxRequests) {
      throw new HttpException('Limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  const sessionId = body.sessionId?.trim() || 'default';
  const sessionKey = this.buildSessionKey(req.user.sub, sessionId);
  const sessionMessages = this.getSessionMessages(sessionKey);
  const diaryContext = await this.buildRecentDiaryContext(req.user.sub);
  const model = this.getNonEmptyConfig('GIGACHAT_MODEL', 'AI_MODEL_VERSION') ?? 'GigaChat';
  const accessToken = await this.getGigaChatAccessToken();

  // ----- ЭТАП 1: Генерация reply (текст) с temperature = 0.7 -----
  const replyMessages = this.buildReplyMessages(body.prompt, diaryContext, sessionMessages);
  let assistantReply: string | undefined;
  let fullGigaChatResponse: any = null;
  
  try {
    // Вызываем GigaChat и сохраняем полный ответ
    const chatUrls = this.getChatCompletionUrls();
    let lastError: unknown;
    
    for (const chatUrl of chatUrls) {
      try {
        const response = await axios.post(
          chatUrl,
          { 
            model, 
            messages: replyMessages, 
            temperature: 0.7 
          },
          { 
            headers: { 
              Accept: 'application/json', 
              Authorization: `Bearer ${accessToken}` 
            } 
          },
        );
        
        fullGigaChatResponse = response.data;
        assistantReply = response.data?.choices?.[0]?.message?.content;
        
        if (typeof assistantReply === 'string' && assistantReply.trim()) {
          break;
        }
        throw new Error('Empty or invalid response content');
      } catch (e) {
        lastError = e;
        if (axios.isAxiosError(e) && e.response?.status !== 404) throw e;
      }
    }
    
    if (!assistantReply?.trim()) throw lastError;

    if (this.isSafetyRefusal(assistantReply)) {
      return {
        reply:
          'Я не могу обсуждать эту тему. Если вам сейчас тяжело, можно обратиться к психологу, близким людям или в службу поддержки: 8-800-333-44-34.',
        emotions: [],
        suggested_next: [
        ],
      };
    }
    
  } catch (error) {
    console.error('Reply generation failed:', error);
    throw new HttpException('Failed to generate AI reply', HttpStatus.INTERNAL_SERVER_ERROR);
  }

  // Парсим JSON из ответа ассистента (если он вернул JSON с полями reply, emotions, suggested_next)
  let parsedReply: any = null;
  let replyText = assistantReply;
  let emotions: Array<{ name: string; probability: number }> = [];
  let suggestedNext: string[] = [];
  
  try {
    // Пытаемся извлечь JSON из ответа
    const jsonMatch = assistantReply.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsedReply = JSON.parse(jsonMatch[0]);
      if (parsedReply.reply) {
        replyText = parsedReply.reply;
      }
      if (Array.isArray(parsedReply.emotions)) {
        emotions = parsedReply.emotions;
      }
      if (Array.isArray(parsedReply.suggested_next)) {
        suggestedNext = parsedReply.suggested_next;
      }
    }
  } catch (error) {
    console.warn('Failed to parse assistant reply as JSON, using as plain text');
  }

  // Если эмоции не были получены из первого ответа, делаем второй запрос
  if (emotions.length === 0) {
    try {
      const emotionMessages = this.buildEmotionMessages(body.prompt);
      emotions = await this.callEmotionWithRetry(emotionMessages, model, accessToken);
    } catch (error) {
      console.error('Emotion classification failed after retries:', error);
    }
  }

  // Сохраняем историю диалога (используем replyText для истории)
  this.pushSessionMessage(sessionKey, 'user', body.prompt);
  this.pushSessionMessage(sessionKey, 'assistant', replyText);

  // Формируем ответ для сохранения в БД
  const fullResponsePayload = {
    reply: replyText,
    emotions,
    suggested_next: suggestedNext
  };
  
  const saved = await this.createConsultationCompat({
    userId: req.user.sub,
    diaryEntryId,
    prompt: body.prompt,
    response: JSON.stringify(fullResponsePayload),
    modelVersion: model,
  });

  // Возвращаем ответ в нужном формате (одно поле result — без дублирования assistantReply)
  return {
    consultationId: saved.id,
    sessionId,
    result: JSON.stringify(fullResponsePayload),
  };
}
  @Post('accept')
  @ApiOperation({ summary: 'Принять эмоцию из AI' })
  @ApiBody({ type: AIAcceptDto })
  accept(@Body() body: AIAcceptDto) {
    return this.prisma.diaryEntryEmotion.create({
      data: {
        diaryEntryId: body.diaryEntryId,
        emotionId: body.emotionId,
        confidence: body.confidence,
        source: 'AI',
      },
    });
  }

  @Post('reject')
  @ApiOperation({ summary: 'Отклонить AI консультацию' })
  @ApiBody({ type: AIRejectDto })
  reject(@Req() req: any, @Body() body: AIRejectDto) {
    return this.prisma.auditLog.create({
      data: {
        userId: req.user.sub,
        eventType: 'AI_REJECTED',
        description: `consultationId=${body.consultationId}`,
      },
    });
  }
}

@Module({ controllers: [AIController] })
export class AIModule {}