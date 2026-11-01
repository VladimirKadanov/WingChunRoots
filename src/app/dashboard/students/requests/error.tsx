'use client';

// The error boundary of /dashboard/students/requests (milestone M09). The page catches the failure of its own reads and
// shows the same state on the server (works without JavaScript); this boundary is for anything
// else, inside the app shell, with the boundary's retry().

import { LoadError } from '@/components/account/load-error';
import { STUDENT_REQUESTS_LOAD_ERROR } from '@/components/account/load-errors/student-requests';

export default function StudentRequestsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <LoadError {...STUDENT_REQUESTS_LOAD_ERROR} retry={retry} />;
}
