import type { Child, FC, PropsWithChildren } from '../'
import type { ErrorHandler, FallbackRender } from '../components'
import { DOM_ERROR_HANDLER } from '../constants'
import { Fragment, jsx } from './jsx-runtime'

/* eslint-disable @typescript-eslint/no-explicit-any */
export const ErrorBoundary: FC<
  PropsWithChildren<{
    fallback?: Child
    fallbackRender?: FallbackRender
    onError?: ErrorHandler
  }>
> = (({ children, fallback, fallbackRender, onError }: any) => {
  const res = Fragment({ children })
  ;(res as any)[DOM_ERROR_HANDLER] = (err: any) => {
    if (err instanceof Promise) {
      throw err
    }
    onError?.(err)
    return fallbackRender?.(err) || fallback
  }
  return res
}) as any

export const Suspense: FC<PropsWithChildren<{ fallback: any }>> = (({
  children,
  fallback,
}: any) => {
  const res = Fragment({ children })
  ;(res as any)[DOM_ERROR_HANDLER] = (err: any, retry: () => void) => {
    if (!(err instanceof Promise)) {
      throw err
    }
    err.finally(retry)
    // A falsy fallback (`null`, `false`, ...) is a valid, empty fallback; wrap it as a JSX node so
    // that it is not mistaken for "no fallback", which would let the promise escape render().
    // Do not call `Fragment()` directly: the node would be diffed against the suspended children.
    return fallback || jsx(Fragment, { children: fallback }, undefined)
  }
  return res
}) as any
/* eslint-enable @typescript-eslint/no-explicit-any */
