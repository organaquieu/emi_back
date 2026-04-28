import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  Module,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Max, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { Public } from '../common/decorators/public.decorator.js';
import { TAS_ANSWER_LABELS, TAS20_QUESTIONS } from './tas-questions.constants.js';
import { computeTas20Scores } from './tas-score.js';

class SubmitTasDto {
  @ApiProperty({
    type: [Number],
    minItems: 20,
    maxItems: 20,
    example: [3, 2, 4, 5, 1, 2, 3, 4, 2, 5, 3, 2, 4, 3, 2, 3, 4, 5, 4, 2],
    description: 'Ровно 20 целых ответов по шкале 1–5 в порядке пунктов TAS-20 (1–20)',
  })
  @IsArray()
  @ArrayMinSize(20)
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(5, { each: true })
  answers!: number[];
}

@ApiTags('tas')
@Controller('tas')
class TasController {
  
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private assertTasDelegate() {
    if (!this.prisma) {
      throw new InternalServerErrorException('PrismaService не внедрён в контроллер (проверьте @Inject(PrismaService)).');
    }
    const delegate = (this.prisma as unknown as { tasAttempt?: { create: unknown } }).tasAttempt;
    if (!delegate) {
      throw new InternalServerErrorException(
        'Prisma Client без модели TasAttempt. Остановите dev-сервер, выполните npx prisma generate и перезапустите.',
      );
    }
  }

  @Public()
  @Get('questions')
  @ApiOperation({
    summary: 'Текст TAS-20 и шкала ответов',
    description: 'Статический контент для клиента; ответы пользователя на сервер не кэшируются в этой выдаче.',
  })
  getQuestions() {
    return {
      version: 'TAS-20',
      answerScale: TAS_ANSWER_LABELS.map((label, i) => ({ value: i + 1, label })),
      questions: [...TAS20_QUESTIONS],
    };
  }

  @ApiBearerAuth()
  @Post('attempts')
  @ApiOperation({
    summary: 'Отправить ответы TAS-20',
    description:
      'Сохраняется новая попытка (перепрохождение разрешено). В БД пишутся только суммарный балл, субшкалы DIF/DDF/EOT, категория и время.',
  })
  @ApiBody({ type: SubmitTasDto })
  async submit(@Req() req: { user: { sub: string } }, @Body() body: SubmitTasDto) {
    let scores;
    try {
      scores = computeTas20Scores(body.answers);
    } catch {
      throw new BadRequestException('Invalid TAS-20 answers');
    }
    this.assertTasDelegate();
    return this.prisma.tasAttempt.create({
      data: {
        userId: req.user.sub,
        totalScore: scores.totalScore,
        difScore: scores.difScore,
        ddfScore: scores.ddfScore,
        eotScore: scores.eotScore,
        category: scores.category,
      },
    });
  }

  @ApiBearerAuth()
  @Get('attempts/latest')
  @ApiOperation({ summary: 'Последняя сохранённая попытка TAS-20 текущего пользователя' })
  async latest(@Req() req: { user: { sub: string } }) {
    this.assertTasDelegate();
    return this.prisma.tasAttempt.findFirst({
      where: { userId: req.user.sub },
      orderBy: { completedAt: 'desc' },
    });
  }

  @ApiBearerAuth()
  @Get('attempts')
  @ApiOperation({ summary: 'История попыток TAS-20 (новые сверху)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'По умолчанию 50, максимум 100' })
  async history(@Req() req: { user: { sub: string } }, @Query('limit') limitRaw?: string) {
    let limit = parseInt(limitRaw ?? '50', 10);
    if (Number.isNaN(limit) || limit < 1) limit = 50;
    limit = Math.min(100, limit);
    this.assertTasDelegate();
    return this.prisma.tasAttempt.findMany({
      where: { userId: req.user.sub },
      orderBy: { completedAt: 'desc' },
      take: limit,
    });
  }
}

@Module({ imports: [PrismaModule], controllers: [TasController] })
export class TasModule {}
