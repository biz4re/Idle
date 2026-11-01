export interface SwitcherProfile { id: string; name: string; icon: 'personal' | 'work' }

// Keep two familiar choices visible, replacing one with the active Profile
// when an additional Profile is selected from the menu.
export function visibleProfiles(profiles: SwitcherProfile[], activeId: string): SwitcherProfile[] {
  profiles = profiles.map((profile) => ({ ...profile, icon: profile.icon === 'work' || profile.name.trim().toLowerCase() === 'work' ? 'work' : 'personal' }))
  const personal = profiles.find((profile) => profile.icon === 'personal')
  const work = profiles.find((profile) => profile.icon === 'work')
  const visible = [personal, work, ...profiles].filter((profile, index, all): profile is SwitcherProfile => !!profile && all.findIndex((item) => item?.id === profile.id) === index).slice(0, 2)
  const active = profiles.find((profile) => profile.id === activeId)
  if (active && !visible.some((profile) => profile.id === active.id)) {
    const keep = visible.find((profile) => profile.icon !== active.icon) ?? visible[0]
    return keep ? [keep, active] : [active]
  }
  return visible
}
