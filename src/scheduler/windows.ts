/**
 * Local-time run windows ("23:00-07:00"). Windows may wrap midnight; a
 * wrapped window belongs to the day it STARTS (Friday 23:00-07:00 runs into
 * Saturday morning when days include Friday).
 */

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function inWindow(
  windows: string[],
  days: number[] | undefined,
  now: Date = new Date(),
): boolean {
  if (windows.length === 0) {
    return !days || days.includes(now.getDay());
  }
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();
  const yesterday = (today + 6) % 7;

  for (const window of windows) {
    const [startText, endText] = window.split("-");
    if (!startText || !endText) continue;
    const start = minutesOf(startText);
    const end = minutesOf(endText);

    if (start <= end) {
      if (nowMin >= start && nowMin < end && (!days || days.includes(today))) return true;
    } else {
      // wraps midnight: evening part belongs to today, morning part to yesterday's window
      if (nowMin >= start && (!days || days.includes(today))) return true;
      if (nowMin < end && (!days || days.includes(yesterday))) return true;
    }
  }
  return false;
}
