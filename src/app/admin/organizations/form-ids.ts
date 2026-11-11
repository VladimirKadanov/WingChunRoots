// The fixed form ids of /admin/organizations/<id> (milestone M15), for a post without JavaScript
// (`anchor` in src/server/forms/flash.ts).

export const GRANT_FORM = 'organization-grant';
export const revokeForm = (grantId: string) => `organization-revoke-${grantId}`;
// M23: a Federation trial (docs/adr/0026-federation-billing.md).
export const TRIAL_START_FORM = 'organization-trial-start';
export const TRIAL_END_FORM = 'organization-trial-end';
