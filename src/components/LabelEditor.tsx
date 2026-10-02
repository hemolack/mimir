import { useEffect, useRef, useState } from 'react'
import { FONT_FAMILY } from '../constants'
import { labelBox, linePoints, polylineMidpoint } from '../geometry'
import { usePaint } from '../theme'
import type { ElementMap, LineElement, ShapeElement, Viewport } from '../types'

interface LabelEditorProps {
  element: ShapeElement | LineElement
  map: ElementMap
  viewport: Viewport
  /** Replaces the existing label with this text when editing starts (type-to-label). */
  initialText?: string
  onCommit(text: string): void
  onCancel(): void
}

/** In-place textarea over a shape or line. Enter commits, Shift+Enter adds a line, Esc cancels. */
export function LabelEditor({ element, map, viewport, initialText, onCommit, onCancel }: LabelEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  const paint = usePaint()
  const [text, setText] = useState(initialText ?? element.label)

  useEffect(() => {
    const ta = ref.current
    if (!ta) return
    ta.focus()
    if (initialText === undefined) ta.select()
    else ta.setSelectionRange(ta.value.length, ta.value.length)
  }, [initialText])

  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    if (commit) onCommit(text)
    else onCancel()
  }

  const { zoom } = viewport
  let box: { x: number; y: number; w: number; h: number }
  if (element.type === 'shape') {
    const lb = labelBox(element.kind, element.w, element.h)
    box = { x: element.x + lb.x, y: element.y + lb.y, w: Math.max(lb.w, 120 / zoom), h: lb.h }
    if (lb.w < 120 / zoom) box.x -= (box.w - lb.w) / 2
  } else {
    const mid = polylineMidpoint(linePoints(element, map))
    box = { x: mid.x - 110 / zoom, y: mid.y - 30 / zoom, w: 220 / zoom, h: 60 / zoom }
  }

  // Rotated shapes: turn the editor with the shape, around the shape's center.
  let rotation: React.CSSProperties = {}
  if (element.type === 'shape' && element.rotation) {
    const cx = element.x + element.w / 2
    const cy = element.y + element.h / 2
    rotation = {
      transform: `rotate(${element.rotation}rad)`,
      transformOrigin: `${(cx - box.x) * zoom}px ${(cy - box.y) * zoom}px`,
    }
  }

  const fontSize = element.fontSize * zoom
  const lineCount = Math.max(1, text.split('\n').length)
  const height = lineCount * fontSize * 1.25 + 10

  return (
    <div
      className="label-editor"
      style={{
        left: box.x * zoom + viewport.x,
        top: box.y * zoom + viewport.y,
        width: box.w * zoom,
        height: box.h * zoom,
        ...rotation,
      }}
    >
      <textarea
        ref={ref}
        value={text}
        rows={lineCount}
        aria-label="Label"
        spellCheck
        style={{
          fontSize,
          fontFamily: FONT_FAMILY,
          height,
          color: paint.ink(element.stroke === 'none' ? '#1e1e1e' : element.stroke),
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            finish(true)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            finish(false)
          }
        }}
        onBlur={() => finish(true)}
      />
    </div>
  )
}
