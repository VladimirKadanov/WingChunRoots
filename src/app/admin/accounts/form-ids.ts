// The fixed form ids of /admin/accounts for a page that shows the outcome of a post without
// JavaScript: the outcome address opens the page at that form's error or message (`anchor` in
// src/server/forms/flash.ts). Otherwise the forms use useFormId(), since a page kept hidden by the
// router can be in the document twice.

export const SUSPEND_FORM = 'suspend-account';
export const unsuspendForm = (userId: string) => `unsuspend-account-${userId}`;
export const ERASE_FORM = 'erase-account';
