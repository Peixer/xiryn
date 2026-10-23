// Which page a vault fill is aimed at. The window title is not an input:
// a page can copy another tab's title, and the old fallback to the first
// tab typed into whichever window happened to be focused.

export type PageTarget = {
  url: string
  title?: string
  focused: boolean
  visible?: boolean
}

function described(page: PageTarget) {
  if (!page || typeof page.url !== "string") return null
  let url: URL
  try {
    url = new URL(page.url)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  // Keep every label, including a leading "www". eTLD+1 already treats
  // www.example.com and example.com as one site. Stripping the label here
  // would hide the real host on the approval card and collapse a separate
  // registrable name such as www.github.io onto the public suffix github.io.
  const host = url.hostname.replace(/\.$/, "")
  if (!host) return null
  return {
    url: url.origin,
    host,
    title: typeof page.title === "string" ? page.title : "",
    focused: page.focused === true,
    visible: page.visible === true,
  }
}

// One focused http(s) page wins. If the window has no DOM focus, the single
// visible tab is the page on screen. Anything else is ambiguous, so refuse.
export function pageFromTargets(pages: PageTarget[]) {
  const http = pages.map(described).filter((page) => page !== null)
  const focused = http.filter((page) => page.focused)
  const candidates = focused.length > 0 ? focused : http.filter((page) => page.visible)
  if (candidates.length !== 1) return null
  const page = candidates[0]
  return { url: page.url, host: page.host, title: page.title }
}
