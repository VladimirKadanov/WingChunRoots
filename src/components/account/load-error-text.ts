// What the error state of each M08 page says (M08 final check, requirements-2): the same words
// whether the page caught the failure of its own read (rendered on the server, with a "Try again"
// link) or an error.tsx boundary caught something else (with the boundary's retry). A plain module,
// so server pages and the client boundaries both read the values (src/components/account/load-error.tsx).

export const LOAD_ERRORS = {
  dashboard: {
    eyebrow: 'Dashboard',
    title: 'Your dashboard',
    message: "We couldn't load your dashboard. Nothing was changed.",
    back: { href: '/', label: 'Back to Explore' },
  },
  settings: {
    eyebrow: 'Dashboard',
    title: 'Account type and plan',
    message: "We couldn't load your account type and plan. Nothing was changed.",
    back: { href: '/dashboard', label: 'Back to the dashboard' },
  },
  // M07: the profile editor and the privacy page.
  profile: {
    eyebrow: 'Dashboard',
    title: 'Your profile',
    message: "We couldn't load your profile. Nothing was changed.",
    back: { href: '/dashboard', label: 'Back to the dashboard' },
  },
  privacy: {
    eyebrow: 'Your account',
    title: 'Privacy and consents',
    message: "We couldn't load your consents. Nothing was changed.",
    back: { href: '/account', label: 'Back to your account' },
  },
  grants: {
    eyebrow: 'Administration',
    title: 'Plan grants',
    message: "We couldn't load the plan grants. Nothing was changed.",
    back: { href: '/admin', label: 'Back to administration' },
  },
  // M09: teacher requests.
  teachers: {
    eyebrow: 'Dashboard',
    title: 'Your teachers',
    message: "We couldn't load your teachers and requests. Nothing was changed.",
    back: { href: '/dashboard', label: 'Back to the dashboard' },
  },
  newTeacher: {
    eyebrow: 'Your teachers',
    title: 'Name a teacher',
    message: "We couldn't load the request form. Nothing was sent.",
    back: { href: '/dashboard/teachers', label: 'Back to your teachers' },
  },
  studentRequests: {
    eyebrow: 'Dashboard',
    title: 'Student requests',
    message: "We couldn't load your student requests. Nothing was changed.",
    back: { href: '/dashboard', label: 'Back to the dashboard' },
  },
  // M11: the Sifu's schools.
  schools: {
    eyebrow: 'Dashboard',
    title: 'Your schools',
    message: "We couldn't load your schools. Nothing was changed.",
    back: { href: '/dashboard', label: 'Back to the dashboard' },
  },
  school: {
    eyebrow: 'Your schools',
    title: 'Your school',
    message: "We couldn't load this school. Nothing was changed.",
    back: { href: '/dashboard/schools', label: 'Back to your schools' },
  },
} as const;
