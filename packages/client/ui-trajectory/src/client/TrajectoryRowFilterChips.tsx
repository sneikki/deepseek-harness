/** Segmented All / Messages / Tools control for the ledger toolbar. */

import type { TrajectoryTranslate } from './locales.ts'
import type { TrajectoryRowCounts, TrajectoryRowFilter } from './trajectory-noise.ts'
import css from './TrajectoryRowFilterChips.module.css'

const FILTERS = ['all', 'messages', 'tools'] as const

/**
 * Render the row-kind filter chips with their counts.
 * @param props - selected chip, counts, and change handler.
 * @returns the segmented control.
 */
export function TrajectoryRowFilterChips({ value, counts, onChange, t }: {
  value: TrajectoryRowFilter
  counts: TrajectoryRowCounts
  onChange: (filter: TrajectoryRowFilter) => void
  t: TrajectoryTranslate
}) {
  return (
    <div role="group" aria-label={t('toolbar.filter')} className={css.root}>
      {FILTERS.map(filter => (
        <button
          key={filter}
          type="button"
          className={css.chip}
          aria-pressed={value === filter}
          onClick={() => { onChange(filter) }}
        >
          {t(`toolbar.filter.${filter}`)}
          <span className={css.count}>{counts[filter]}</span>
        </button>
      ))}
    </div>
  )
}
