import type { ComponentProps } from 'react'
import { BriefcaseBusiness, UserRound } from 'lucide-react'

export function ProfileSegment({ icon, children, ...props }: ComponentProps<'button'> & { icon: 'personal' | 'work' }) {
  const Icon = icon === 'work' ? BriefcaseBusiness : UserRound
  return <button {...props} className="profile-segment"><Icon aria-hidden="true" size={16} strokeWidth={1.8} /><span>{children}</span></button>
}
