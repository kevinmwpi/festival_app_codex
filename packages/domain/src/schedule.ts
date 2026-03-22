export interface Set {
  id: string;
  artist_id: string;
  stage_id: string;
  start_time: string;
  end_time: string;
  festival_id: string;
}

export interface ScheduleConflict {
  set_a: Set;
  set_b: Set;
  type: 'hard' | 'tight';
}

function toTime(value: string): number {
  return new Date(value).getTime();
}

export function detectConflict(a: Set, b: Set): boolean {
  return toTime(a.start_time) < toTime(b.end_time) && toTime(a.end_time) > toTime(b.start_time);
}

export function getConflictsForSet(set: Set, selected: Set[]): Set[] {
  return selected.filter((candidate) => candidate.id !== set.id && detectConflict(set, candidate));
}

export function getSetsByDay(sets: Set[]): Record<string, Set[]> {
  return [...sets]
    .sort((left, right) => toTime(left.start_time) - toTime(right.start_time))
    .reduce<Record<string, Set[]>>((grouped, currentSet) => {
      const dayKey = currentSet.start_time.slice(0, 10);
      grouped[dayKey] ??= [];
      grouped[dayKey].push(currentSet);
      return grouped;
    }, {});
}

export function getNextUpcomingSet(selected: Set[], now: Date): Set | null {
  const nowMs = now.getTime();
  const ordered = [...selected].sort((left, right) => toTime(left.start_time) - toTime(right.start_time));
  return ordered.find((set) => toTime(set.start_time) >= nowMs) ?? null;
}

export function getConflictPairs(selected: Set[]): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];

  for (let index = 0; index < selected.length; index += 1) {
    const current = selected[index];

    for (let innerIndex = index + 1; innerIndex < selected.length; innerIndex += 1) {
      const candidate = selected[innerIndex];
      if (!detectConflict(current, candidate)) {
        continue;
      }

      conflicts.push({
        set_a: current,
        set_b: candidate,
        type: 'hard',
      });
    }
  }

  return conflicts;
}
