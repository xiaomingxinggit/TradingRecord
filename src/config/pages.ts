export type Page = 'overview' | 'plans' | 'trades' | 'calendar' | 'journal' | 'imports'

// Temporary workspace focus. Restore an entry by setting its visibility to true.
export const PAGE_VISIBILITY: Record<Page, boolean> = {
  overview: false,
  plans: true,
  trades: false,
  calendar: false,
  journal: false,
  imports: true,
}

export const DEFAULT_PAGE: Page = 'plans'

export function visiblePage(page: Page): Page {
  return PAGE_VISIBILITY[page] ? page : DEFAULT_PAGE
}
