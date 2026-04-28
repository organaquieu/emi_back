import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiExtraModels, ApiOperation, ApiParam, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

enum ReflectionStateChangeDto {
  BETTER = 'BETTER',
  SLIGHTLY_BETTER = 'SLIGHTLY_BETTER',
  NO_CHANGE = 'NO_CHANGE',
  WORSE = 'WORSE',
}

class ReflectionEmotionItemDto {
  @ApiProperty({ type: String, example: 'Страх', description: 'Название эмоции' })
  @IsString()
  name!: string;

  @ApiProperty({ type: Number, minimum: 0, maximum: 100, example: 80, description: 'Интенсивность, %' })
  @IsNumber()
  @Min(0)
  @Max(100)
  percent!: number;
}

class CreateReflectionDto {
  @ApiProperty({ type: String, description: 'ID записи дневника', example: '9407de7c-f7c1-4b21-b353-3e291fd74d2a' })
  @IsString()
  diaryEntryId!: string;

  @ApiProperty({
    type: () => [ReflectionEmotionItemDto],
    description: 'Эмоции после записи с процентами (как на экране)',
    example: [
      { name: 'Безысходность', percent: 10 },
      { name: 'Страх', percent: 80 },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReflectionEmotionItemDto)
  emotions!: ReflectionEmotionItemDto[];

  @ApiProperty({
    type: String,
    enum: ReflectionStateChangeDto,
    description:
      'Стало ли легче: BETTER — легче, SLIGHTLY_BETTER — немного легче, NO_CHANGE — без изменений, WORSE — стало хуже',
    example: ReflectionStateChangeDto.SLIGHTLY_BETTER,
  })
  @IsEnum(ReflectionStateChangeDto)
  stateChange!: ReflectionStateChangeDto;

  @ApiProperty({ type: String, required: false, description: 'Что планируете сделать дальше', example: 'Поговорить с другом' })
  @IsOptional()
  @IsString()
  plans?: string;
}

class UpdateReflectionDto {
  @ApiProperty({
    type: () => [ReflectionEmotionItemDto],
    required: false,
    example: [{ name: 'Тревога', percent: 50 }],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReflectionEmotionItemDto)
  emotions?: ReflectionEmotionItemDto[];

  @ApiProperty({ type: String, enum: ReflectionStateChangeDto, required: false })
  @IsOptional()
  @IsEnum(ReflectionStateChangeDto)
  stateChange?: ReflectionStateChangeDto;

  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  plans?: string;
}

@ApiTags('reflection')
@ApiBearerAuth()
@ApiExtraModels(ReflectionEmotionItemDto)
@Controller('reflections')
class ReflectionController {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  private async assertOwnDiaryEntry(alexithymicId: string, diaryEntryId: string) {
    const entry = await this.prisma.diaryEntry.findFirst({
      where: { id: diaryEntryId, alexithymicId, isDeleted: false },
    });
    if (!entry) throw new NotFoundException('Diary entry not found');
    return entry;
  }

  @Post()
  @ApiOperation({ summary: 'Создать рефлексию к записи дневника (одна рефлексия на запись)' })
  @ApiBody({ type: CreateReflectionDto })
  async create(@Req() req: any, @Body() body: CreateReflectionDto) {
    if (req.user.role !== 'ALEXITHYMIC') throw new ForbiddenException('Only client can create reflection');
    await this.assertOwnDiaryEntry(req.user.sub, body.diaryEntryId);
    const exists = await this.prisma.reflection.findUnique({ where: { diaryEntryId: body.diaryEntryId } });
    if (exists) throw new ConflictException('Reflection already exists for this diary entry');
    const emotionsJson = body.emotions.map((e) => ({ name: e.name.trim(), percent: e.percent })) as unknown as Prisma.InputJsonValue;
    return this.prisma.reflection.create({
      data: {
        diaryEntryId: body.diaryEntryId,
        emotions: emotionsJson,
        stateChange: body.stateChange,
        plans: body.plans?.trim() ?? null,
      },
    });
  }

  @Get('diary/:diaryEntryId')
  @ApiOperation({ summary: 'Получить рефлексию по ID записи дневника' })
  @ApiParam({ name: 'diaryEntryId', type: String })
  async getByDiary(@Req() req: any, @Param('diaryEntryId') diaryEntryId: string) {
    if (req.user.role !== 'ALEXITHYMIC') throw new ForbiddenException('Only client can read own reflection');
    await this.assertOwnDiaryEntry(req.user.sub, diaryEntryId);
    const r = await this.prisma.reflection.findUnique({ where: { diaryEntryId } });
    if (!r) throw new NotFoundException('Reflection not found');
    return r;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить рефлексию' })
  @ApiParam({ name: 'id', type: String, description: 'ID рефлексии' })
  async update(@Req() req: any, @Param('id') id: string, @Body() body: UpdateReflectionDto) {
    if (req.user.role !== 'ALEXITHYMIC') throw new ForbiddenException('Only client can update reflection');
    const existing = await this.prisma.reflection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Reflection not found');
    await this.assertOwnDiaryEntry(req.user.sub, existing.diaryEntryId);
    const data: Prisma.ReflectionUpdateInput = {};
    if (body.emotions !== undefined) {
      data.emotions = body.emotions.map((e) => ({ name: e.name.trim(), percent: e.percent })) as unknown as Prisma.InputJsonValue;
    }
    if (body.stateChange !== undefined) data.stateChange = body.stateChange;
    if (body.plans !== undefined) data.plans = body.plans?.trim() ?? null;
    return this.prisma.reflection.update({ where: { id }, data });
  }
}

@Module({ controllers: [ReflectionController] })
export class ReflectionModule {}
