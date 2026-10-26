import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { appConfigQuery } from '../api/appConfig'
import { imageSource } from '../lib/links'

/** imageSource bound to the backend's image_resize flag: originals until the config says the host resizes. */
export function useImageSource() {
  const { data: resize = false } = useQuery({ ...appConfigQuery, select: c => c.image_resize === true })
  return useCallback((url: string | null | undefined, width: number) => imageSource(url, width, resize), [resize])
}
