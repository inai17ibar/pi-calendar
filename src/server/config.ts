import { DateTime, IANAZone } from 'luxon';
import { z } from 'zod';
import type { Clock } from '../domain/calendar';
const schema = z.object({ mode: z.literal('mock'), timezone:z.string().refine(v => IANAZone.isValidZone(v)), clock: z.string().optional().refine(v => !v || DateTime.fromISO(v,{setZone:true}).isValid && /(Z|[+-]\d{2}:\d{2})$/.test(v)) });
export function loadConfig(env: Readonly<Record<string, string | undefined>> = process.env) {
 const result = schema.safeParse({mode:env.CALENDAR_MODE ?? 'mock',timezone:env.CALENDAR_TIMEZONE ?? 'Asia/Tokyo',clock:env.CALENDAR_MOCK_NOW});
 if (!result.success) throw new Error('Invalid calendar configuration: check CALENDAR_MODE, CALENDAR_TIMEZONE, CALENDAR_MOCK_NOW. Google mode is not implemented.');
 return result.data;
}
export function configuredClock(value?: string): Clock { return { now: () => value ? new Date(value) : new Date() }; }
