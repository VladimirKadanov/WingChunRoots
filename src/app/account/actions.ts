'use server';

// The account page's Server Action (milestone M02): signing out is a thin wrapper over Better
// Auth's POST /api/auth/sign-out (src/server/rpc/parity.ts), which ends this session.

import { redirect } from 'next/navigation';

import { authAction } from '@/server/auth/web';

export async function signOutAction(): Promise<void> {
  await authAction('/sign-out', { body: {} });
  redirect('/sign-in?signed-out=1');
}
