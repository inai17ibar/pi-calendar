import {test,expect} from '@playwright/test';
import {DateTime} from 'luxon';
test('standalone app follows midnight across month, keeps manually selected dates',async({page,request})=>{
 const ready=await request.get('/api/health/ready');expect(ready.ok()).toBe(true);expect(ready.headers()['cache-control']).toBe('no-store');
 const events=await request.get(`/api/events?month=${DateTime.now().setZone('Asia/Tokyo').toFormat('yyyy-MM')}`);expect((await events.json()).events.length).toBeGreaterThan(0);
 const endOfMonth=DateTime.now().setZone('Asia/Tokyo').endOf('month').minus({minutes:1});
 await page.clock.install({time:endOfMonth.toJSDate()});await page.goto('/');await expect(page.locator('.event-card')).toHaveCount(5);
 await page.clock.fastForward(15000);await expect(page.getByRole('heading',{name:new RegExp(`${endOfMonth.month}月${endOfMonth.day}日`)})).toBeVisible();
 const next=endOfMonth.plus({minutes:2});await page.clock.setSystemTime(next.toJSDate());await page.clock.fastForward(15000);
 await expect(page.getByRole('heading',{name:new RegExp(`${next.month}月${next.day}日`)})).toBeVisible();
 await expect(page.getByRole('heading',{name:`${next.year}年 ${next.month}月`})).toBeVisible();
 const previous=next.minus({days:1});await page.getByRole('button',{name:new RegExp(`^${previous.toISODate()} `)}).click();
 await page.clock.setSystemTime(next.plus({days:1}).toJSDate());await page.clock.fastForward(15000);
 await expect(page.getByRole('heading',{name:new RegExp(`${previous.month}月${previous.day}日`)})).toBeVisible();
 await page.getByRole('button',{name:'今日',exact:true}).click();await expect(page.getByRole('heading',{name:new RegExp(`${next.month}月${next.day+1}日`)})).toBeVisible();
});
