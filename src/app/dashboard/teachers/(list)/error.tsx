'use client';

// The error boundary of /dashboard/teachers (milestone M09), in the route group (list) so that it does
// not also wrap /dashboard/teachers/new, which has its own: one boundary fewer keeps that route within
// its JavaScript budget (each boundary ships its own copy of LoadError). The page catches the failure of its own reads and
// shows the same state on the server (works without JavaScript); this boundary is for anything
// else, inside the app shell, with the boundary's retry().

import { LoadError } from '@/components/account/load-error';
import { LOAD_ERRORS } from '@/components/account/load-error-text';

export default function TeachersError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <LoadError {...LOAD_ERRORS.teachers} retry={retry} />;
}
