import { Gradient as Fill } from '../../ui'

/** `bg-gradient-to-br from-X to-Y` drawn behind a box's content (absolute fill). */
export default function Gradient({
  from,
  to,
  fromOpacity = 1,
  toOpacity = 1,
  radius = 0,
}: {
  from: string
  to: string
  fromOpacity?: number
  toOpacity?: number
  radius?: number
}) {
  return (
    <Fill
      stops={[
        [0, from, fromOpacity],
        [1, to, toOpacity],
      ]}
      radius={radius}
    />
  )
}
