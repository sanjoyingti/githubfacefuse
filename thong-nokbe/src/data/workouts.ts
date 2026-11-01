import list from './exerciseList.json';
import videos from './exerciseVideos.json';
import { DAY_KEYS, weekOfYear, type DayKey } from '../lib/dates';

export interface Exercise {
  id: string;
  name: string;
  day: WorkoutDayKey;
  videoId: string | null;
  videoTitle: string | null;
  channel: string | null;
}

export type WorkoutDayKey = Exclude<DayKey, 'sunday'>;

export interface WorkoutDay {
  key: WorkoutDayKey;
  label: string; // Monday
  short: string; // Mon
  title: string; // Chest Day
  muscle: string;
  exercises: Exercise[];
}

type VideoEntry = { videoId: string; title: string; channel: string } | null;
const videoMap = videos as Record<string, VideoEntry>;
const raw = list as Record<WorkoutDayKey, { title: string; muscle: string; exercises: string[] }>;

export const WORKOUT_DAYS: WorkoutDay[] = (Object.keys(raw) as WorkoutDayKey[]).map((key) => ({
  key,
  label: key[0].toUpperCase() + key.slice(1),
  short: key[0].toUpperCase() + key.slice(1, 3),
  title: raw[key].title,
  muscle: raw[key].muscle,
  exercises: raw[key].exercises.map((name, i) => {
    const v = videoMap[`${key}:${name}`];
    return {
      id: `${key}-${i}`,
      name,
      day: key,
      videoId: v?.videoId ?? null,
      videoTitle: v?.title ?? null,
      channel: v?.channel ?? null,
    };
  }),
}));

export function todayKey(d = new Date()): DayKey {
  return DAY_KEYS[d.getDay()];
}

export function getWorkoutDay(key: DayKey): WorkoutDay | null {
  return WORKOUT_DAYS.find((w) => w.key === key) ?? null;
}

/** The "new exercise of the day": rotates through the day's 20 exercises week by week. */
export function exerciseOfTheDay(day: WorkoutDay, d = new Date()): Exercise {
  return day.exercises[weekOfYear(d) % day.exercises.length];
}

export function youtubeSearchUrl(name: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent('how to do ' + name + ' proper form')}`;
}
