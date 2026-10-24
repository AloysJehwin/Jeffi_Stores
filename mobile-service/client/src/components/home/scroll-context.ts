import { createContext, useContext } from 'react'
import type { SharedValue } from 'react-native-reanimated'

/** The home feed's vertical scroll offset (a UI-thread shared value), for sections that animate as they scroll into view. */
export const HomeScrollContext = createContext<SharedValue<number> | null>(null)

export const useHomeScrollY = () => useContext(HomeScrollContext)
