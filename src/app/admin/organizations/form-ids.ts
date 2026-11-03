// The fixed form ids of /admin/organizations/<id> (milestone M15), for a post without JavaScript
// (`anchor` in src/server/forms/flash.ts).

export const GRANT_FORM = 'organization-grant';
export const revokeForm = (grantId: string) => `organization-revoke-${grantId}`;
