import type { Set } from '@festival/domain';

export interface StageLike {
  id: string;
  name: string;
  map_x?: number | null;
  map_y?: number | null;
}

export interface MeetupLike {
  id: string;
  title: string;
  starts_at: string;
  stage_id?: string | null;
  custom_map_x?: number | null;
  custom_map_y?: number | null;
  notes?: string | null;
}

export function normaliseMapPoint(x?: number | null, y?: number | null): { x: number; y: number } | null {
  if (typeof x !== 'number' || typeof y !== 'number') {
    return null;
  }

  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}

export function getNextStageSet(stageId: string, sets: Set[], now: Date): Set | null {
  const nowMs = now.getTime();
  return (
    [...sets]
      .filter((set) => set.stage_id === stageId && new Date(set.start_time).getTime() >= nowMs)
      .sort((left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime())[0] ?? null
  );
}

export function getMeetupMapPoint(meetup: MeetupLike, stages: StageLike[]): { x: number; y: number } | null {
  const customPoint = normaliseMapPoint(meetup.custom_map_x, meetup.custom_map_y);
  if (customPoint) {
    return customPoint;
  }

  const stage = stages.find((candidate) => candidate.id === meetup.stage_id);
  return stage ? normaliseMapPoint(stage.map_x, stage.map_y) : null;
}
