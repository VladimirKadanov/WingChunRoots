// The words of the error state of the archive editor (milestone M26) (../load-error.tsx). One module
// per page: see ../load-error.tsx.

export const ARCHIVE_LOAD_ERROR = {
  eyebrow: 'Archive editor',
  title: 'Archive editor',
  message: "We couldn't load the archive. Nothing was changed.",
  back: { href: '/admin', label: 'Back to administration' },
} as const;
