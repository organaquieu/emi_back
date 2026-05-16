import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getHello(): { status: string; endpoints: Record<string, string> } {
    return {
      status: 'EMI API is running',
      endpoints: {
        auth: '/auth',
        users: '/users',
        diary: '/diary-entries',
        emotions: '/emotions',
        tags: '/tags',
        ai: '/ai',
        reflection: '/reflection',
        therapist: '/therapist-clients',
        tas: '/tas',
        admin: '/admin',
      },
    };
  }
}