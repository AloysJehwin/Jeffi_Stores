import React from 'react'

// Capture group so String.split() yields the matched URL as its own element.
const URL_SPLIT_RE = /(https?:\/\/[^\s]+)/g
// Fresh, non-global check — safe to call per part without lastIndex statefulness.
const IS_URL_RE = /^https?:\/\//

// Render plain text with clickable links. Splits on URLs and returns
// <a> for each URL, plain strings otherwise. Safe (no dangerouslySetInnerHTML).
export function renderTextWithLinks(text: string): React.ReactNode {
  if (!text) return text
  const parts = text.split(URL_SPLIT_RE)
  return parts.map((part, i) => {
    if (IS_URL_RE.test(part)) {
      // strip trailing punctuation that isn't part of the URL
      const m = part.match(/^(.*?)([.,!?)]*)$/)
      const url = m ? m[1] : part
      const trail = m ? m[2] : ''
      return (
        <React.Fragment key={i}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-accent-600 dark:text-accent-400 break-all"
          >
            {url}
          </a>
          {trail}
        </React.Fragment>
      )
    }
    return <React.Fragment key={i}>{part}</React.Fragment>
  })
}
