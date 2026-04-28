import { Controller, Get, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DIARY_RATED_EMOTIONS } from '../diary-entries/diary-rated-emotions.constants.js';

@ApiTags('emotions')
@ApiBearerAuth()
@Controller('emotions')
class EmotionsController {
  @Get()
  @ApiOperation({ summary: 'Список фиксированных эмоций' })
  list() {
    return DIARY_RATED_EMOTIONS;
  }
}
@Module({ controllers: [EmotionsController] })
export class EmotionsModule {}
