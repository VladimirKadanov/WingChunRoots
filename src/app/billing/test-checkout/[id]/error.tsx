'use client';

// The error boundary of the test checkout page (M22), inside the app shell.

import { LoadError } from '@/components/account/load-error';
import { TEST_CHECKOUT_LOAD_ERROR } from '@/components/account/load-errors/test-checkout';

export default function TestCheckoutError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <LoadError {...TEST_CHECKOUT_LOAD_ERROR} retry={retry} />;
}
