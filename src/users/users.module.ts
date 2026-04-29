import { Module, Controller, Get, Patch, Delete, Req, Body, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildAlexithymicCode } from '../common/utils/profile-codes.js';

class UpdateMeDto {
  @ApiPropertyOptional({ type: String, format: 'email', example: 'new.email@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ type: String, example: 'Nickname' })
  @IsOptional()
  @IsString()
  nickname?: string;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
class UsersController {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get own profile' })
  @ApiResponse({ status: 200 })
  me(@Req() req: any) {
    return this.prisma.user.findUnique({
      where: { id: req.user.sub },
      include: { alexithymicProfile: true, therapistProfile: true },
    });
  }

  @Patch('me')
  @ApiBody({ type: () => UpdateMeDto })
  @ApiOperation({ summary: 'Update own profile' })
  @ApiResponse({ status: 200 })
  async update(@Req() req: any, @Body() body: UpdateMeDto) {
    const user = await this.prisma.user.update({
      where: { id: req.user.sub },
      data: { ...(body.email ? { email: body.email } : {}) },
    });
    if (body.nickname) {
      await this.prisma.alexithymicProfile.upsert({
        where: { userId: req.user.sub },
        create: { userId: req.user.sub, code: buildAlexithymicCode(req.user.sub), nickname: body.nickname },
        update: { nickname: body.nickname },
      });
    }
    return user;
  }

  @Delete('me')
  @ApiOperation({ summary: 'Soft delete own profile' })
  @ApiResponse({ status: 200 })
  async remove(@Req() req: any) {
    await this.prisma.user.update({ where: { id: req.user.sub }, data: { isActive: false } });
    return { success: true };
  }
}
@Module({ controllers: [UsersController] })
export class UsersModule {}
