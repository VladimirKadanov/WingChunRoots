// The words of a generation label (plan §4.4) with the person's name marked as a name (CLAUDE.md
// §2: its lang attribute and translate="no"), for the explorer's cards and panel. The same words
// as generationText(), which accessible names use.

import type { GenerationLabel } from './generation';

export function GenerationText({ label }: { label: GenerationLabel }) {
  const name = (
    <span lang="und-Latn" translate="no">
      {label.kind === 'lineage' ? label.rootName : label.anchorName}
    </span>
  );
  if (label.kind === 'lineage') return <>Generation {label.generation} from {name}</>;
  return (
    <>
      {label.below} {label.below === 1 ? 'generation' : 'generations'} below {name} in this view
    </>
  );
}
