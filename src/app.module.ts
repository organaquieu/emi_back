import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { DiaryEntriesModule } from './diary-entries/diary-entries.module.js';
import { TagsModule } from './tags/tags.module.js';
import { EmotionsModule } from './emotions/emotions.module.js';
import { AIModule } from './ai/ai.module.js';
import { TherapistClientsModule } from './therapist-clients/therapist-clients.module.js';
import { ReflectionModule } from './reflection/reflection.module.js';
import { TasModule } from './tas/tas.module.js';
import { AdminPanelModule } from './admin/admin.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AdminPanelModule,
    AuthModule,
    UsersModule,
    DiaryEntriesModule,
    TagsModule,
    EmotionsModule,
    AIModule,
    TherapistClientsModule,
    ReflectionModule,
    TasModule,
  ],
})
export class AppModule {}
