import Calendar from '../components/Calendar';
import { loadConfig, configuredClock } from '../server/config';
export const dynamic = 'force-dynamic';
export default function Page() {
 let config: ReturnType<typeof loadConfig> | undefined;
 try { config = loadConfig(); } catch { /* Render a safe setup message below. */ }
 if (!config) return <main className="setup-error"><h1>カレンダーを準備できません</h1><p>CALENDAR_MODE（mock または google）と有効な CALENDAR_TIMEZONE を設定してください。</p></main>;
 return <Calendar initialNow={configuredClock(config.clock).now().toISOString()} fixedClock={Boolean(config.clock)} timezone={config.timezone} mode={config.mode}/>;
}
