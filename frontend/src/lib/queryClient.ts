import { QueryClient } from '@tanstack/react-query'

/**
 * Shared TanStack Query client.
 *
 * Defaults chosen for an admin dashboard that polls a local appliance:
 * - `staleTime` 5s so rapidly-remounted panels reuse the cache instead of
 *   refiring identical requests (fixes the old per-component fetch storms).
 * - `refetchOnWindowFocus` keeps data fresh when the operator returns to the
 *   tab, but interval polling (see individual hooks) is paused while hidden.
 * - `retry` 1 — the API is local; failing fast surfaces real errors quickly.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
      // Don't burn requests polling a tab nobody is looking at.
      refetchIntervalInBackground: false,
    },
    mutations: {
      retry: 0,
    },
  },
})

/**
 * Central registry of query keys. Keeping them here prevents typo-drift and
 * makes targeted invalidation (`queryClient.invalidateQueries`) discoverable.
 */
export const queryKeys = {
  overview: ['overview'] as const,
  clients: (params?: Record<string, string>) => ['clients', params ?? {}] as const,
  metricsInterfaces: ['metrics', 'interfaces'] as const,
  metricsHistory: ['metrics', 'history'] as const,
  metricsRange: (minutes: number) => ['metrics', 'range', minutes] as const,
  metricsClients: ['metrics', 'clients'] as const,
  profiles: ['profiles'] as const,
  schedules: ['schedules'] as const,
  updates: ['updates'] as const,
  wireless: ['wireless'] as const,
  replayScenarios: ['replay', 'scenarios'] as const,
}
