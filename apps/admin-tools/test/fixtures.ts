import { readFileSync } from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(__dirname, '../../..');

export function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

export function demoFestivalJson(): Record<string, any> {
  return JSON.parse(readRepoFile('seed-data/demo-festival.json'));
}

/** A small, valid real-festival file; tests mutate copies of it. */
export function realFestival(): Record<string, any> {
  const festivalId = '11111111-1111-4111-8111-111111111111';
  return {
    festival: {
      id: festivalId,
      name: 'Riverside Sounds',
      start_date: '2027-08-06',
      end_date: '2027-08-07',
      timezone: 'America/Chicago',
      venue_name: 'Riverside Park',
      status: 'draft',
      source_url: 'https://example.org/schedule',
      latitude: 41.9,
      longitude: -87.63,
      bounds_sw_lat: 41.89,
      bounds_sw_lng: -87.64,
      bounds_ne_lat: 41.91,
      bounds_ne_lng: -87.62,
    },
    stages: [
      { id: '22222222-2222-4222-8222-222222222221', name: 'Main', latitude: 41.9, longitude: -87.63 },
      { id: '22222222-2222-4222-8222-222222222222', festival_id: festivalId, name: 'Tent', zone: 'North' },
    ],
    artists: [
      { id: '33333333-3333-4333-8333-333333333331', name: 'Artist One', genre: 'Rock' },
      { id: '33333333-3333-4333-8333-333333333332', name: 'Artist Two' },
    ],
    sets: [
      {
        id: '44444444-4444-4444-8444-444444444441',
        artist_id: '33333333-3333-4333-8333-333333333331',
        stage_id: '22222222-2222-4222-8222-222222222221',
        start_time: '2027-08-06T19:00:00-05:00',
        end_time: '2027-08-06T20:00:00-05:00',
      },
      {
        id: '44444444-4444-4444-8444-444444444442',
        festival_id: festivalId,
        artist_id: '33333333-3333-4333-8333-333333333332',
        stage_id: '22222222-2222-4222-8222-222222222222',
        start_time: '2027-08-08T00:30:00-05:00',
        end_time: '2027-08-08T01:30:00-05:00',
        set_type: 'dj',
      },
    ],
  };
}
