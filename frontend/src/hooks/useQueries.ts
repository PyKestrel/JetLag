/**
 * Shared TanStack Query hooks.
 *
 * Replaces the ad-hoc `useApi` hook (which had a stale-deps foot-gun in its
 * `useCallback(fetcher, deps)`) with a cached, deduped, background-refetching
 * data layer. Polling is expressed declaratively via `refetchInterval`; the
 * client is configured with `refetchIntervalInBackground: false` so polling
 * pauses automatically when the browser tab is hidden.
 */
import { useQuery } from '@tanstack/react-query'

import {
  getOverview,
  getInterfaceMetrics,
  getMetricsHistory,
  getMetricsRange,
  getClientMetrics,
} from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'

export function useOverview(refetchInterval = 5_000) {
  return useQuery({
    queryKey: queryKeys.overview,
    queryFn: getOverview,
    refetchInterval,
  })
}

export function useInterfaceMetrics(refetchInterval = 2_000) {
  return useQuery({
    queryKey: queryKeys.metricsInterfaces,
    queryFn: getInterfaceMetrics,
    refetchInterval,
  })
}

export function useMetricsHistory(refetchInterval = 2_000) {
  return useQuery({
    queryKey: queryKeys.metricsHistory,
    queryFn: getMetricsHistory,
    refetchInterval,
  })
}

export function useMetricsRange(minutes: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.metricsRange(minutes),
    queryFn: () => getMetricsRange(minutes),
    enabled,
    refetchInterval: enabled ? 15_000 : false,
  })
}

export function useClientMetrics(enabled = true, refetchInterval = 3_000) {
  return useQuery({
    queryKey: queryKeys.metricsClients,
    queryFn: getClientMetrics,
    enabled,
    refetchInterval: enabled ? refetchInterval : false,
  })
}
