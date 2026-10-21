/** One ledger box: sans badge and mono meta on top, a body cut to a fixed height, "See all" to grow it. */

import { useRef } from 'react'
import type { ReactNode } from 'react'
import {
  CodeBlock, DiffBlock, IconCodeOutlineRegular, ReadBlock, SearchBlock, useClippedContent,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TrajectoryTranslate } from './locales.ts'
import { codeProgram } from './code-program.ts'
import type { TrajectoryCellProps, TrajectoryToolBody } from './trajectory-record.ts'
import type { ToolCardLabels } from '@deepseek-ai/dsh-client-ui-tool/client'
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
  /** Plain text of the preview: the re-measure signal, cheap to compare. */
  previewText: string
  /** Complete text shown while expanded; computed only when read. */
  full: () => string
  /** Rich body drawn instead of the text, when the tool has one (highlighted code, file, diff, matches). */
  rich?: { collapsed: ReactNode; expanded: ReactNode }
  tone: 'primary' | 'output' | 'error' | 'empty'
  /** The preview was cut before the text ended. */
  truncated: boolean
  /** Collapsed rich body is held to one line, so the section below keeps its line. */
  clamp?: 'line'
}

function isTruncated(text: string): boolean {
  return text.endsWith('…')
}

/** Keeps a click or key inside a rich body from reaching the ledger row around it. */
function stopRow(event: { stopPropagation: () => void }): void {
  event.stopPropagation()
}

/** Unfolded body height: the box's own clip does the cutting, so the body never folds its middle. */
const UNFOLDED = Number.MAX_SAFE_INTEGER

type Rich = NonNullable<CardSection['rich']>

function sameRich(node: ReactNode): Rich {
  return { collapsed: node, expanded: node }
}

/** The shell or program code; its header (language, copy) shows only when expanded. */
function codeRich(code: string, lang: string, labels: ToolCardLabels): Rich {
  return sameRich(
    <CodeBlock code={code} lang={lang} copyLabel={labels.copy} copiedLabel={labels.copied} />,
  )
}

/** The header subject of a rich body: the file path, or the search pattern. */
function subjectOf(body: TrajectoryToolBody | undefined): string | undefined {
  return body === undefined || body.kind === 'bash' ? undefined : body.label
}

/** Rich INPUT: the program source of a code call, the command of a shell call. */
function inputRich(cell: TrajectoryCellProps, labels: ToolCardLabels): Rich | undefined {
  const program = codeProgram(cell)
  if (program !== undefined) return codeRich(program.source, program.language ?? 'typescript', labels)
  if (cell.toolBody?.kind === 'bash') return codeRich(cell.toolBody.command, 'bash', labels)
  return undefined
}

/** Rich OUTPUT: the file view, the diff or the search matches of the call. */
function outputRich(cell: TrajectoryCellProps, labels: ToolCardLabels): Rich | undefined {
  const body = cell.toolBody
  if (body === undefined || body.kind === 'bash') return undefined
  if (body.kind === 'read') {
    return sameRich(<ReadBlock {...body.model} labels={labels.read} maxLines={UNFOLDED} />)
  }
  if (body.kind === 'diff') {
    return sameRich(<DiffBlock {...body.model.card} labels={labels.diff} maxLines={UNFOLDED} />)
  }
  return sameRich(<>
    <SearchBlock {...body.model.card} labels={labels.search} maxLines={UNFOLDED} />
    {body.model.recovery === undefined ? null : <div>{body.model.recovery}</div>}
  </>)
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
  labels: ToolCardLabels,
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
      previewText: `${callsBadge ?? ''}${displayText}`,
      full: () => content.fullText ?? cardFullText(cell),
      tone: empty && cell.kind === 'message' ? 'empty' : 'primary',
      truncated: isTruncated(displayText),
    }]
  }
  const inputBody = inputRich(cell, labels)
  const outputBody = outputRich(cell, labels)
  const args = toolCallText.args?.trim()
  const kind = cell.toolBody?.kind
  const sections: CardSection[] = []
  if (kind === 'diff') {
    // The diff takes the INPUT slot; a settled edit's routine success line adds nothing to the box.
    sections.push({
      key: 'input',
      ...(outputBody === undefined ? {} : { rich: outputBody }),
      preview: '',
      previewText: resultText ?? '',
      full: () => cardFullInput(cell) || args || '',
      tone: 'primary',
      truncated: false,
    })
    return sections
  }
  if (kind === 'read' || kind === 'search') {
    // The file view or the matches stand alone: their path or pattern is the header subject.
    if (resultText !== undefined) {
      sections.push({
        key: 'output',
        ...(outputBody === undefined ? {} : { rich: outputBody }),
        preview: resultText,
        previewText: resultText,
        full: () => cardFullOutput(cell) || resultText,
        tone: 'output',
        truncated: false,
      })
    }
    return sections
  }
  if (args !== undefined && args !== '') {
    sections.push({
      key: 'input',
      label: t('column.input'),
      ...(inputBody === undefined ? {} : { rich: inputBody }),
      preview: (
        <>
          {toolCallText.program && <IconCodeOutlineRegular className={css.programIcon} size={12} />}
          {args}
        </>
      ),
      previewText: args,
      full: () => cardFullInput(cell) || args,
      tone: 'primary',
      truncated: isTruncated(args),
      ...(kind === 'bash' ? { clamp: 'line' as const } : {}),
    })
  }
  if (resultText !== undefined) {
    const noOutput = resultText === t('record.noOutput')
    sections.push({
      key: 'output',
      label: t('column.output'),
      ...(outputBody === undefined ? {} : { rich: outputBody }),
      preview: resultText,
      previewText: resultText,
      full: () => cardFullOutput(cell) || resultText,
      tone: cell.isError === true ? 'error' : noOutput ? 'empty' : 'output',
      truncated: isTruncated(resultText),
      ...(kind === 'bash' ? { clamp: 'line' as const } : {}),
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
  /** Labels of the rich tool bodies. */
  toolLabels: ToolCardLabels
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
  expanded: expandedRequest,
  onToggle,
  t,
  toolLabels,
}: TrajectoryCardProps) {
  const compact = cardIsCompact(cell)
  // A calls-only box has no body to open.
  const expanded = expandedRequest && !compact
  const sections = compact ? [] : cardSections(cell, content, t, toolLabels)
  const subject = compact ? undefined : subjectOf(cell.toolBody)
  const bodyRef = useRef<HTMLDivElement>(null)
  const clipped = useClippedContent(
    bodyRef,
    sections.map(section => section.previewText).join('\u0000'),
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
        {subject !== undefined && <span className={css.cardSubject} title={subject}>{subject}</span>}
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
              {section.rich === undefined
                ? (
                  <span className={css.cardText} data-clamp={!expanded ? section.clamp : undefined}>
                    {section.lead}
                    {expanded ? section.full() : section.preview}
                  </span>
                )
                : (
                  // The body's own buttons (copy, wrap) act on the body, not on the row that selects or folds the call.
                  <div
                    className={css.cardRich}
                    data-collapsed={!expanded || undefined}
                    data-clamp={!expanded ? section.clamp : undefined}
                    onClick={stopRow}
                    onDoubleClick={stopRow}
                    onKeyDown={stopRow}
                  >
                    {expanded ? section.rich.expanded : section.rich.collapsed}
                  </div>
                )}
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
