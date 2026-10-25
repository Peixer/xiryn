// In-memory flag for this process. The watcher in duty.ts is the only writer.
// Callers that can start Telegram (the settings panel, a saved token) check
// it so an idle colour cannot begin polling between ticks. Before the watcher
// starts, work is allowed: a single-process dev server has no watcher race,
// and register() ticks once before it serves.

let watches = 0
let allowed = true

export function noteDutyWatch(open: boolean) {
  watches += open ? 1 : -1
  if (watches < 0) watches = 0
}

export function setDutyAllowed(next: boolean) {
  allowed = next
}

export function dutyWatches() {
  return watches
}

export function backgroundWorkAllowed() {
  if (watches === 0) return true
  return allowed
}
