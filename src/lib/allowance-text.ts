// The sentences of a plan's allowance (plan §5.6, CLAUDE.md §11): how much of it an account uses,
// in calm words, with no urgency. An account can hold more than its plan includes (after a
// downgrade, or when a grant ends): nothing it has is taken away, and the sentence says so plainly
// instead of "3 of 1" (M16, owner review of /dashboard/photos).

/** How a feature counts: "photo" / "photos", "added". */
export interface AllowanceUnit {
  one: string;
  many: string;
  verb: string;
}

const counted = (unit: AllowanceUnit, n: number) => `${n.toLocaleString('en')} ${n === 1 ? unit.one : unit.many}`;

/**
 * The allowance sentence: "You have added 1 of 1 photo on Free Student."; with no set limit,
 * "You have added 4 photos on Federation, which has no set limit."; over the limit, "You have 3
 * photos; Free Student includes 1." and, where the account can make room by removing some
 * (`removable`), how many to remove before it can add another.
 */
export function allowanceSentence(unit: AllowanceUnit, used: number, limit: number | null, planName: string, removable = false): string {
  if (limit === null) return `You have ${unit.verb} ${counted(unit, used)} on ${planName}, which has no set limit.`;
  if (used <= limit) return `You have ${unit.verb} ${used.toLocaleString('en')} of ${counted(unit, limit)} on ${planName}.`;
  const over = `You have ${counted(unit, used)}; ${planName} includes ${limit.toLocaleString('en')}.`;
  return removable ? `${over} Remove ${(used - limit + 1).toLocaleString('en')} to add another.` : over;
}

/** The short allowance beside a list: "5 of 5 approved on Free Sifu", over the limit "7 approved; Free Sifu includes 5". */
export function allowanceShort(verb: string, used: number, limit: number | null, planName: string): string {
  if (limit === null) return `${used.toLocaleString('en')} ${verb}, no limit on ${planName}`;
  if (used <= limit) return `${used.toLocaleString('en')} of ${limit.toLocaleString('en')} ${verb} on ${planName}`;
  return `${used.toLocaleString('en')} ${verb}; ${planName} includes ${limit.toLocaleString('en')}`;
}
