/**
 * Kerangka Temporal Types, Duration Parser, and Calendar Arithmetic
 * Specification: spec/semantics/temporal.md
 * Status: Draft 0.1
 * License: Apache-2.0
 */

export interface DurationObject {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
  isNegative: boolean;
}

const ISO_DURATION_REGEX =
  /^([+-])?P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

const SHORTHAND_DURATION_REGEX = /^([+-])?(\d+)([smhd])$/i;

/**
 * Parses an ISO 8601 duration string (e.g. "P1M", "P3D", "PT4H", "P1Y2M3DT4H5M6S")
 * or backward-compatible shorthand (e.g. "3d", "4h", "30m", "10s").
 */
export function parseDuration(durationStr: string): DurationObject {
  if (typeof durationStr !== "string" || !durationStr.trim()) {
    throw new Error(`Invalid duration string: expected non-empty string, got ${JSON.stringify(durationStr)}`);
  }

  const str = durationStr.trim();

  // 1. Shorthand check: "3d", "4h", "30m", "10s"
  const shortMatch = str.match(SHORTHAND_DURATION_REGEX);
  if (shortMatch) {
    const isNegative = shortMatch[1] === "-";
    const qty = Number(shortMatch[2]);
    const unit = shortMatch[3]!.toLowerCase();

    return {
      years: 0,
      months: 0,
      weeks: 0,
      days: unit === "d" ? qty : 0,
      hours: unit === "h" ? qty : 0,
      minutes: unit === "m" ? qty : 0,
      seconds: unit === "s" ? qty : 0,
      milliseconds: 0,
      isNegative,
    };
  }

  // 2. ISO 8601 duration check
  const isoMatch = str.match(ISO_DURATION_REGEX);
  if (!isoMatch) {
    throw new Error(`Invalid ISO 8601 duration: "${durationStr}"`);
  }

  const isNegative = isoMatch[1] === "-";
  const years = isoMatch[2] ? Number(isoMatch[2]) : 0;
  const months = isoMatch[3] ? Number(isoMatch[3]) : 0;
  const weeks = isoMatch[4] ? Number(isoMatch[4]) : 0;
  const days = isoMatch[5] ? Number(isoMatch[5]) : 0;
  const hours = isoMatch[6] ? Number(isoMatch[6]) : 0;
  const minutes = isoMatch[7] ? Number(isoMatch[7]) : 0;
  const fullSeconds = isoMatch[8] ? Number(isoMatch[8]) : 0;

  // Make sure at least one component was present
  if (
    isoMatch[2] === undefined &&
    isoMatch[3] === undefined &&
    isoMatch[4] === undefined &&
    isoMatch[5] === undefined &&
    isoMatch[6] === undefined &&
    isoMatch[7] === undefined &&
    isoMatch[8] === undefined
  ) {
    throw new Error(`Invalid ISO 8601 duration: "${durationStr}" (no components)`);
  }

  const seconds = Math.floor(fullSeconds);
  const milliseconds = Math.round((fullSeconds - seconds) * 1000);

  return {
    years,
    months,
    weeks,
    days,
    hours,
    minutes,
    seconds,
    milliseconds,
    isNegative,
  };
}

/**
 * Adds or subtracts months with month clamping per spec/semantics/temporal.md §4.2:
 * - 2026-01-31 + 1 month = 2026-02-28
 * - 2024-01-31 + 1 month = 2024-02-29 (leap year)
 * - 2026-03-31 + 1 month = 2026-04-30
 */
export function addMonthsClamped(base: Date, monthsToAdd: number): Date {
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth(); // 0..11
  const day = base.getUTCDate();
  const hours = base.getUTCHours();
  const minutes = base.getUTCMinutes();
  const seconds = base.getUTCSeconds();
  const ms = base.getUTCMilliseconds();

  const totalMonths = year * 12 + month + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12; // 0..11

  // Days in target month: Date.UTC(targetYear, targetMonth + 1, 0) gives last day of targetMonth
  const maxDays = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, maxDays);

  return new Date(Date.UTC(targetYear, targetMonth, targetDay, hours, minutes, seconds, ms));
}

/**
 * Adds years with month clamping (e.g. 2024-02-29 + 1 year = 2025-02-28).
 */
export function addYearsClamped(base: Date, yearsToAdd: number): Date {
  return addMonthsClamped(base, yearsToAdd * 12);
}

/**
 * Adds an ISO 8601 duration to a Date or ISO string, strictly adhering to month clamping.
 */
export function addDuration(base: Date | string, duration: string | DurationObject): string {
  const isInputString = typeof base === "string";
  const isOnlyDate = isInputString && /^\d{4}-\d{2}-\d{2}$/.test(base.trim());
  const parsedBase = typeof base === "string" ? new Date(base) : new Date(base.getTime());

  if (isNaN(parsedBase.getTime())) {
    throw new Error(`Invalid base date: ${JSON.stringify(base)}`);
  }

  const dur = typeof duration === "string" ? parseDuration(duration) : duration;
  const factor = dur.isNegative ? -1 : 1;

  let current = parsedBase;

  // 1. Years and Months (month clamping)
  const totalMonths = (dur.years * 12 + dur.months) * factor;
  if (totalMonths !== 0) {
    current = addMonthsClamped(current, totalMonths);
  }

  // 2. Weeks and Days
  const totalDays = (dur.weeks * 7 + dur.days) * factor;
  if (totalDays !== 0) {
    current = new Date(current.getTime() + totalDays * 24 * 60 * 60 * 1000);
  }

  // 3. Hours, Minutes, Seconds, Milliseconds
  const timeOffsetMs =
    (dur.hours * 3600 * 1000 + dur.minutes * 60 * 1000 + dur.seconds * 1000 + dur.milliseconds) * factor;
  if (timeOffsetMs !== 0) {
    current = new Date(current.getTime() + timeOffsetMs);
  }

  if (isOnlyDate) {
    return current.toISOString().split("T")[0]!;
  }
  return current.toISOString();
}

/**
 * Adds signed integer n calendar days to date or datetime d (spec/semantics/temporal.md §4.1).
 */
export function addDays(d: Date | string, n: number): string {
  const isInputString = typeof d === "string";
  const isOnlyDate = isInputString && /^\d{4}-\d{2}-\d{2}$/.test(d.trim());
  const parsedDate = typeof d === "string" ? new Date(d) : new Date(d.getTime());

  if (isNaN(parsedDate.getTime())) {
    throw new Error(`Invalid date for addDays: ${JSON.stringify(d)}`);
  }

  const result = new Date(parsedDate.getTime() + n * 24 * 60 * 60 * 1000);
  if (isOnlyDate) {
    return result.toISOString().split("T")[0]!;
  }
  return result.toISOString();
}

/**
 * Computes the integer number of full calendar days elapsed between d1 and d2 (spec/semantics/temporal.md §4.1).
 * diffDays("2026-01-01", "2026-01-05") => 4
 */
export function diffDays(d1: Date | string, d2: Date | string): number {
  const date1 = typeof d1 === "string" ? new Date(d1) : d1;
  const date2 = typeof d2 === "string" ? new Date(d2) : d2;

  if (isNaN(date1.getTime()) || isNaN(date2.getTime())) {
    throw new Error(`Invalid date arguments for diffDays: d1=${JSON.stringify(d1)}, d2=${JSON.stringify(d2)}`);
  }

  // Normalize both to UTC midnight to measure calendar days
  const utc1 = Date.UTC(date1.getUTCFullYear(), date1.getUTCMonth(), date1.getUTCDate());
  const utc2 = Date.UTC(date2.getUTCFullYear(), date2.getUTCMonth(), date2.getUTCDate());

  return Math.round((utc2 - utc1) / (24 * 60 * 60 * 1000));
}

/**
 * Evaluates today() in the specified timezone (defaults to "UTC" per spec/semantics/temporal.md §3).
 */
export function today(timezone = "UTC", now?: Date | string): string {
  const date = now ? (typeof now === "string" ? new Date(now) : now) : new Date();
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date for today(): ${JSON.stringify(now)}`);
  }

  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(date);
  } catch {
    // Fallback to UTC if timezone is invalid
    return date.toISOString().split("T")[0]!;
  }
}

/**
 * Evaluates now() returning UTC instant string ending in 'Z' (spec/semantics/temporal.md §2).
 */
export function nowInstant(now?: Date | string): string {
  const date = now ? (typeof now === "string" ? new Date(now) : now) : new Date();
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date for now(): ${JSON.stringify(now)}`);
  }
  return date.toISOString();
}

/**
 * Standard 5-field cron parser and next-run calculator (spec/semantics/temporal.md §5).
 * Cron format: `minute hour day-of-month month day-of-week`
 */
export interface CronField {
  values: Set<number>;
  isWildcard: boolean;
}

export function parseCronField(fieldStr: string, min: number, max: number): CronField {
  const values = new Set<number>();
  if (fieldStr === "*") {
    for (let i = min; i <= max; i++) values.add(i);
    return { values, isWildcard: true };
  }

  const parts = fieldStr.split(",");
  for (const part of parts) {
    if (part.includes("/")) {
      const [rangePart, stepPart] = part.split("/");
      const step = Number(stepPart);
      if (isNaN(step) || step <= 0) {
        throw new Error(`Invalid step in cron field: "${part}"`);
      }
      let rangeMin = min;
      let rangeMax = max;
      if (rangePart && rangePart !== "*") {
        if (rangePart.includes("-")) {
          const [rMin, rMax] = rangePart.split("-").map(Number);
          rangeMin = rMin ?? min;
          rangeMax = rMax ?? max;
        } else {
          rangeMin = Number(rangePart);
        }
      }
      for (let i = rangeMin; i <= rangeMax; i += step) {
        values.add(i);
      }
    } else if (part.includes("-")) {
      const [rMin, rMax] = part.split("-").map(Number);
      if (rMin === undefined || rMax === undefined || isNaN(rMin) || isNaN(rMax)) {
        throw new Error(`Invalid range in cron field: "${part}"`);
      }
      for (let i = rMin; i <= rMax; i++) {
        values.add(i);
      }
    } else {
      const num = Number(part);
      if (isNaN(num)) {
        throw new Error(`Invalid number in cron field: "${part}"`);
      }
      values.add(num);
    }
  }

  return { values, isWildcard: false };
}

/**
 * Calculates the next UTC instant when a 5-field cron expression will fire.
 */
export function getNextCronRun(cronExpr: string, fromDate?: Date | string): Date {
  const base = fromDate ? (typeof fromDate === "string" ? new Date(fromDate) : new Date(fromDate.getTime())) : new Date();
  if (isNaN(base.getTime())) {
    throw new Error(`Invalid fromDate for getNextCronRun: ${JSON.stringify(fromDate)}`);
  }

  const fields = cronExpr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression (must have 5 fields): "${cronExpr}"`);
  }

  const minuteField = parseCronField(fields[0]!, 0, 59);
  const hourField = parseCronField(fields[1]!, 0, 23);
  const dayOfMonthField = parseCronField(fields[2]!, 1, 31);
  const monthField = parseCronField(fields[3]!, 1, 12);
  const dayOfWeekField = parseCronField(fields[4]!, 0, 7); // 0 or 7 = Sunday

  // Start searching from the next full minute (seconds = 0, ms = 0)
  const current = new Date(base.getTime() + 60 * 1000);
  current.setUTCSeconds(0, 0);

  // Maximum lookahead: 5 years (prevent infinite loops on impossible crons)
  const maxIterations = 5 * 365 * 24 * 60;
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    const month = current.getUTCMonth() + 1;
    if (!monthField.values.has(month)) {
      // Advance to first day of next month
      current.setUTCMonth(current.getUTCMonth() + 1, 1);
      current.setUTCHours(0, 0, 0, 0);
      continue;
    }

    const dayOfMonth = current.getUTCDate();
    const dayOfWeek = current.getUTCDay(); // 0 = Sun
    const dowMatches = dayOfWeekField.values.has(dayOfWeek) || (dayOfWeek === 0 && dayOfWeekField.values.has(7));
    const domMatches = dayOfMonthField.values.has(dayOfMonth);

    let dayMatches = false;
    if (dayOfMonthField.isWildcard && dayOfWeekField.isWildcard) {
      dayMatches = true;
    } else if (!dayOfMonthField.isWildcard && !dayOfWeekField.isWildcard) {
      dayMatches = domMatches || dowMatches; // Standard cron: union if both specified
    } else if (!dayOfMonthField.isWildcard) {
      dayMatches = domMatches;
    } else {
      dayMatches = dowMatches;
    }

    if (!dayMatches) {
      // Advance to next day 00:00
      current.setUTCDate(current.getUTCDate() + 1);
      current.setUTCHours(0, 0, 0, 0);
      continue;
    }

    const hour = current.getUTCHours();
    if (!hourField.values.has(hour)) {
      // Advance to next hour 00m
      current.setUTCHours(current.getUTCHours() + 1, 0, 0, 0);
      continue;
    }

    const minute = current.getUTCMinutes();
    if (!minuteField.values.has(minute)) {
      current.setUTCMinutes(current.getUTCMinutes() + 1, 0, 0);
      continue;
    }

    // Found match
    return current;
  }

  throw new Error(`Unable to find next run for cron expression within 5 years: "${cronExpr}"`);
}
