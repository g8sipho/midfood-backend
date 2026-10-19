// "Order for later": the days and half-hour slots a customer can pick, and
// how a chosen time is written. Everything is in the phone's local time;
// what goes to the server is the ISO instant.

// The kitchen needs this long, at least.
export const MIN_LEAD_MINUTES = 45;
// Slots run until this time of day, and start here on a day that isn't today.
const LAST_SLOT = { hour: 21, minute: 30 };
const FIRST_SLOT = { hour: 8, minute: 0 };
const SLOT_MINUTES = 30;
// How many days ahead are offered: today plus six more.
const DAYS_AHEAD = 7;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type ScheduleDay = {
  // Midnight at the start of the day, local time.
  date: Date;
  // "Today", "Tomorrow", then "Wed 22".
  label: string;
  // Every pickable time on the day, as ISO instants, in order.
  slots: string[];
};

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

// Half-hour times on one day, from `from` (or the first slot) to the last.
function slotsOn(day: Date, from: Date | null): string[] {
  const out: string[] = [];
  const end = new Date(day);
  end.setHours(LAST_SLOT.hour, LAST_SLOT.minute, 0, 0);
  const t = new Date(day);
  if (from) {
    // Round up to the next :00 or :30 (never down, not even by seconds).
    t.setTime(from.getTime());
    if (t.getSeconds() || t.getMilliseconds()) {
      t.setSeconds(0, 0);
      t.setMinutes(t.getMinutes() + 1);
    }
    const over = t.getMinutes() % SLOT_MINUTES;
    if (over !== 0) t.setMinutes(t.getMinutes() + (SLOT_MINUTES - over));
  } else {
    t.setHours(FIRST_SLOT.hour, FIRST_SLOT.minute, 0, 0);
  }
  while (t.getTime() <= end.getTime()) {
    out.push(t.toISOString());
    t.setMinutes(t.getMinutes() + SLOT_MINUTES);
  }
  return out;
}

// The days a customer can order for, each with its slots. Today is left out
// once the evening's last slot has passed.
export function scheduleDays(now = new Date()): ScheduleDay[] {
  const days: ScheduleDay[] = [];
  const earliest = new Date(now.getTime() + MIN_LEAD_MINUTES * 60000);
  for (let i = 0; i < DAYS_AHEAD; i += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() + i);
    date.setHours(0, 0, 0, 0);
    const slots = slotsOn(date, i === 0 ? earliest : null);
    if (slots.length === 0) continue;
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `${WEEKDAYS[date.getDay()]} ${date.getDate()}`;
    days.push({ date, label, slots });
  }
  return days;
}

// "18:30"
export function slotTime(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "Tue 18:30" for a time within the week either side of now; further away
// it carries the date too, "Tue 22 Oct, 18:30", so an old order still reads.
export function formatSchedule(iso: string, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const nearby = Math.abs(d.getTime() - now.getTime()) < 6.5 * 24 * 3600 * 1000;
  if (nearby) {
    if (sameDay(d, now)) return `Today ${time}`;
    return `${WEEKDAYS[d.getDay()]} ${time}`;
  }
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${time}`;
}

// "12 Oct" — for review dates and the like.
export function shortDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
