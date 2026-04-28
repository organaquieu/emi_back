import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Body,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ApiBearerAuth, ApiBody, ApiExtraModels, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsEnum, IsIn, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { replaceUserRatedEmotionsForEntry } from './diary-entry-emotions.sync.js';
import {
  DIARY_RATED_EMOTIONS_FOR_VALIDATION,
  DIARY_RATED_EMOTIONS_SWAGGER_DESCRIPTION,
} from './diary-rated-emotions.constants.js';
import {
  DIARY_ENTRY_TAGS_FOR_VALIDATION,
  DIARY_ENTRY_TAGS_SWAGGER_DESCRIPTION,
  serializeDiaryEntryTags,
} from './diary-entry-tags.constants.js';

const DIARY_ENTRY_DETAIL_INCLUDE = {
  emotions: { include: { emotion: true } },
} satisfies Prisma.DiaryEntryInclude;

enum DiaryVisibilityDto {
  PRIVATE = 'PRIVATE',
  THERAPIST = 'THERAPIST',
}

class DiaryEmotionPickDto {
  @ApiProperty({
    description: 'Название эмоции из справочника',
    enum: DIARY_RATED_EMOTIONS_FOR_VALIDATION,
    example: 'Тревога',
  })
  @IsString()
  @IsIn(DIARY_RATED_EMOTIONS_FOR_VALIDATION)
  name!: string;

  @ApiProperty({ type: Number, minimum: 0, maximum: 100, description: 'Процент (0–100)', example: 45 })
  @Transform(({ value }) => (value === null || value === undefined || value === '' ? value : Number(value)))
  @IsNumber()
  @Min(0)
  @Max(100)
  percent!: number;
}

function scalarEmotionSummary(picks?: { name: string; percent: number }[]): string | null {
  if (!picks?.length) return null;
  return picks.map((e) => `${e.name} ${e.percent}%`).join(', ');
}

/** Порядок полей: ситуация → мысль → реакция → эмоции (массив) → поведение → альтернативное поведение → теги → видимость */
class CreateDiaryEntryDto {
  @ApiPropertyOptional({ type: String, description: 'Ситуация', example: 'Разговор с начальником на работе' })
  @IsOptional()
  @IsString()
  situation?: string;

  @ApiPropertyOptional({ type: String, description: 'Мысль', example: 'Я недостаточно стараюсь' })
  @IsOptional()
  @IsString()
  thought?: string;

  @ApiPropertyOptional({ type: String, description: 'Реакция', example: 'Сжалось в груди, захотелось уйти' })
  @IsOptional()
  @IsString()
  reaction?: string;

  @ApiPropertyOptional({
    type: () => [DiaryEmotionPickDto],
    description: DIARY_RATED_EMOTIONS_SWAGGER_DESCRIPTION,
    example: [
      { name: 'Тревога', percent: 60 },
      { name: 'Страх', percent: 40 },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiaryEmotionPickDto)
  emotion?: DiaryEmotionPickDto[];

  @ApiPropertyOptional({ type: String, description: 'Поведение', example: 'Избегаю зрительного контакта' })
  @IsOptional()
  @IsString()
  behavior?: string;

  @ApiPropertyOptional({ type: String, description: 'Другое поведение', example: 'Обговорить с начальником как улучшить ситуацию' })
  @IsOptional()
  @IsString()
  behaviorAlt?: string;

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'string', enum: DIARY_ENTRY_TAGS_FOR_VALIDATION },
    description: DIARY_ENTRY_TAGS_SWAGGER_DESCRIPTION,
    example: ['Работа', 'Стресс'],
  })
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return [value];
    return value;
  })
  @IsOptional()
  @IsArray()
  @Type(() => String)
  @IsString({ each: true })
  @IsIn(DIARY_ENTRY_TAGS_FOR_VALIDATION, { each: true })
  tags?: string[];

  @ApiPropertyOptional({
    enum: DiaryVisibilityDto,
    example: DiaryVisibilityDto.PRIVATE,
    description: 'Для терапевта: значение THERAPIST (регистр не важен: therapist → THERAPIST)',
  })
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'string') return value.trim().toUpperCase();
    return value;
  })
  @IsOptional()
  @IsEnum(DiaryVisibilityDto)
  visibility?: DiaryVisibilityDto;
}

class UpdateDiaryEntryDto extends CreateDiaryEntryDto {}

class UpdateDiaryEntryByBodyDto extends UpdateDiaryEntryDto {
  @ApiPropertyOptional({ type: String, description: 'ID записи дневника', example: '2c5ef4be-2d87-4f62-babc-23f984f2be14' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({ type: String, description: 'Алиас для ID записи дневника', example: '2c5ef4be-2d87-4f62-babc-23f984f2be14' })
  @IsOptional()
  @IsString()
  diaryEntryId?: string;
}

@ApiTags('diary')
@ApiBearerAuth()
@ApiExtraModels(DiaryEmotionPickDto)
@Controller('diary')
class DiaryEntriesController {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  private async updateEntryById(req: any, id: string, body: UpdateDiaryEntryDto) {
    if (req.user.role === 'THERAPIST') throw new ForbiddenException('Therapist cannot edit diary entries');
    const existing = await this.prisma.diaryEntry.findFirst({
      where: { id, alexithymicId: req.user.sub, isDeleted: false },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Diary entry not found');
    const data: Record<string, unknown> = {};
    if (body.situation !== undefined) data.situation = body.situation;
    if (body.thought !== undefined) data.thought = body.thought;
    if (body.reaction !== undefined) data.reaction = body.reaction;
    if (body.behavior !== undefined) data.behavior = body.behavior;
    if (body.behaviorAlt !== undefined) data.behaviorAlt = body.behaviorAlt;
    if (body.tags !== undefined) data.tags = serializeDiaryEntryTags(body.tags);
    if (body.visibility !== undefined) data.visibility = body.visibility;
    if (body.emotion !== undefined) {
      data.emotion = scalarEmotionSummary(body.emotion);
      return this.prisma.$transaction(async (tx) => {
        if (Object.keys(data).length) await tx.diaryEntry.update({ where: { id }, data });
        await replaceUserRatedEmotionsForEntry(tx, id, body.emotion!);
        return tx.diaryEntry.findUniqueOrThrow({ where: { id }, include: DIARY_ENTRY_DETAIL_INCLUDE });
      });
    }
    return this.prisma.diaryEntry.update({
      where: { id },
      data,
      include: DIARY_ENTRY_DETAIL_INCLUDE,
    });
  }

  @Post()
  @ApiBody({ type: () => CreateDiaryEntryDto })
  @ApiOperation({ summary: 'Create diary entry' })
  @ApiResponse({ status: 201 })
  async create(@Req() req: any, @Body() body: CreateDiaryEntryDto) {
    if (req.user.role === 'THERAPIST') throw new ForbiddenException('Therapist cannot create diary entries');
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.diaryEntry.create({
        data: {
          alexithymicId: req.user.sub,
          situation: body.situation,
          thought: body.thought,
          reaction: body.reaction,
          emotion: scalarEmotionSummary(body.emotion),
          behavior: body.behavior,
          behaviorAlt: body.behaviorAlt,
          tags: serializeDiaryEntryTags(body.tags),
          visibility: body.visibility ?? 'PRIVATE',
        },
      });
      if (body.emotion !== undefined) {
        await replaceUserRatedEmotionsForEntry(tx, entry.id, body.emotion);
      }
      return tx.diaryEntry.findUniqueOrThrow({
        where: { id: entry.id },
        include: DIARY_ENTRY_DETAIL_INCLUDE,
      });
    });
  }

  @Get()
  @ApiOperation({
    summary: 'Список записей дневника (только клиент)',
    description:
      'Пагинация: **limit** — сколько записей вернуть за раз (по умолчанию 20); **offset** — сколько последних записей пропустить с начала выборки (для следующей «страницы»: offset = limit, 2×limit, …). ' +
      'Чтобы увидеть только то, что доступно терапевту, передай **visibility=THERAPIST**.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Максимум записей в ответе (по умолчанию 20)',
    example: 20,
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Пропустить первые N записей (с учётом сортировки по дате, новые сверху)',
    example: 0,
  })
  @ApiQuery({
    name: 'visibility',
    required: false,
    enum: DiaryVisibilityDto,
    description:
      'Без параметра — все записи. THERAPIST — только те, что клиент открыл терапевту. PRIVATE — только личные.',
  })
  @ApiQuery({
    name: 'tags',
    required: false,
    schema: { type: 'string', enum: DIARY_ENTRY_TAGS_FOR_VALIDATION },
    description: 'Фильтр: подстрока в сохранённом поле tags (можно выбрать значение из списка)',
  })
  @ApiQuery({
    name: 'all',
    required: false,
    type: Boolean,
    description: 'Если true, вернуть все записи без пагинации',
    example: true,
  })
  list(@Req() req: any, @Query() query: any) {
    if (req.user.role === 'THERAPIST') {
      throw new ForbiddenException(
        'Список собственного дневника доступен только клиенту. Дневник привязанного клиента смотрите в разделе работы с клиентами.',
      );
    }
    const tagsFilter = query.tags
      ? { tags: { contains: String(query.tags), mode: 'insensitive' as const } }
      : {};
    let visibilityFilter: { visibility?: 'PRIVATE' | 'THERAPIST' } = {};
    if (query.visibility !== undefined && query.visibility !== '') {
      const v = String(query.visibility).trim().toUpperCase();
      if (v !== 'PRIVATE' && v !== 'THERAPIST') {
        throw new BadRequestException('visibility должен быть PRIVATE или THERAPIST');
      }
      visibilityFilter = { visibility: v as 'PRIVATE' | 'THERAPIST' };
    }
    const queryAll = String(query.all ?? '').trim().toLowerCase() === 'true';
    const take = queryAll ? undefined : Math.min(Math.max(1, Number(query.limit ?? 20)), 100);
    const skip = queryAll ? undefined : Math.max(0, Number(query.offset ?? 0));
    return this.prisma.diaryEntry.findMany({
      where: { alexithymicId: req.user.sub, isDeleted: false, ...tagsFilter, ...visibilityFilter },
      orderBy: { createdAt: 'desc' },
      ...(take !== undefined ? { take } : {}),
      ...(skip !== undefined ? { skip } : {}),
      include: DIARY_ENTRY_DETAIL_INCLUDE,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get diary entry by id' })
  async one(@Req() req: any, @Param('id') id: string) {
    const entry = await this.prisma.diaryEntry.findUnique({
      where: { id },
      include: DIARY_ENTRY_DETAIL_INCLUDE,
    });
    if (req.user.role === 'THERAPIST' && entry?.visibility === 'PRIVATE') throw new ForbiddenException();
    return entry;
  }

  @Patch(':id')
  @ApiBody({ type: () => UpdateDiaryEntryDto })
  @ApiOperation({ summary: 'Update diary entry' })
  async update(@Req() req: any, @Param('id') id: string, @Body() body: UpdateDiaryEntryDto) {
    return this.updateEntryById(req, id, body);
  }

  @Patch()
  @ApiBody({ type: () => UpdateDiaryEntryByBodyDto })
  @ApiOperation({ summary: 'Update diary entry by id in request body' })
  async updateByBody(@Req() req: any, @Body() body: UpdateDiaryEntryByBodyDto) {
    const id = body.id?.trim() || body.diaryEntryId?.trim();
    if (!id) throw new BadRequestException('id or diaryEntryId is required');
    return this.updateEntryById(req, id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete diary entry' })
  remove(@Req() req: any, @Param('id') id: string) {
    if (req.user.role === 'THERAPIST') throw new ForbiddenException('Therapist cannot delete diary entries');
    return this.prisma.diaryEntry.update({ where: { id }, data: { isDeleted: true } });
  }
}
@Module({ controllers: [DiaryEntriesController] })
export class DiaryEntriesModule {}
