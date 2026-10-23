import type { RoutineSchedule } from "@/db/schema"

// When routines run, in the local time of the computer Xiryn runs on.
// Client-safe.

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]

function at(day: Date, time: string) {
  const [hours, minutes] = time.split(":").map(Number)
  const next = new Date(day)
  next.setHours(hours, minutes, 0, 0)
  return next
}

// "2026-10-21T09:00" in local time
export function parseLocal(at: string) {
  const [date, time] = at.split("T")
  const [year, month, day] = date.split("-").map(Number)
  const [hours, minutes] = time.split(":").map(Number)
  return new Date(year, month - 1, day, hours, minutes)
}

// The first run strictly after `from`, or null when there are no more
export function nextRun(schedule: RoutineSchedule, from = new Date()): Date | null {
  if (schedule.kind === "once") {
    const at = parseLocal(schedule.at)
    return at > from ? at : null
  }
  if (schedule.kind === "hourly") {
    const next = new Date(from.getTime() + schedule.every * 3_600_000)
    next.setSeconds(0, 0)
    return next
  }
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(from)
    day.setDate(from.getDate() + offset)
    const candidate = at(day, schedule.time)
    if (candidate <= from) continue
    const weekday = candidate.getDay()
    if (schedule.kind === "weekdays" && (weekday === 0 || weekday === 6)) continue
    if (schedule.kind === "weekly" && weekday !== schedule.day) continue
    return candidate
  }
  // Unreachable for valid schedules
  return new Date(from.getTime() + 86_400_000)
}

export function describeSchedule(schedule: RoutineSchedule | null) {
  if (!schedule) return "No schedule"
  switch (schedule.kind) {
    case "daily":
      return `Every day at ${schedule.time}`
    case "weekdays":
      return `Weekdays at ${schedule.time}`
    case "weekly":
      return `${WEEKDAYS[schedule.day]}s at ${schedule.time}`
    case "hourly":
      return schedule.every === 1 ? "Every hour" : `Every ${schedule.every} hours`
    case "once": {
      const at = parseLocal(schedule.at)
      return `Once, ${at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} at ${schedule.at.slice(11)}`
    }
  }
}
