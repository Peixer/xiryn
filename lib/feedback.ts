// Feedback goes from the person's own email app straight to the maintainer.
// Xiryn sends nothing itself: it only opens a draft, with the version and
// model filled in so a report is useful, and never anything from a thread.

export const FEEDBACK_EMAIL = "souravberaofficial@gmail.com"
export const ISSUES_URL = "https://github.com/SouravBeraAkaSpeed/xiryn/issues/new"

export type FeedbackContext = {
  version: string
  platform: string
  model?: string | null
  rating?: "up" | "down"
}

const ratingLabel = { up: "👍 Working well", down: "👎 Something's off" } as const

export function feedbackMailto(context: FeedbackContext) {
  const subject = context.rating
    ? `Xiryn feedback · ${ratingLabel[context.rating]}`
    : `Xiryn feedback · v${context.version}`
  const details = [
    `Xiryn ${context.version}`,
    context.platform,
    context.model && `model ${context.model}`,
  ]
    .filter(Boolean)
    .join(" · ")
  const prompt =
    context.rating === "down"
      ? "What went wrong, and what did you expect to happen?"
      : context.rating === "up"
        ? "What did you use Xiryn for, and what would make it better?"
        : "Your feedback:"
  const body = `Hi Sourav,\n\n${prompt}\n\n\n\n—\n${details}\n`
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
