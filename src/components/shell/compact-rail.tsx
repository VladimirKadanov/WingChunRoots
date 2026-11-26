// Role replay 2026-11-25, P2-10: a page with its own sidebar (/dashboard, /admin) renders this
// marker, and from 1024 px (where that sidebar stands beside the page) the site rail folds to icons (the rail-compact variant, globals.css).
// Nothing is shown; the marker only names the layout to CSS, so no script and no layout shift.

export function CompactRail() {
  return <span hidden data-compact-rail="" />;
}
