import { resolve } from 'node:path';
import { DateTime, IANAZone } from 'luxon';
import { z } from 'zod';
import type { Clock } from '../domain/calendar';
const schema = z.object({
 mode: z.enum(['mock','google']),
 timezone: z.string().refine(v => IANAZone.isValidZone(v)),
 clock: z.string().optional().refine(v => !v || DateTime.fromISO(v,{setZone:true}).isValid && /(Z|[+-]\d{2}:\d{2})$/.test(v)),
 stateDir: z.string().min(1),
 port: z.string().regex(/^\d{1,5}$/),
 allowedOrigins: z.array(z.string().regex(/^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/)),
});
export type AppConfig = z.infer<typeof schema>;
export function loadConfig(env: Readonly<Record<string, string | undefined>> = process.env): AppConfig {
 const port = env.CALENDAR_PORT || env.PORT || '3100';
 const origins = env.CALENDAR_ALLOWED_ORIGINS ? env.CALENDAR_ALLOWED_ORIGINS.split(',').map(v => v.trim()).filter(Boolean) : [`http://127.0.0.1:${port}`,`http://localhost:${port}`];
 const result = schema.safeParse({mode:env.CALENDAR_MODE ?? 'mock',timezone:env.CALENDAR_TIMEZONE ?? 'Asia/Tokyo',clock:env.CALENDAR_MOCK_NOW || undefined,stateDir:resolve(env.CALENDAR_STATE_DIR ?? '.local/dev'),port,allowedOrigins:origins});
 if (!result.success) throw new Error('Invalid calendar configuration: check CALENDAR_MODE (mock|google), CALENDAR_TIMEZONE, CALENDAR_MOCK_NOW, CALENDAR_ALLOWED_ORIGINS.');
 if (result.data.mode === 'google' && result.data.clock) throw new Error('Invalid calendar configuration: CALENDAR_MOCK_NOW is only for mock mode.');
 return result.data;
}
export function configuredClock(value?: string): Clock { return { now: () => value ? new Date(value) : new Date() }; }
