import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { invalidateAfterBlockChange, queryKeys } from '../src/hooks/query-keys';

describe('invalidateAfterBlockChange', () => {
  it("removes a newly blocked user's cached position at once, in every crew", async () => {
    const queryClient = new QueryClient();
    const crewA = queryKeys.friendLocations('me', 'crew-a');
    const crewB = queryKeys.friendLocations('me', 'crew-b');
    queryClient.setQueryData(crewA, [{ user_id: 'blocked' }, { user_id: 'friend' }]);
    queryClient.setQueryData(crewB, [{ user_id: 'blocked' }]);

    await invalidateAfterBlockChange(queryClient, 'blocked');

    expect(queryClient.getQueryData(crewA)).toEqual([{ user_id: 'friend' }]);
    expect(queryClient.getQueryData(crewB)).toEqual([]);
    expect(queryClient.getQueryState(crewA)?.isInvalidated).toBe(true);
    queryClient.clear();
  });
});
