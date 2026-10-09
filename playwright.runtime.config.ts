import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'tests/runtime',outputDir:'test-results/runtime',workers:1,
 use:{baseURL:'http://127.0.0.1:3311',viewport:{width:1280,height:853},launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}},
 webServer:{command:'npm run start',url:'http://127.0.0.1:3311/api/health/ready',reuseExistingServer:false,env:{CALENDAR_PORT:'3311',CALENDAR_MODE:'mock',CALENDAR_MOCK_NOW:'',CALENDAR_TIMEZONE:'Asia/Tokyo',NEXT_TELEMETRY_DISABLED:'1'}},
});
