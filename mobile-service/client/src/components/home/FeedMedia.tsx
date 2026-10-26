import Animated from 'react-native-reanimated'
import { Media, type MediaProps } from '../../ui'
import { useOnScreen } from './scroll-context'

const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const

/** Media in the home feed: a clip plays only while it is on screen (and `active`). */
export default function FeedMedia(props: MediaProps) {
  return props.video ? <Watched {...props} /> : <Media {...props} />
}

function Watched({ style, active = true, ...props }: MediaProps) {
  const { ref, onLayout, onScreen } = useOnScreen()
  return (
    <Animated.View ref={ref} onLayout={onLayout} collapsable={false} pointerEvents="none" style={style}>
      <Media {...props} style={FILL} active={active && onScreen} />
    </Animated.View>
  )
}
