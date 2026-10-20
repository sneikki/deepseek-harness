/** One ledger box: sans badge and mono meta on top, a body cut to a fixed height, "See all" to grow it. */

import { useRef } from 'react'
import type { ReactNode } from 'react'
import { IconCodeOutlineRegular, useClippedContent } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TrajectoryTranslate } from './locales.ts'
import type { TrajectoryCellProps } from './trajectory-record.ts'
import { cardFullInput, cardFullOutput, cardFullText, cardIsCompact } from './trajectory-card.ts'
import css from './TrajectoryTable.module.css'

/** Text parts of one ledger row, as produced by the table's record presentation. */
export interface TrajectoryCardContent {
  displayText: string
  resultText: string | undefined
  callsBadge: string | undefined
  toolCallText: { program: boolean; name: string; args?: string } | undefined
  /** Complete text of a non-tool box whose text is not the record's own (subagent notices). */
  fullText?: string
}

interface CardSection {
  key: 'input' | 'output' | 'text'
  /** Section label of a tool box; plain text boxes have none. */
  label?: string
  /** Pill shown before the text (the tools an assistant step chose). */
  lead?: ReactNode
  /** Bounded preview shown while collapsed. */
  preview: ReactNode
  /** Complete text shown while expanded. */
  full: string
  tone: 'primary' | 'output' | 'error' | 'empty'
  /** The preview was cut before the text ended. */
  truncated: boolean
}

function isTruncated(text: string): boolean {
  return text.endsWith('…')
}

/**
 * Split a row into its box sections. A tool box has an Input section only when the
 * call carries a payload and an Output section only once there is a result.
 * @param cell - Record behind the box.
 * @param content - Preview text parts of the row.
 * @param t - Trajectory locale translator.
 * @returns Sections in display order.
 */
export function cardSections(
  cell: TrajectoryCellProps,
  content: TrajectoryCardContent,
  t: TrajectoryTranslate,
): CardSection[] {
  const { toolCallText, resultText, displayText, callsBadge } = content
  if (toolCallText === undefined) {
    const lead = callsBadge === undefined
      ? undefined
      : <span className={css.callsBadge}>{callsBadge}</span>
    const empty = displayText === '' && callsBadge === undefined
    return [{
      key: 'text',
      ...(lead === undefined ? {} : { lead }),
      preview: empty
        ? cell.kind === 'message' ? t('record.noOutput') : '—'
        : displayText,
      full: content.fullText ?? cardFullText(cell),
      tone: empty && cell.kind === 'message' ? 'empty' : 'primary',
      truncated: isTruncated(displayText),
    }]
  }
  const sections: CardSection[] = []
  const args = toolCallText.args?.trim()
  if (args !== undefined && args !== '') {
    sections.push({
      key: 'input',
      label: t('column.input'),
      preview: (
        <>
          {toolCallText.program && <IconCodeOutlineRegular className={css.programIcon} size={12} />}
          {args}
        </>
      ),
      full: cardFullInput(cell) || args,
      tone: 'primary',
      truncated: isTruncated(args),
    })
  }
  if (resultText !== undefined) {
    const noOutput = resultText === t('record.noOutput')
    sections.push({
      key: 'output',
      label: t('column.output'),
      preview: resultText,
      full: cardFullOutput(cell) || resultText,
      tone: cell.isError === true ? 'error' : noOutput ? 'empty' : 'output',
      truncated: isTruncated(resultText),
    })
  }
  return sections
}

/** Props of {@link TrajectoryCard}. */
export interface TrajectoryCardProps {
  cell: TrajectoryCellProps
  content: TrajectoryCardContent
  /** Sans badge text: the humanised tool name or kind label. */
  badge: string
  badgeTitle: string
  /** Mono meta on the right of the header. */
  meta?: string
  /**
   * Header slot after the badge, left empty today: the subagent lifecycle pill and
   * badges render here once their data lands.
   */
  lifecycle?: ReactNode
  expanded: boolean
  onToggle: () => void
  t: TrajectoryTranslate
}

/**
 * Render one ledger box. Every collapsed box has the same height; text past the
 * body is cut and a "See all" control appears only then.
 * @param props - Record, preview parts, header texts and expansion state.
 * @returns The box element.
 */
export function TrajectoryCard({
  cell,
  content,
  badge,
  badgeTitle,
  meta,
  lifecycle,
  expanded,
  onToggle,
  t,
}: TrajectoryCardProps) {
  const compact = cardIsCompact(cell)
  const sections = compact ? [] : cardSections(cell, content, t)
  const bodyRef = useRef<HTMLDivElement>(null)
  const clipped = useClippedContent(
    bodyRef,
    sections.map(section => section.full).join('\u0000'),
    '[data-clip]',
  )
  const more = (!expanded && clipped) || sections.some(section => section.truncated)
  return (
    <div
      className={css.card}
      data-card=""
      data-compact={compact || undefined}
      data-expanded={expanded || undefined}
    >
      <div className={css.cardHead}>
        <span className={css.cardBadge} title={badgeTitle}>{badge}</span>
        {compact && <span className={css.callsBadge}>{content.callsBadge}</span>}
        <span className={css.cardLifecycle} data-card-slot="lifecycle">{lifecycle}</span>
        {meta !== undefined && <span className={css.cardMeta}>{meta}</span>}
      </div>
      {!compact && (
        <div
          ref={bodyRef}
          className={css.cardBody}
          data-clipped={!expanded && more || undefined}
        >
          {sections.map(section => (
            <div
              key={section.key}
              className={css.cardSection}
              data-section={section.key}
              data-clip=""
              data-tone={section.tone}
            >
              {section.label !== undefined && (
                <span className={css.cardSectionLabel}>{section.label}</span>
              )}
              <span className={css.cardText}>
                {section.lead}
                {expanded ? section.full : section.preview}
              </span>
            </div>
          ))}
        </div>
      )}
      {(expanded || more) && (
        <button
          type="button"
          className={css.cardMore}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
          onDoubleClick={(event) => { event.stopPropagation() }}
        >
          {expanded ? t('card.showLess') : t('card.seeAll')}
        </button>
      )}
    </div>
  )
}
