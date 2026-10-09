import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'tests/e2e',fullyParallel:false,workers:2,timeout:30000,
 use:{baseURL:'http://127.0.0.1:3310',headless:true,launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}},
 projects:[{name:'1920x1280',use:{viewport:{width:1920,height:1280}}},{name:'1536x1024',use:{viewport:{width:1536,height:1024}}},{name:'1280x853',use:{viewport:{width:1280,height:853}}},{name:'1024x683',use:{viewport:{width:1024,height:683}}}],
 webServer:{command:'npm run dev',url:'http://127.0.0.1:3310/api/health/ready',reuseExistingServer:false,timeout:120000,env:{CALENDAR_PORT:'3310',CALENDAR_MODE:'mock',CALENDAR_MOCK_NOW:'2026-10-03T14:20:00+09:00',CALENDAR_STATE_DIR:'.local/e2e',NEXT_TELEMETRY_DISABLED:'1'}},
});
