/** Пункты с обратным кодированием (Bagby et al., TAS-20). */
const REVERSE_KEYED_ITEM_IDS = new Set([4, 5, 10, 18, 19]);

/** Difficulty Identifying Feelings */
const DIF_ITEM_IDS = [1, 3, 6, 7, 9, 13, 14];
/** Difficulty Describing Feelings */
const DDF_ITEM_IDS = [2, 4, 11, 12, 17];
/** Externally-Oriented Thinking */
const EOT_ITEM_IDS = [5, 8, 10, 15, 16, 18, 19, 20];

export type TasCategoryComputed = 'NONE' | 'POSSIBLE' | 'ALEXITHYMIA';

export type TasScoreResult = {
  totalScore: number;
  difScore: number;
  ddfScore: number;
  eotScore: number;
  category: TasCategoryComputed;
};

function itemScore(itemId: number, rawLikert1to5: number): number {
  if (rawLikert1to5 < 1 || rawLikert1to5 > 5) throw new Error(`Invalid TAS answer for item ${itemId}`);
  return REVERSE_KEYED_ITEM_IDS.has(itemId) ? 6 - rawLikert1to5 : rawLikert1to5;
}

function sumSubscale(itemIds: number[], answersByItemIndex: number[]): number {
  return itemIds.reduce((acc, id) => acc + itemScore(id, answersByItemIndex[id - 1]), 0);
}

/** `answers` — 20 значений 1..5 по порядку вопросов 1..20. */
export function computeTas20Scores(answers: number[]): TasScoreResult {
  if (answers.length !== 20) throw new Error('TAS-20 requires exactly 20 answers');
  let total = 0;
  for (let i = 1; i <= 20; i += 1) {
    total += itemScore(i, answers[i - 1]);
  }
  const difScore = sumSubscale(DIF_ITEM_IDS, answers);
  const ddfScore = sumSubscale(DDF_ITEM_IDS, answers);
  const eotScore = sumSubscale(EOT_ITEM_IDS, answers);
  let category: TasCategoryComputed;
  if (total <= 51) category = 'NONE';
  else if (total <= 60) category = 'POSSIBLE';
  else category = 'ALEXITHYMIA';
  return { totalScore: total, difScore, ddfScore, eotScore, category };
}
