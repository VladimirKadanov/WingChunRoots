// Joins class names with clsx, without resolving Tailwind conflicts. For components that are
// part of every page's JavaScript (the shell, the home page, icons, seals): their classes never
// conflict with what a caller adds, so they do without tailwind-merge (about 10 kB gzip) and
// stay inside the JavaScript budget (plan §5.8 (c)). Components that let callers override
// their styles (the shadcn/ui set in src/components/ui) use cn from ./utils.

export { clsx as cx } from 'clsx';
