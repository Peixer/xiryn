export function hapticTap() {
  try {
    navigator.vibrate?.(12)
  } catch {
    // Safari does not implement the Vibration API. The call is a no-op there.
  }
}
