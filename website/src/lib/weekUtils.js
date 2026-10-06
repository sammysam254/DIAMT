// ══════════════════════════════════════════════════════════════════════════════
// DIAMT WEEK & DATE UTILITIES (ISO-8601 STANDARD)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Returns ISO week string e.g. "2026-W41"
 */
export function getISOWeekString(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Returns a list of recent week strings (e.g. current + previous 10 weeks)
 */
export function getRecentWeekIdentifiers(count = 10) {
  const list = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const w = getISOWeekString(d);
    if (!list.includes(w)) list.push(w);
  }
  return list;
}

/**
 * Returns array of days for Monday - Sunday
 */
export const DAYS_OF_WEEK = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
];

/**
 * Get current day name (e.g. "Monday")
 */
export function getCurrentDayName() {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[new Date().getDay()];
}

/**
 * Formats YYYY-MM-DD
 */
export function getTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculates exact calendar date (YYYY-MM-DD) for any day of a given week identifier, including future days.
 */
export function getDateForDayInWeek(weekIdentifier, dayName) {
  const match = (weekIdentifier || '').match(/^(\d{4})-W(\d{2})$/);
  if (!match) return getTodayDateString();
  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);

  const dayIndexMap = {
    'Monday': 1,
    'Tuesday': 2,
    'Wednesday': 3,
    'Thursday': 4,
    'Friday': 5,
    'Saturday': 6,
    'Sunday': 7,
    'Weekly': 1
  };
  const targetDayNum = dayIndexMap[dayName] || 1;

  // Jan 4th is always in ISO week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfJan4 = jan4.getUTCDay() || 7;
  const mondayOfWeek1 = new Date(jan4.getTime() - (dayOfJan4 - 1) * 86400000);

  const targetDate = new Date(mondayOfWeek1.getTime() + ((week - 1) * 7 + (targetDayNum - 1)) * 86400000);
  const y = targetDate.getUTCFullYear();
  const m = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(targetDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

