import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Module, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';

enum TherapistClientStatusDto {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  FINISHED = 'FINISHED',
}

class SearchTherapistQueryDto {
  @ApiProperty({ type: String, description: 'Код терапевта', example: 'THERA-12345' })
  @IsString()
  code!: string;
}

class SearchClientQueryDto {
  @ApiProperty({ type: String, description: 'Код клиента', example: 'C-c05c0f79' })
  @IsString()
  code!: string;
}

class LinkTherapistClientDto {
  @ApiProperty({ type: String, description: 'Код терапевта', example: 'T-c05c0f79' })
  @IsString()
  code!: string;
}

class LinkByClientCodeDto {
  @ApiProperty({ type: String, description: 'Код клиента', example: 'C-c05c0f79' })
  @IsString()
  code!: string;
}

class UpdateTherapistClientStatusDto {
  @ApiProperty({ type: String, enum: TherapistClientStatusDto, example: TherapistClientStatusDto.PAUSED })
  @IsEnum(TherapistClientStatusDto)
  status!: TherapistClientStatusDto;
}

@ApiTags('therapist-clients')
@ApiBearerAuth()
@Controller()
class TherapistClientsController {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  private async ensureClientCode(userId: string) {
    const profile = await this.prisma.alexithymicProfile.findUnique({
      where: { userId },
      select: { userId: true, code: true, nickname: true, user: { select: { email: true } } },
    });
    if (!profile) throw new NotFoundException('Client profile not found');
    if (profile.code) return profile;
    return this.prisma.alexithymicProfile.update({
      where: { userId },
      data: { code: `C-${userId.slice(0, 8)}` },
      select: { userId: true, code: true, nickname: true, user: { select: { email: true } } },
    });
  }

  private async listLinksWithNames(userId: string) {
    const links = await this.prisma.therapistClient.findMany({
      where: { OR: [{ therapistId: userId }, { alexithymicId: userId }] },
      include: {
        therapist: {
          select: { fullName: true, code: true, userId: true },
        },
        alexithymic: {
          select: {
            nickname: true,
            user: {
              select: { email: true },
            },
          },
        },
      },
    });

    return links.map((link) => ({
      ...link,
      clientName:
        link.alexithymic?.nickname?.trim() ||
        link.alexithymic?.user?.email?.split('@')[0] ||
        null,
      clientEmail: link.alexithymic?.user?.email ?? null,
    }));
  }

  @Get('therapists/me/code')
  @ApiOperation({ summary: 'Получить свой код терапевта (для передачи клиенту)' })
  async myCode(@Req() req: any) {
    if (req.user.role !== 'THERAPIST') {
      throw new ForbiddenException('Only therapist can request therapist code');
    }
    const profile = await this.prisma.therapistProfile.findUnique({
      where: { userId: req.user.sub },
      select: { code: true, fullName: true, userId: true },
    });
    if (!profile) throw new NotFoundException('Therapist profile not found');
    return profile;
  }

  @Get('therapists/search')
  @ApiOperation({ summary: 'Найти терапевта по коду' })
  @ApiQuery({ name: 'code', type: String, required: true, description: 'Код терапевта' })
  search(@Query() query: SearchTherapistQueryDto) { return this.prisma.therapistProfile.findFirst({ where: { code: query.code } }); }

  @Get('clients/me/code')
  @ApiOperation({ summary: 'Получить свой код клиента (для передачи терапевту)' })
  async myClientCode(@Req() req: any) {
    if (req.user.role !== 'ALEXITHYMIC') {
      throw new ForbiddenException('Only client can request client code');
    }
    return this.ensureClientCode(req.user.sub);
  }

  @Get('clients/search')
  @ApiOperation({ summary: 'Найти клиента по коду' })
  @ApiQuery({ name: 'code', type: String, required: true, description: 'Код клиента' })
  async searchClient(@Query() query: SearchClientQueryDto) {
    const code = query.code?.trim();
    if (!code) throw new BadRequestException('code is required');
    const profile = await this.prisma.alexithymicProfile.findFirst({
      where: { code },
      select: {
        userId: true,
        code: true,
        nickname: true,
        user: { select: { email: true } },
      },
    });
    if (!profile) throw new NotFoundException('Client with this code not found');
    return profile;
  }

  @Post('therapist-clients')
  @ApiOperation({ summary: 'Клиент отправляет запрос на привязку к терапевту по коду' })
  @ApiBody({ type: LinkTherapistClientDto })
  async link(@Req() req: any, @Body() body: LinkTherapistClientDto) {
    if (req.user.role !== 'ALEXITHYMIC') throw new ForbiddenException('Only client can link to therapist');
    const code = body.code?.trim();
    if (!code) throw new BadRequestException('code is required');
    const therapist = await this.prisma.therapistProfile.findUnique({ where: { code } });
    if (!therapist) throw new NotFoundException('Therapist with this code not found');
    const existing = await this.prisma.therapistClient.findFirst({
      where: { therapistId: therapist.userId, alexithymicId: req.user.sub },
      select: { id: true, status: true },
    });
    if (existing) {
      if (existing.status === 'ACTIVE') {
        return this.prisma.therapistClient.findUniqueOrThrow({ where: { id: existing.id } });
      }
      return this.prisma.therapistClient.update({ where: { id: existing.id }, data: { status: 'ACTIVE', endDate: null } });
    }
    return this.prisma.therapistClient.create({ data: { therapistId: therapist.userId, alexithymicId: req.user.sub } });
  }

  @Post('therapist-clients/by-client-code')
  @ApiOperation({ summary: 'Терапевт привязывает клиента по коду клиента' })
  @ApiBody({ type: LinkByClientCodeDto })
  async linkByClientCode(@Req() req: any, @Body() body: LinkByClientCodeDto) {
    if (req.user.role !== 'THERAPIST') throw new ForbiddenException('Only therapist can link by client code');
    const code = body.code?.trim();
    if (!code) throw new BadRequestException('code is required');
    const client = await this.prisma.alexithymicProfile.findFirst({
      where: { code },
      select: { userId: true },
    });
    if (!client) throw new NotFoundException('Client with this code not found');
    const existing = await this.prisma.therapistClient.findFirst({
      where: { therapistId: req.user.sub, alexithymicId: client.userId },
      select: { id: true, status: true },
    });
    if (existing) {
      if (existing.status === 'ACTIVE') {
        return this.prisma.therapistClient.findUniqueOrThrow({ where: { id: existing.id } });
      }
      return this.prisma.therapistClient.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', endDate: null },
      });
    }
    return this.prisma.therapistClient.create({
      data: { therapistId: req.user.sub, alexithymicId: client.userId },
    });
  }

  @Get('therapist-clients')
  @ApiOperation({ summary: 'Список связок терапевт-клиент для текущего пользователя' })
  list(@Req() req: any) {
    return this.listLinksWithNames(req.user.sub);
  }

  @Get('client-therapist')
  @ApiOperation({ summary: 'Alias списка связок с именем клиента' })
  clientTherapist(@Req() req: any) {
    return this.listLinksWithNames(req.user.sub);
  }

  @Patch('therapist-clients/:id/status')
  @ApiOperation({ summary: 'Изменить статус связки (ACTIVE/PAUSED/FINISHED)' })
  @ApiParam({ name: 'id', type: String, description: 'ID связки therapistClient' })
  @ApiBody({ type: UpdateTherapistClientStatusDto })
  status(@Param('id') id: string, @Body() body: UpdateTherapistClientStatusDto) { return this.prisma.therapistClient.update({ where: { id }, data: { status: body.status } }); }

  @Get('therapist-clients/:id/report')
  @ApiOperation({ summary: 'Отчёт по дневнику клиента для терапевта (только visibility=THERAPIST)' })
  @ApiParam({ name: 'id', type: String, description: 'ID связки therapistClient' })
  async report(@Req() req: any, @Param('id') id: string) {
    const link = await this.prisma.therapistClient.findUnique({ where: { id } });
    if (!link || link.therapistId !== req.user.sub) throw new ForbiddenException();
    return this.prisma.diaryEntry.findMany({ where: { alexithymicId: link.alexithymicId, visibility: 'THERAPIST', isDeleted: false } });
  }
}
@Module({ controllers: [TherapistClientsController] })
export class TherapistClientsModule {}
