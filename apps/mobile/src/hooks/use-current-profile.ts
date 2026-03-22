import { getCurrentProfile } from '@festival/data-access';
import { useQuery } from '@tanstack/react-query';

export function useCurrentProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: () => getCurrentProfile(),
  });
}
