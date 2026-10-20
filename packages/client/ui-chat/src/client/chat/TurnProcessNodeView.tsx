import { memo, type ReactNode } from 'react'
import {
  IconChevronDownOutlineRegular,
  IconCloseCircleFillRegular,
  IconEditOutlineRegular,
  IconSearchOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComponentType } from 'react'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import { turnProcessAlwaysOpen, type TurnActivity } from '../contract/turn-process.ts'
import { formatRunDuration } from './message-chrome.ts'
import a11yCss from './accessibility.module.css'
import css from './TurnProcessNodeView.module.css'

type IconProps = { className?: string | undefined }
const svg = (className: string | undefined, d: ReactNode) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
)
const TerminalIcon = ({ className }: IconProps) => svg(className, <><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" /><path d="m4.75 6.25 2 1.75-2 1.75M8.5 10h2.75" /></>)
const WrenchIcon = ({ className }: IconProps) => svg(className, <path d="M10.2 2.2a3.3 3.3 0 0 0-3.1 4.4L2.4 11.3a1.4 1.4 0 0 0 2 2l4.7-4.7a3.3 3.3 0 0 0 4.4-3.1l-2 2-1.9-.4-.4-1.9z" />)
const RobotIcon = ({ className }: IconProps) => svg(className, <><rect x="2.5" y="5.25" width="11" height="8" rx="2" /><path d="M8 5.25V2.75M5.75 8.5v1M10.25 8.5v1M6 11.5h4" /></>)

const ACTIVITY_ICON: Record<TurnActivity, ComponentType<IconProps>> = {
  review: IconSearchOutlineRegular,
  deploy: TerminalIcon,
  other: WrenchIcon,
  code: IconEditOutlineRegular,
  proof: RobotIcon,
  error: IconCloseCircleFillRegular,
}

/** Settled Turn duration and process disclosure above its content. */
export const TurnProcessNodeView = memo(function TurnProcessNodeView({
  node, turnProcess, t,
}: ChatNodeViewProps<'turn-process'>) {
  if (turnProcess === undefined) throw new Error('turn-process node requires Turn process owner state')
  const open = !turnProcess.foldable || turnProcess.open
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  if (turn?.status !== 'closed') return null
  const canCollapse = turnProcess.foldable && turnProcess.hasContent && !turnProcessAlwaysOpen(node)
  const reason = turn.end?.data.reason.kind
  const stopped = reason === 'aborted' || reason === 'interrupted'
  const elapsedMs = turn.start === undefined || turn.end === undefined ? undefined
    : Math.max(1000, turn.end.time - turn.start.time)
  const duration = elapsedMs === undefined || stopped || reason === 'error' ? undefined
    : formatRunDuration(elapsedMs, t)
  // Other end reasons retain elapsed time; only stops and failure replace it.
  const label = stopped ? t('message.stopped')
    : reason === 'error' ? t('message.turnProcess.failed')
      : duration === undefined ? t('message.turnProcess.worked')
        : t('message.turnProcess.took')
  const announcement = stopped ? t('message.stopped')
    : reason === 'error' ? t('message.turnProcess.failed')
      : t('message.turnProcess.worked')
  return (
    <>
      <span className={a11yCss.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
      <button
        type="button"
        className={css.root}
        data-open={open || undefined}
        data-outcome={reason === 'error' ? 'failed' : reason === 'aborted' ? undefined : 'completed'}
        data-turn-process={node.data.turn}
        data-turn-process-messages={node.data.messageCount}
        data-turn-process-tool-calls={node.data.toolCallCount}
        data-turn-process-subagents={node.data.subagentCount}
        disabled={!canCollapse}
        aria-expanded={turnProcess.hasContent ? open : undefined}
        onClick={(event) => {
          event.currentTarget.focus()
          turnProcess.setOpen(!open)
        }}
      >
        <span className={css.pill}>
          <span className={css.dot} aria-hidden />
          <span className={css.label}>
            {label}
            {duration?.map((part, index) => (
              <span key={index} className={part.numeric ? css.durationNumber : undefined}>{part.text}</span>
            ))}
          </span>
        </span>
        {node.data.activity.length > 0 && (
          <span className={css.strip} aria-hidden>
            {node.data.activity.map((kind, index) => {
              const Icon = ACTIVITY_ICON[kind]
              return (
                <span key={index} className={css.cell} data-activity={kind} title={t(`message.turnProcess.activity.${kind}`)}>
                  <Icon className={css.cellIcon} />
                </span>
              )
            })}
          </span>
        )}
        {canCollapse && <IconChevronDownOutlineRegular className={css.chevron} />}
      </button>
    </>
  )
})
