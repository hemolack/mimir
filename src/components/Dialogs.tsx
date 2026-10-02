import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * In-app replacements for window.prompt/confirm. Browser dialogs are blocked or
 * unsupported in some embedded browsers (prompt() throws, confirm() returns
 * false), and they can't be themed, so the app uses its own.
 */

function DialogShell(props: { title: string; onClose(): void; children: ReactNode; footer: ReactNode }) {
  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div
        className="dialog panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') props.onClose()
        }}
      >
        <h2 id="app-dialog-title">{props.title}</h2>
        {props.children}
        <div className="dialog-actions">{props.footer}</div>
      </div>
    </div>
  )
}

/** Ask for a line of text (or show one to copy, with `readOnly`). */
export function TextDialog(props: {
  title: string
  label: string
  initial: string
  submitLabel: string
  maxLength?: number
  readOnly?: boolean
  note?: string
  onSubmit(value: string): void
  onClose(): void
}) {
  const [value, setValue] = useState(props.initial)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const trimmed = value.trim()
  const submit = () => {
    if (props.readOnly || trimmed) props.onSubmit(trimmed)
  }

  return (
    <DialogShell
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          {!props.readOnly && (
            <button type="button" className="btn" onClick={props.onClose}>
              Cancel
            </button>
          )}
          <button type="button" className="btn primary" onClick={submit} disabled={!props.readOnly && !trimmed}>
            {props.submitLabel}
          </button>
        </>
      }
    >
      <label className="dialog-field">
        <span className="field-label">{props.label}</span>
        <input
          ref={inputRef}
          className="dialog-input"
          value={value}
          maxLength={props.maxLength}
          readOnly={props.readOnly}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
        />
      </label>
      {props.note && <p className="dialog-note">{props.note}</p>}
    </DialogShell>
  )
}

/** Ask the user to confirm an action. */
export function ConfirmDialog(props: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm(): void
  onClose(): void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => confirmRef.current?.focus(), [])
  return (
    <DialogShell
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`btn primary${props.danger ? ' danger' : ''}`}
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </button>
        </>
      }
    >
      <p className="dialog-message">{props.message}</p>
    </DialogShell>
  )
}
