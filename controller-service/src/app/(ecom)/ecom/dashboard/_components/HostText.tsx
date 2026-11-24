import { Fragment } from 'react'

/**
 * A host name that wraps after a dot (site-acme.<wbr>jeffistores.<wbr>in), never mid-word unless one label can't fit.
 * Read out once as the plain host: the wrapped copy is visual only.
 */
export default function HostText({ host, className = '' }: { host: string; className?: string }) {
  const parts = host.split('.')
  return (
    <span className={`break-words ${className}`}>
      <span className="sr-only">{host}</span>
      <span aria-hidden="true">
        {parts.map((p, i) => (
          <Fragment key={i}>
            {p}
            {i < parts.length - 1 && (
              <>
                .<wbr />
              </>
            )}
          </Fragment>
        ))}
      </span>
    </span>
  )
}
