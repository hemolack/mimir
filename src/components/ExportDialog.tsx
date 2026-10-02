import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ExportFormat } from '../exporters'
import type { PageSize } from '../exportLayout'
import type { Theme } from '../theme'

export interface ExportChoice {
  format: ExportFormat
  selectionOnly: boolean
  /** Color scheme of the exported file, independent of the screen. */
  theme: Theme
  background: 'solid' | 'transparent'
  scale: number
  page: PageSize
}

interface ExportDialogProps {
  selectionCount: number
  initial: ExportChoice
  /** Pixel size a PNG would have with these settings (null if there's nothing to export). */
  pngSize(choice: ExportChoice): { width: number; height: number; clamped: boolean } | null
  onExport(choice: ExportChoice): Promise<void>
  onClose(): void
}

function Segmented<T extends string | number>(props: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange(v: T): void
}) {
  return (
    <div className="field">
      <span className="field-label" id={`seg-${props.label}`}>
        {props.label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={`seg-${props.label}`}>
        {props.options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={props.value === o.value}
            className={props.value === o.value ? 'active' : ''}
            onClick={() => props.onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const FORMAT_NOTES: Record<ExportFormat, ReactNode> = {
  png: 'An image, good for chat, slides and documents.',
  pdf: 'Vector, so it stays sharp at any zoom and prints cleanly.',
  svg: 'Vector, editable in design tools like Figma or Illustrator.',
}

export function ExportDialog(p: ExportDialogProps) {
  const [choice, setChoice] = useState<ExportChoice>(() => ({
    ...p.initial,
    selectionOnly: p.initial.selectionOnly && p.selectionCount > 0,
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const set = (patch: Partial<ExportChoice>) => setChoice((c) => ({ ...c, ...patch }))

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
  }, [])

  const size = choice.format === 'png' ? p.pngSize(choice) : null

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await p.onExport(choice)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.')
      setBusy(false)
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) p.onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="dialog panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape' && !busy) p.onClose()
          if (e.key === 'Enter' && !busy && (e.target as HTMLElement).tagName !== 'BUTTON') void run()
        }}
      >
        <h2 id="export-title">Export</h2>

        <Segmented
          label="Format"
          value={choice.format}
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'pdf', label: 'PDF' },
            { value: 'svg', label: 'SVG' },
          ]}
          onChange={(format) => set({ format })}
        />
        <p className="field-note">{FORMAT_NOTES[choice.format]}</p>

        <Segmented
          label="Include"
          value={choice.selectionOnly ? 'sel' : 'all'}
          options={[
            { value: 'all', label: 'Whole board' },
            ...(p.selectionCount > 0
              ? [{ value: 'sel', label: `Selection (${p.selectionCount})` }]
              : []),
          ]}
          onChange={(v) => set({ selectionOnly: v === 'sel' })}
        />

        <Segmented
          label="Colors"
          value={choice.theme}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={(theme) => set({ theme })}
        />

        {choice.format !== 'pdf' && (
          <Segmented
            label="Background"
            value={choice.background}
            options={[
              { value: 'solid', label: choice.theme === 'dark' ? 'Dark gray' : 'White' },
              { value: 'transparent', label: 'Transparent' },
            ]}
            onChange={(background) => set({ background })}
          />
        )}

        {choice.format === 'png' && (
          <>
            <Segmented
              label="Resolution"
              value={choice.scale}
              options={[
                { value: 1, label: '1×' },
                { value: 2, label: '2×' },
                { value: 3, label: '3×' },
              ]}
              onChange={(scale) => set({ scale })}
            />
            {size && (
              <p className="field-note">
                {size.width} × {size.height} px{size.clamped ? ' (reduced to the largest size browsers allow)' : ''}
              </p>
            )}
          </>
        )}

        {choice.format === 'pdf' && (
          <Segmented
            label="Page"
            value={choice.page}
            options={[
              { value: 'fit', label: 'Fit drawing' },
              { value: 'a4', label: 'A4' },
              { value: 'letter', label: 'Letter' },
            ]}
            onChange={(page) => set({ page })}
          />
        )}

        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={p.onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={run} disabled={busy}>
            {busy ? 'Exporting…' : `Export ${choice.format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  )
}
