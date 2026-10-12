import {it,expect} from 'vitest';
import {defaultPreferences,displayTheme,readPreferences} from '../../src/domain/preferences';
it.each([
 ['2026-10-03T21:59:59+09:00','light'],['2026-10-03T22:00:00+09:00','dark'],
 ['2026-10-04T00:00:00+09:00','dark'],['2026-10-04T06:59:59+09:00','dark'],['2026-10-04T07:00:00+09:00','light'],
])('auto theme at %s is %s',(now,expected)=>expect(displayTheme('auto',now,'Asia/Tokyo')).toBe(expected));
it('theme follows calendar timezone and honors manual override',()=>{
 expect(displayTheme('auto','2026-10-03T13:00:00Z','Asia/Tokyo')).toBe('dark');
 expect(displayTheme('auto','2026-10-03T13:00:00Z','America/New_York')).toBe('light');
 expect(displayTheme('light','2026-10-03T22:00:00+09:00','Asia/Tokyo')).toBe('light');
 expect(displayTheme('dark','2026-10-03T12:00:00+09:00','Asia/Tokyo')).toBe('dark');
});
it('migrates old Monday/light settings to Sunday/auto while keeping other preferences',()=>{
 expect(readPreferences({theme:'light',scale:'large',weekStart:1,startupView:'week'})).toEqual({...defaultPreferences,scale:'large',startupView:'week'});
 expect(readPreferences({...defaultPreferences,theme:'light',weekStart:1})).toEqual({...defaultPreferences,theme:'light',weekStart:1});
 expect(readPreferences(null)).toEqual(defaultPreferences);
});
