import {
  Inject,
  Injectable,
  UnauthorizedException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import { ChangePasswordDto, LoginDto, RegisterDto, SendRegistrationCodeDto } from './auth.dto.js';
import { buildAlexithymicCode } from '../common/utils/profile-codes.js';
import * as bcrypt from 'bcrypt';

const VERIFICATION_TTL_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(JwtService) private jwt: JwtService,
    @Inject(ConfigService) private config: ConfigService,
    @Inject(MailService) private mail: MailService,
  ) {}

  async sendRegistrationCode(dto: SendRegistrationCodeDto) {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('Email already in use');

    const latest = await this.prisma.emailVerificationCode.findFirst({
      where: { email },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new HttpException('Please wait before requesting a new code', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = String(randomInt(100_000, 1_000_000));
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

    await this.prisma.$transaction([
      this.prisma.emailVerificationCode.deleteMany({ where: { email } }),
      this.prisma.emailVerificationCode.create({
        data: { email, codeHash, expiresAt },
      }),
    ]);

    await this.mail.sendRegistrationCode(email, code);

    return {
      success: true,
      expiresInSeconds: Math.floor(VERIFICATION_TTL_MS / 1000),
    };
  }

  private async assertEmailVerified(email: string, code: string) {
    const record = await this.prisma.emailVerificationCode.findFirst({
      where: { email, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new BadRequestException('Verification code expired or not found. Request a new code.');
    }

    const valid = await bcrypt.compare(code, record.codeHash);
    if (!valid) {
      throw new BadRequestException('Invalid verification code');
    }

    await this.prisma.emailVerificationCode.deleteMany({ where: { email } });
  }

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const normalizedFullName = dto.fullName?.trim() || undefined;

    const byEmail = await this.prisma.user.findUnique({ where: { email } });
    if (byEmail) throw new BadRequestException('Email already in use');

    await this.assertEmailVerified(email, dto.code);

    try {
      const passwordHash = await bcrypt.hash(dto.password, 10);
      const user = await this.prisma.user.create({
        data: { email, passwordHash, role: dto.role },
      });
      let clientCode: string | null = null;
      let fullName: string | null = null;
      if (dto.role === 'ALEXITHYMIC') {
        const profile = await this.prisma.alexithymicProfile.create({
          data: {
            userId: user.id,
            code: buildAlexithymicCode(user.id),
            nickname: normalizedFullName,
          },
          select: { code: true, nickname: true },
        });
        clientCode = profile.code;
        fullName = profile.nickname ?? null;
      }
      let therapistCode: string | null = null;
      if (dto.role === 'THERAPIST') {
        const profile = await this.prisma.therapistProfile.create({
          data: {
            userId: user.id,
            fullName: normalizedFullName ?? 'Therapist',
            code: `T-${user.id.slice(0, 8)}`,
          },
          select: { code: true, fullName: true },
        });
        therapistCode = profile.code;
        fullName = profile.fullName;
      }
      const tokens = await this.issueTokens(user.id, user.email ?? undefined, user.phone ?? undefined, user.role);
      await this.prisma.consent.create({ data: { userId: user.id, type: 'DATA_PROCESSING', version: '1.0.0' } });
      await this.prisma.auditLog.create({ data: { userId: user.id, eventType: 'AUTH_REGISTER', description: 'User registered' } });
      return { id: user.id, email: user.email, role: user.role, fullName, therapistCode, clientCode, ...tokens };
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
    if (user.role === 'THERAPIST') {
      const profile = await this.prisma.therapistProfile.findUnique({
        where: { userId: user.id },
        select: { code: true },
      });
      therapistCode = profile?.code ?? null;
    }
    if (user.role === 'ALEXITHYMIC') {
      const profile = await this.prisma.alexithymicProfile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          code: buildAlexithymicCode(user.id),
        },
        update: {
          code: buildAlexithymicCode(user.id),
        },
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
