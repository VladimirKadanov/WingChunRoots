// The fixed form ids of the billing part of /account/plan (M22) for the outcome of a post without JavaScript: the
// outcome address opens the page at that form's message (src/server/forms/flash.ts).

export const CHECKOUT_FORM = 'billing-checkout';
export const CANCEL_FORM = 'billing-cancel';
export const RESUME_FORM = 'billing-resume';
// M23: a change of plan or billing period, and taking back a scheduled one.
export const CHANGE_PLAN_FORM = 'billing-change-plan';
export const CANCEL_CHANGE_FORM = 'billing-cancel-change';
const PLAN_CODE = /^[a-z_]{1,40}$/;
/** The id of one change form: its plan and billing period (only known words, never anything else typed). */
export const changePlanFormId = (planCode: string, interval: string) =>
  `${CHANGE_PLAN_FORM}-${PLAN_CODE.test(planCode) ? planCode : 'plan'}-${interval === 'year' ? 'year' : 'month'}`;
/**
 * The id of one checkout form: an account's monthly offer keeps the plain id; its yearly offer
 * (owner decision 2026-11-27) and an organization's two offers (M23) name the billing period.
 */
export const checkoutFormId = (interval: string, organization: boolean) =>
  !organization && interval !== 'year' ? CHECKOUT_FORM : `${CHECKOUT_FORM}-${interval === 'year' ? 'year' : 'month'}`;
