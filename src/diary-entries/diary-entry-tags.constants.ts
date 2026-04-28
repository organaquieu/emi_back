
export const DIARY_ENTRY_TAG_GROUPS = [
  {
    theme: 'Работа и учеба',
    tags: ['Работа', 'Дедлайн', 'Учеба', 'Совещание', 'Важный разговор', 'Экзамен'],
  },
  {
    theme: 'Отношения',
    tags: ['Семья', 'Поддержка', 'Партнёр', 'Дружба', 'Одиночество', 'Конфликт'],
  },
  {
    theme: 'Здоровье',
    tags: ['Усталость', 'Тревога', 'Хорошее самочувствие', 'Стресс', 'Болезнь', 'Медитация'],
  },
  {
    theme: 'Повседневность',
    tags: ['Дом', 'Финансы', 'Транспорт', 'Покупки', 'Погода', 'Другое'],
  },
] as const;

export const DIARY_ENTRY_TAGS = [
  ...DIARY_ENTRY_TAG_GROUPS[0].tags,
  ...DIARY_ENTRY_TAG_GROUPS[1].tags,
  ...DIARY_ENTRY_TAG_GROUPS[2].tags,
  ...DIARY_ENTRY_TAG_GROUPS[3].tags,
] as const;

export type DiaryEntryTag = (typeof DIARY_ENTRY_TAGS)[number];

export const DIARY_ENTRY_TAGS_FOR_VALIDATION: string[] = [...DIARY_ENTRY_TAGS];

export const DIARY_ENTRY_TAGS_SWAGGER_DESCRIPTION = [
  'Выберите один или несколько тегов из списка.',
  ...DIARY_ENTRY_TAG_GROUPS.map((g) => `${g.theme}: ${g.tags.join(', ')}.`),
].join('\n');

export function serializeDiaryEntryTags(tags: string[] | undefined): string | null {
  if (tags === undefined || tags.length === 0) return null;
  return [...new Set(tags)].join(', ');
}
