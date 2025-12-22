import { useCallback, useEffect, useState, useRef } from 'react'

/**
 * Configuration options for the useLocalStorage hook
 * @template T - The type of the value stored in local storage
 */
export interface UseLocalStorageOptions<T> {
  serializer?: {
    parse: (value: string) => T
    stringify: (value: T) => string
  }
  validator?: (value: any) => T
  debounceMs?: number
  syncAcrossInstances?: boolean
  onError?: (error: Error) => void
}

export interface UseLocalStorageActions {
  loading: boolean
  error: Error | null
  remove: () => void
  reset: () => void
}

export type UseLocalStorageReturn<T> = [
  T,
  (value: T | ((prevValue: T) => T)) => void,
  UseLocalStorageActions
]

const defaultSerializer = {
  parse: JSON.parse,
  stringify: JSON.stringify
}

const getStorageValue = <T>(
  key: string,
  defaultValue: T,
  serializer: typeof defaultSerializer,
  validator?: (value: any) => T
): T => {
  if (globalThis.window === undefined) {
    return defaultValue
  }
  try {
    const item = globalThis.localStorage.getItem(key)
    if (item === null) {
      return defaultValue
    }
    const parsed = serializer.parse(item)
    return typeof validator === 'function' ? validator(parsed) : parsed
  } catch (error) {
    console.warn(`Error reading localStorage key "${key}":`, error)
    return defaultValue
  }
}

const setStorageValue = <T>(key: string, value: T, serializer: typeof defaultSerializer): void => {
  if (globalThis.window === undefined) {
    return
  }
  try {
    const serializedValue = serializer.stringify(value)
    globalThis.localStorage.setItem(key, serializedValue)
    globalThis.dispatchEvent(
      new CustomEvent('localStorageChange', {
        detail: { key, value }
      })
    )
  } catch (error) {
    console.error(`Error setting localStorage key "${key}":`, error)
    throw error
  }
}

const removeStorageValue = (key: string): void => {
  if (globalThis.window === undefined) {
    return
  }
  try {
    globalThis.localStorage.removeItem(key)
    globalThis.dispatchEvent(
      new CustomEvent('localStorageChange', {
        detail: { key, value: null }
      })
    )
  } catch (error) {
    console.error(`Error removing localStorage key "${key}":`, error)
    throw error
  }
}

const useDebounce = <T extends (...args: any[]) => any>(callback: T, delay: number): T => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  return useCallback(
    ((...args: Parameters<T>) => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args)
      }, delay)
    }) as T,
    [callback, delay]
  )
}

export function useLocalStorage<T> (
  key: string,
  defaultValue: T,
  options: UseLocalStorageOptions<T> = {}
): UseLocalStorageReturn<T> {
  const {
    serializer = defaultSerializer,
    validator,
    debounceMs = 0,
    syncAcrossInstances = true,
    onError
  } = options

  const [storedValue, setStoredValue] = useState<T>(() =>
    getStorageValue(key, defaultValue, serializer, validator)
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const isInitialMount = useRef(true)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const handleError = useCallback((err: Error) => {
    setError(err)
    if (onErrorRef.current !== null && onErrorRef.current !== undefined) {
      onErrorRef.current(err)
    }
  }, [])

  const setValueInternal = useCallback(
    (value: T) => {
      try {
        setLoading(true)
        setError(null)
        setStorageValue(key, value, serializer)
        setStoredValue(value)
      } catch (err) {
        handleError(err as Error)
      } finally {
        setLoading(false)
      }
    },
    [key, serializer, handleError]
  )

  const debouncedSetValue = useDebounce(setValueInternal, debounceMs)

  const setValue = useCallback(
    (value: T | ((prevValue: T) => T)) => {
      const newValue =
        typeof value === 'function' ? (value as (prevValue: T) => T)(storedValue) : value

      if (validator !== null && validator !== undefined) {
        try {
          const validatedValue = validator(newValue)
          if (debounceMs > 0) {
            debouncedSetValue(validatedValue)
          } else {
            setValueInternal(validatedValue)
          }
        } catch (err) {
          handleError(err as Error)
        }
      } else {
        if (debounceMs > 0) {
          debouncedSetValue(newValue)
        } else {
          setValueInternal(newValue)
        }
      }
    },
    [storedValue, validator, debounceMs, debouncedSetValue, setValueInternal, handleError]
  )

  const remove = useCallback(() => {
    try {
      setLoading(true)
      setError(null)
      removeStorageValue(key)
      setStoredValue(defaultValue)
    } catch (err) {
      handleError(err as Error)
    } finally {
      setLoading(false)
    }
  }, [key, defaultValue, handleError])

  const reset = useCallback(() => {
    setValue(defaultValue)
  }, [setValue, defaultValue])

  useEffect(() => {
    if (!syncAcrossInstances) return

    const handleStorageChange = (e: CustomEvent): void => {
      const { key: changedKey, value } = e.detail
      if (changedKey === key) {
        if (value === null) {
          setStoredValue(defaultValue)
        } else {
          try {
            const validatedValue =
              validator !== null && validator !== undefined ? validator(value) : value
            setStoredValue(validatedValue as T)
          } catch (err) {
            handleError(err as Error)
          }
        }
      }
    }

    globalThis.addEventListener('localStorageChange', handleStorageChange as EventListener)
    return () => {
      globalThis.removeEventListener('localStorageChange', handleStorageChange as EventListener)
    }
  }, [key, defaultValue, validator, syncAcrossInstances, handleError])

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }

    const currentValue = getStorageValue(key, defaultValue, serializer, validator)
    if (currentValue !== storedValue) {
      setStoredValue(currentValue)
    }
  }, [key, defaultValue, serializer, validator, storedValue])

  return [
    storedValue,
    setValue,
    {
      loading,
      error,
      remove,
      reset
    }
  ]
}

export default useLocalStorage

// The implementation should be copied from useSessionStorage, replacing sessionStorage with localStorage
