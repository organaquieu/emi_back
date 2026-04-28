import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AdminModule } from '@adminjs/nestjs';
import AdminJS from 'adminjs';
import { Database, Resource } from '@adminjs/prisma';
import { Prisma, Role } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import * as bcrypt from 'bcrypt';

AdminJS.registerAdapter({ Database, Resource });

const ADMIN_MODELS = [
  'User',
  'AlexithymicProfile',
  'TherapistProfile',
  'TherapistClient',
  'DiaryEntry',
  'DiaryEntryEmotion',
  'Emotion',
  'AIConsultation',
  'Reflection',
  'TasAttempt',
  'Consent',
  'AuditLog',
  'Session',
  'UserTag',
] as const;

@Module({
  imports: [
    AdminModule.createAdminAsync({
      imports: [PrismaModule, ConfigModule],
      inject: [PrismaService, ConfigService],
      useFactory: (prisma: PrismaService, config: ConfigService) => {
        const enabled = config.get<string>('ADMIN_PANEL_ENABLED', 'true') !== 'false';
        if (!enabled) {
          return { shouldBeInitialized: false, adminJsOptions: { rootPath: '/admin', resources: [] } };
        }

        const isProd = config.get<string>('NODE_ENV') === 'production';
        let cookiePassword = config.get<string>('ADMIN_COOKIE_SECRET');
        let sessionSecret = config.get<string>('ADMIN_SESSION_SECRET');
        if (!cookiePassword || cookiePassword.length < 32) {
          if (isProd) throw new Error('ADMIN_COOKIE_SECRET must be at least 32 characters');
          cookiePassword = 'dev-admin-cookie-secret-min-32-chars!!';
        }
        if (!sessionSecret || sessionSecret.length < 32) {
          if (isProd) throw new Error('ADMIN_SESSION_SECRET must be at least 32 characters');
          sessionSecret = 'dev-admin-session-secret-min-32-chars!!';
        }

        const models = Prisma.dmmf.datamodel.models;
        const modelByName = Object.fromEntries(models.map((m) => [m.name, m]));

        const resources = ADMIN_MODELS.filter((name) => modelByName[name]).map((name) => {
          const base: {
            resource: { model: (typeof models)[number]; client: PrismaService };
            options: Record<string, unknown>;
          } = {
            resource: { model: modelByName[name], client: prisma },
            options: {},
          };
          if (name === 'User') {
            base.options = {
              properties: {
                passwordHash: { isVisible: { list: false, show: false, edit: false, filter: false } },
              },
            };
          }
          return base;
        });

        return {
          adminJsOptions: {
            rootPath: '/admin',
            branding: { companyName: 'Emi Admin' },
            resources,
          },
          auth: {
            authenticate: async (email: string, password: string) => {
              const user = await prisma.user.findFirst({
                where: { email, role: Role.ADMIN, isActive: true },
              });
              if (!user?.email) return null;
              const ok = await bcrypt.compare(password, user.passwordHash);
              if (!ok) return null;
              return { email: user.email, id: user.id, title: 'Admin' };
            },
            cookiePassword,
            cookieName: 'adminjs',
          },
          sessionOptions: {
            resave: true,
            saveUninitialized: true,
            secret: sessionSecret,
          },
        };
      },
    }),
  ],
})
export class AdminPanelModule {}
