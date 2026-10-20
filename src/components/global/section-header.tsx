/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: SectionHeader, SectionHeaderProps
 *
 * WHAT:  A page/section title primitive — a large heading + optional muted
 *        description.
 * WHY:   Reused across settings pages (and anywhere a titled section is needed)
 *        so headings stay consistent. Pairs with SettingsSection.
 * WHERE: settings/billing, settings/organization, etc.
 */

export interface SectionHeaderProps {
  title: string;
  description?: string;
}

export function SectionHeader({ title, description }: SectionHeaderProps) {
  return (
    <div className="space-y-1">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
