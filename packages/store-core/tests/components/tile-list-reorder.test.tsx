import { describe, it, expect, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import TileListEditor, { type Tile } from '@/components/admin/homepage/editors/TileListEditor'

afterEach(cleanup)

const FIELDS = [{ key: 'title', label: 'Title' }]

function Harness({ initial, onTiles }: { initial: Tile[]; onTiles: (t: Tile[]) => void }) {
  const [tiles, setTiles] = useState(initial)
  return (
    <TileListEditor
      label="Tiles"
      tiles={tiles}
      fields={FIELDS}
      blank={{ icon: '', title: '' }}
      disabled={false}
      onCommit={t => {
        setTiles(t)
        onTiles(t)
      }}
    />
  )
}

// fields.tsx renders an unassociated <label>, so match on the label's sibling input instead.
function titleInputs(): HTMLInputElement[] {
  return screen.getAllByText('Title').map(l => l.parentElement!.querySelector('input')!)
}

const THREE: Tile[] = [
  { icon: 'Truck', title: 'Wide Range' },
  { icon: 'Clock', title: 'Fast Delivery' },
  { icon: 'Shield', title: '24/7 Support' },
]

describe('TileListEditor reordering', () => {
  it('shows the reordered titles after moving a tile down', () => {
    let latest: Tile[] = []
    render(
      <Harness
        initial={THREE}
        onTiles={t => {
          latest = t
        }}
      />
    )

    fireEvent.click(screen.getAllByText('Down')[0])

    expect(latest.map(t => t.title)).toEqual(['Fast Delivery', 'Wide Range', '24/7 Support'])
    expect(titleInputs().map(i => i.value)).toEqual(['Fast Delivery', 'Wide Range', '24/7 Support'])
  })

  it('shows the reordered titles after moving a tile up', () => {
    render(<Harness initial={THREE} onTiles={() => {}} />)

    fireEvent.click(screen.getAllByText('Up')[2])

    expect(titleInputs().map(i => i.value)).toEqual(['Wide Range', '24/7 Support', 'Fast Delivery'])
  })

  it('does not write a stale title back when a reordered field is blurred', () => {
    let latest: Tile[] = []
    render(
      <Harness
        initial={THREE}
        onTiles={t => {
          latest = t
        }}
      />
    )

    fireEvent.click(screen.getAllByText('Down')[0])
    const first = titleInputs()[0]
    fireEvent.focus(first)
    fireEvent.blur(first)

    expect(latest.map(t => t.title)).toEqual(['Fast Delivery', 'Wide Range', '24/7 Support'])
  })

  it('keeps the reordered titles after an edit commits and the row moves', () => {
    render(<Harness initial={THREE} onTiles={() => {}} />)

    const second = titleInputs()[1]
    fireEvent.focus(second)
    fireEvent.change(second, { target: { value: 'Same Day Delivery' } })
    fireEvent.blur(second)
    expect(titleInputs().map(i => i.value)).toEqual(['Wide Range', 'Same Day Delivery', '24/7 Support'])

    fireEvent.click(screen.getAllByText('Up')[1])
    expect(titleInputs().map(i => i.value)).toEqual(['Same Day Delivery', 'Wide Range', '24/7 Support'])
  })

  it('does not overwrite text the user is still typing', () => {
    render(<Harness initial={THREE} onTiles={() => {}} />)

    const first = titleInputs()[0]
    fireEvent.focus(first)
    fireEvent.change(first, { target: { value: 'Wide Range of Too' } })

    fireEvent.click(screen.getAllByText('Down')[2])

    expect(titleInputs()[0].value).toBe('Wide Range of Too')
  })

  it('drops the removed tile rather than shifting stale values up', () => {
    render(<Harness initial={THREE} onTiles={() => {}} />)

    fireEvent.click(screen.getAllByText('Remove')[0])

    expect(titleInputs().map(i => i.value)).toEqual(['Fast Delivery', '24/7 Support'])
  })
})
