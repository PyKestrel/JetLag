import { useState, useEffect, useCallback } from 'react'

interface UseApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: true,
    error: null,
  })

  const refetch = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const data = await fetcher()
      setState({ data, loading: false, error: null })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setState({ data: null, loading: false, error: message })
    }
  }, deps)

  useEffect(() => {
    refetch()
  }, [refetch])

  return { ...state, refetch }
}
