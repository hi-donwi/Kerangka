# Kerangka Semantics: Temporal Types, Clocks, and Arithmetic

- **Specification Version:** 0.1
- **Status:** Draft

## 1. Overview and Core Principle

Temporal representations and date arithmetic are notorious sources of cross-platform calculation drift and production incidents:
- Naive datetime parsing without timezone assumptions.
- Inconsistent calendar arithmetic (e.g., adding 1 month to January 31).
- Daylight Saving Time (DST) gaps causing skipped or duplicated scheduled executions.
- Operating system clocks drifting or differing across distributed nodes.

Kerangka guarantees identical temporal semantics across all Tier 1 engines by mandating strict ISO 8601 representations, explicit timezone handling, month clamping, and standardized cron resolution.

## 2. Temporal Types and Wire Encoding

| Type | Wire Encoding | Format Specification | Notes |
|---|---|---|---|
| `date` | JSON String | `YYYY-MM-DD` | Calendar date without time or timezone (e.g., `"2026-09-28"`) |
| `datetime` / `instant` | JSON String | `YYYY-MM-DDTHH:MM:SS.sssZ` | UTC instant, millisecond precision, strictly terminated with `Z` |
| `time` | JSON String | `HH:MM:SS` | Local time of day (24-hour clock) without date or timezone |
| `duration` | JSON String | ISO 8601 duration (`PnYnMnDTnHnMnS`) | Bounded duration strings (e.g., `"P1M"`, `"P7D"`, `"PT2H30M"`) |

Engines must parse temporal strings strictly according to ISO 8601 / RFC 3339. Strings with non-standard offsets or omitted time components fail validation with `TYPE_MISMATCH`.

## 3. Clocks and Ambient Time: `today()` and `now()`

1. **Ambient Time via Evaluation Context:**
   - Expressions `today()` and `now()` read the transaction timestamp `ctx.now` supplied by the host engine.
   - `now()` returns the UTC `instant` string representing the start of the current transaction. All evaluations within the same action run observe the exact same `ctx.now`.
2. **Timezone Awareness for `today()`:**
   - `today()` evaluates `ctx.now` projected into the application timezone declared in `meta.timezone` (defaults to `"UTC"` if omitted).
   - This ensures date rollover occurs precisely at midnight in the application's declared operational timezone rather than the host server's local system timezone.

## 4. Date Arithmetic and Month Clamping

### 4.1 Addition and Subtraction
- `addDays(d, n)`: Adds signed integer `n` calendar days to `date` or `datetime` `d`.
- `diffDays(d1, d2)`: Computes the integer number of full calendar days elapsed between `d1` and `d2`.

### 4.2 Month Clamping Rule
Adding calendar months to a date (`date + PnM`) follows **month clamping** to the last day of the target month:
- Adding 1 month to `2026-01-31` evaluates to `2026-02-28`.
- In a leap year, adding 1 month to `2024-01-31` evaluates to `2024-02-29`.
- Adding 1 month to `2026-03-31` evaluates to `2026-04-30`.

Engines must never overflow into the subsequent month (e.g. `2026-01-31 + P1M` must never evaluate to `2026-03-03`).

## 5. Schedules and Cron Semantics

Schedules in Kerangka (timers, recurring workflows, polling policies) use the standard 5-field cron syntax (`minute hour day-of-month month day-of-week`):
1. **Timezone Context:** Cron schedules evaluate in the application's declared `meta.timezone`.
2. **Daylight Saving Time (DST) Transitions:**
   - **Spring Forward (Gap):** If a scheduled time falls within a skipped DST hour (e.g., 02:30 when clock jumps from 02:00 to 03:00), the job executes at the next valid instant (03:00).
   - **Fall Back (Duplicate):** If a scheduled time occurs during an ambiguous repeated hour (e.g., 01:30 when clock rolls back from 02:00 to 01:00), the job executes exactly once during the first pass.
