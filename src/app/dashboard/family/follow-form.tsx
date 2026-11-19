// "Follow" and "Unfollow" of one person on /dashboard/family (ADR 0048). A Server Component (no
// client module): it works without JavaScript and the outcome comes back through the page. The
// state is in words on the button, never colour alone; the target is at least 44 px.

import { buttonVariants } from '@/components/ui/button-variants';
import { IDLE } from '@/lib/form-state';
import { followAction, unfollowAction } from './actions';

export function FollowForm({ slug, name, followed, country }: { slug: string; name: string; followed: boolean; country: string | null }) {
  return (
    <form action={(followed ? unfollowAction : followAction).bind(null, IDLE)} data-testid="family-follow-form">
      <input type="hidden" name="slug" value={slug} />
      {country ? <input type="hidden" name="country" value={country} /> : null}
      <button type="submit" className={buttonVariants({ variant: followed ? 'ghost' : 'secondary' })} data-testid={followed ? 'family-unfollow' : 'family-follow'}>
        {followed ? 'Unfollow' : 'Follow'}
        <span className="sr-only"> {name}</span>
      </button>
    </form>
  );
}
