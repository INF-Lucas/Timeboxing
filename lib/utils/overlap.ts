import type { Box } from '@/lib/types';

export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function hasOverlap(
  candidateStart: Date,
  candidateEnd: Date,
  boxes: Box[],
  excludeId?: string
): boolean {
  return boxes.some((b) => {
    if (excludeId && b.id === excludeId) return false;
    const s = b.start as Date;
    const e = b.end as Date;
    return rangesOverlap(candidateStart, candidateEnd, s, e);
  });
}