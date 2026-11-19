(function (global) {
  'use strict';
  const JP_DAYS = ['日','月','火','水','木','金','土'];
  function utcDate(key) { const [y,m,d]=key.split('-').map(Number);return new Date(Date.UTC(y,m-1,d)); }
  function keyOf(date) {return date.toISOString().slice(0,10);}
  function plusDays(key, days) {const d=utcDate(key);d.setUTCDate(d.getUTCDate()+days);return keyOf(d);}
  function japanClock(now) {
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    return {date:`${parts.year}-${parts.month}-${parts.day}`,hour:Number(parts.hour),minute:Number(parts.minute)};
  }
  function isAfterDeadline(clock) {return clock.hour*60 + clock.minute>=8*60+30;}
  function dateLabel(key, showYear=false) {const d=utcDate(key);return `${showYear?d.getUTCFullYear()+'年':''}${d.getUTCMonth()+1}月${d.getUTCDate()}日（${JP_DAYS[d.getUTCDay()]}）`;}
  function sameMonth(a,b) {return a.slice(0,7)===b.slice(0,7);}
  function inScope(date,data) {return date>=data.scope_start&&date<=data.scope_end;}
  function eventsOn(day, area, data) {
    if (!area || !data || !inScope(day, data)) return [];
    return Object.keys(area.dates).filter(type => area.dates[type]?.includes(day));
  }
  function nextFor(type, area, data, clock) {
    if (!data || !area || clock.date > data.scope_end) return null;
    const start = isAfterDeadline(clock) ? plusDays(clock.date, 1) : clock.date;
    return area.dates[type]?.find(day => day >= start) ?? null;
  }
  function daysUntil(date,clock) {return Math.round((utcDate(date)-utcDate(clock.date))/86400000);}
  global.SakaideSchedule = {utcDate, keyOf, plusDays, japanClock, isAfterDeadline,
    dateLabel, sameMonth, inScope, eventsOn, nextFor, daysUntil};
})(typeof window !== 'undefined' ? window : globalThis);
