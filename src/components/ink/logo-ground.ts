/**
 * ADR 0052: a logo is kept whole on a transparent square and is usually drawn for a light ground:
 * it sits on paper in every theme, or a dark logo would vanish in the dark one. A module of its own,
 * so the client islands that show a logo do not take the drawing code of ink-art.tsx with them.
 */
export const LOGO_GROUND = { backgroundColor: 'var(--print-paper)' } as const;
