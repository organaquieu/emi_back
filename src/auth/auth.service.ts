import { Inject, Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChangePasswordDto, LoginDto, RegisterDto } from './auth.dto.js';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(JwtService) private jwt: JwtService,
    @Inject(ConfigService) private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();

    const byEmail = await this.prisma.user.findUnique({ where: { email } });
    if (byEmail) throw new BadRequestException('Email already in use');

    try {
      const passwordHash = await bcrypt.hash(dto.password, 10);
      const user = await this.prisma.user.create({
        data: { email, passwordHash, role: dto.role as Role },
      });
      let clientCode: string | null = null;
      if (dto.role === Role.ALEXITHYMIC) {
        const profile = await this.prisma.alexithymicProfile.create({
          data: { userId: user.id, code: `C-${user.id.slice(0, 8)}` },
        });
        clientCode = profile.code;
      }
      let therapistCode: string | null = null;
      if (dto.role === Role.THERAPIST) {
        const profile = await this.prisma.therapistProfile.create({
          data: { userId: user.id, fullName: dto.fullName ?? 'Therapist', code: `T-${user.id.slice(0, 8)}` },
        });
        therapistCode = profile.code;
      }
      const tokens = await this.issueTokens(user.id, user.email ?? undefined, user.phone ?? undefined, user.role);
      await this.prisma.consent.create({ data: { userId: user.id, type: 'DATA_PROCESSING', version: '1.0.0' } });
      await this.prisma.auditLog.create({ data: { userId: user.id, eventType: 'AUTH_REGISTER', description: 'User registered' } });
      return { id: user.id, email: user.email, role: user.role, therapistCode, clientCode, ...tokens };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('Email already in use');
      }
      throw e;
    }
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');
    const tokens = await this.issueTokens(user.id, user.email ?? undefined, user.phone ?? undefined, user.role);
    await this.prisma.auditLog.create({ data: { userId: user.id, eventType: 'AUTH_LOGIN' } });
    let therapistCode: string | null = null;
    let clientCode: string | null = null;
    if (user.role === Role.THERAPIST) {
      const profile = await this.prisma.therapistProfile.findUnique({
        where: { userId: user.id },
        select: { code: true },
      });
      therapistCode = profile?.code ?? null;
    }
    if (user.role === Role.ALEXITHYMIC) {
      const profile = await this.prisma.alexithymicProfile.findUnique({
        where: { userId: user.id },
        select: { code: true },
      });
      clientCode = profile?.code ?? null;
    }
    return { ...tokens, therapistCode, clientCode };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync(refreshToken, { secret: this.config.get<string>('JWT_REFRESH_SECRET') });
      return this.issueTokens(payload.sub, payload.email, payload.phone, payload.role);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string) {
    await this.prisma.auditLog.create({ data: { userId, eventType: 'AUTH_LOGOUT' } });
    return { success: true };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Current password is invalid');
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.prisma.auditLog.create({ data: { userId, eventType: 'AUTH_CHANGE_PASSWORD' } });
    return { success: true };
  }

  private async issueTokens(userId: string, email: string | undefined, phone: string | undefined, role: string) {
    const payload = { sub: userId, email, phone, role };
    const accessToken = await this.jwt.signAsync(payload, { secret: this.config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '3h' });
    const refreshToken = await this.jwt.signAsync(payload, { secret: this.config.get<string>('JWT_REFRESH_SECRET'), expiresIn: '30d' });
    return { accessToken, refreshToken };
  }
}
