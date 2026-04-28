import { Controller, Get, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

const TAGS = [
  'Работа',
  'Дедлайн',
  'Учеба',
  'Совещание',
  'Важный разговор',
  'Экзамен',
  'Семья',
  'Поддержка',
  'Партнёр',
  'Дружба',
  'Одиночество',
  'Конфликт',
  'Усталость',
  'Тревога',
  'Хорошее самочувствие',
  'Стресс',
  'Болезнь',
  'Медитация',
  'Дом',
  'Финансы',
  'Транспорт',
  'Покупки',
  'Погода',
  'Другое',
] as const;

@ApiTags('tags')
@ApiBearerAuth()
@Controller('tags')
class TagsController {
  @Get()
  @ApiOperation({ summary: 'Список фиксированных тегов' })
  list() {
    return TAGS;
  }
}
@Module({ controllers: [TagsController] })
export class TagsModule {}
