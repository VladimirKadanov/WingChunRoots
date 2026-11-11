// The billing provider of this process (milestone M22; docs/adr/0025-billing.md): the test provider
// unless BILLING_PROVIDER=stripe, which needs a Stripe test key (config.ts refuses anything else).
// One instance per process; the integration tests put their own in place (setBillingProvider).

import { billingProviderName, checkBillingSettings } from './config';
import { createStripeProvider } from './stripe';
import { createTestProvider, type TestBillingProvider } from './test-provider';
import type { BillingProvider } from './types';

let current: BillingProvider | null = null;

export function billingProvider(): BillingProvider {
  if (current) return current;
  checkBillingSettings();
  current = billingProviderName() === 'stripe' ? createStripeProvider() : createTestProvider();
  return current;
}

/** The test provider, when it is this process's provider; null otherwise (Stripe). */
export function testProvider(): TestBillingProvider | null {
  const provider = billingProvider();
  return provider.name === 'test' ? (provider as TestBillingProvider) : null;
}

/** Tests: use `provider` (null: make the configured one again on the next call). */
export function setBillingProvider(provider: BillingProvider | null): void {
  current = provider;
}
