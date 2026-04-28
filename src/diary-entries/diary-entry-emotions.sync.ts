import type { PrismaClient } from '@prisma/client';

type EmotionDb = Pick<PrismaClient, 'emotion' | 'diaryEntryEmotion'>;

function dedupeByName(rated: { name: string; percent: number }[]) {
  const m = new Map<string, number>();
  for (const r of rated) {
    m.set(r.name.trim(), r.percent);
  }
  return [...m.entries()].map(([name, percent]) => ({ name, percent }));
}

/** Удаляет USER-связи записи и создаёт заново по списку (percent 0–100 → confidence 0–1). */
export async function replaceUserRatedEmotionsForEntry(
  db: EmotionDb,
  diaryEntryId: string,
  rated: { name: string; percent: number }[],
) {
  await db.diaryEntryEmotion.deleteMany({
    where: { diaryEntryId, source: 'USER' },
  });
  for (const { name, percent } of dedupeByName(rated)) {
    const trimmed = name.trim();
    let emotion = await db.emotion.findUnique({ where: { name: trimmed } });
    if (!emotion) {
      emotion = await db.emotion.create({
        data: {
          name: trimmed,
          category: 'COMPLEX',
          valence: 'NEUTRAL',
          arousalLevel: 5,
        },
      });
    }
    await db.diaryEntryEmotion.create({
      data: {
        diaryEntryId,
        emotionId: emotion.id,
        confidence: Math.min(1, Math.max(0, percent / 100)),
        source: 'USER',
      },
    });
  }
}
