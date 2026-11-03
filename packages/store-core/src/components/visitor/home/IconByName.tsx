import * as Icons from 'lucide-react'

interface IconByNameProps {
  name?: string | null
  className?: string
}

export default function IconByName({ name, className = 'w-6 h-6' }: IconByNameProps) {
  const Icon = (name ? (Icons as any)[name] : undefined) as React.FC<{ className?: string }> | undefined
  if (!Icon) {
    const Fallback = (Icons as any)['Package'] as React.FC<{ className?: string }>
    return <Fallback className={className} />
  }
  return <Icon className={className} />
}
