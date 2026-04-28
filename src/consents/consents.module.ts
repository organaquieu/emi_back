import { Body, Controller, Get, Inject, Module, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';

enum ConsentTypeDto {
  DATA_PROCESSING = 'DATA_PROCESSING',
  AI_USAGE = 'AI_USAGE',
}

class UpsertConsentDto {
  @ApiProperty({ type: String, enum: ConsentTypeDto, example: ConsentTypeDto.AI_USAGE })
  @IsEnum(ConsentTypeDto)
  type!: ConsentTypeDto;

  @ApiProperty({ type: String, example: '1.0.0' })
  @IsString()
  version!: string;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class RevokeConsentDto {
  @ApiProperty({ type: String, enum: ConsentTypeDto, example: ConsentTypeDto.AI_USAGE })
  @IsEnum(ConsentTypeDto)
  type!: ConsentTypeDto;
}

@ApiTags('consents')
@ApiBearerAuth()
@Controller('consents')
class ConsentsController {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}
  @ApiOperation({ summary: 'Список согласий текущего пользователя' })
  @Get() list(@Req() req: any) { return this.prisma.consent.findMany({ where: { userId: req.user.sub } }); }
  @Post()
  @ApiOperation({ summary: 'Создать/обновить согласие' })
  @ApiBody({ type: UpsertConsentDto })
  upsert(@Req() req: any, @Body() body: UpsertConsentDto) {
    return this.prisma.consent.upsert({ where: { userId_type: { userId: req.user.sub, type: body.type } }, update: { isActive: body.isActive ?? true, version: body.version, givenAt: new Date() }, create: { userId: req.user.sub, type: body.type, version: body.version, isActive: body.isActive ?? true } });
  }
  @Post('revoke')
  @ApiOperation({ summary: 'Отозвать согласие' })
  @ApiBody({ type: RevokeConsentDto })
  revoke(@Req() req: any, @Body() body: RevokeConsentDto) { return this.prisma.consent.update({ where: { userId_type: { userId: req.user.sub, type: body.type } }, data: { isActive: false } }); }
}
@Module({ controllers: [ConsentsController] })
export class ConsentsModule {}
