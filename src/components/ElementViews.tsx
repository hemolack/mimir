import { memo, useMemo } from 'react'
import { getStroke } from 'perfect-freehand'
import { FONT_FAMILY } from '../constants'
import {
  capFillColor,
  capInset,
  capPath,
  trimPolyline,
  dashArray,
  doubleRails,
  offsetPolyline,
  labelBox,
  polylineMidpoint,
  linePath,
  shapeDetail,
  shapePath,
  svgPathFromStroke,
} from '../geometry'
import { bezierPath } from '../curveFit'
import type { CurveElement, LineElement, PathElement, Point, Rect, Routing, ShapeElement } from '../types'

const labelColor = (stroke: string) => (stroke === 'none' || stroke === 'transparent' ? '#1e1e1e' : stroke)

/** Labels use foreignObject so text wraps; inline styles keep SVG export self-contained. */
function ShapeLabel({ box, text, color, fontSize }: { box: Rect; text: string; color: string; fontSize: number }) {
  return (
    <foreignObject
      x={box.x}
      y={box.y}
      width={Math.max(box.w, 1)}
      height={Math.max(box.h, 1)}
      pointerEvents="none"
      style={{ overflow: 'visible' }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: 4,
          boxSizing: 'border-box',
          color,
          fontSize,
          fontFamily: FONT_FAMILY,
          lineHeight: 1.25,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          userSelect: 'none',
        }}
      >
        {text}
      </div>
    </foreignObject>
  )
}

export const ShapeView = memo(function ShapeView({ el, hideLabel }: { el: ShapeElement; hideLabel: boolean }) {
  const isText = el.kind === 'text'
  const detail = shapeDetail(el.kind, el.w, el.h)
  const dash = dashArray(el.dash, el.strokeWidth)
  const rotate = el.rotation ? ` rotate(${(el.rotation * 180) / Math.PI} ${el.w / 2} ${el.h / 2})` : ''
  const flip =
    el.flipX || el.flipY
      ? `translate(${el.flipX ? el.w : 0} ${el.flipY ? el.h : 0}) scale(${el.flipX ? -1 : 1} ${el.flipY ? -1 : 1})`
      : undefined
  return (
    <g data-id={el.id} transform={`translate(${el.x} ${el.y})${rotate}`}>
      <g transform={flip}>
        <path
          d={shapePath(el.kind, el.w, el.h)}
          fill={isText ? 'transparent' : el.fill}
          stroke={isText ? 'none' : el.stroke}
          strokeWidth={el.strokeWidth}
          strokeDasharray={dash}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="all"
        />
        {detail && !isText && (
          <path
            d={detail}
            fill="none"
            stroke={el.stroke}
            strokeWidth={el.strokeWidth}
            strokeDasharray={dash}
            strokeLinecap="round"
            pointerEvents="none"
          />
        )}
      </g>
      {!hideLabel && el.label && (
        <ShapeLabel
          box={labelBox(el.kind, el.w, el.h)}
          text={el.label}
          color={labelColor(el.stroke)}
          fontSize={el.fontSize}
        />
      )}
    </g>
  )
})

/** A double line: two thinner parallel strokes either side of the path. */
export function DoubleRails(props: { points: Point[]; routing: Routing; stroke: string; strokeWidth: number }) {
  const { points, routing, stroke, strokeWidth } = props
  const { railWidth, offset } = doubleRails(strokeWidth)
  return (
    <>
      {[offset, -offset].map((o) => (
        <path
          key={o}
          d={linePath(offsetPolyline(points, o), routing, o)}
          fill="none"
          stroke={stroke}
          strokeWidth={railWidth}
          strokeLinecap="butt"
          strokeLinejoin="miter"
          pointerEvents="none"
        />
      ))}
    </>
  )
}

export function LineView({ el, points, hideLabel }: { el: LineElement; points: Point[]; hideLabel: boolean }) {
  const d = linePath(points, el.routing)
  const n = points.length
  const caps =
    n > 1
      ? [capPath(el.startCap, points[0], points[1], el.strokeWidth), capPath(el.endCap, points[n - 1], points[n - 2], el.strokeWidth)]
      : []
  const mid = polylineMidpoint(points)
  // The visible stroke stops where a closed end (triangle, circle, diamond) begins.
  const drawn = trimPolyline(points, capInset(el.startCap, el.strokeWidth), capInset(el.endCap, el.strokeWidth))
  return (
    <g data-id={el.id}>
      {/* Wide invisible stroke makes thin lines easy to hit, especially on touch. */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(18, el.strokeWidth + 14)} pointerEvents="stroke" />
      {el.dash === 'double' ? (
        <DoubleRails points={drawn} routing={el.routing} stroke={el.stroke} strokeWidth={el.strokeWidth} />
      ) : (
        <path
          d={linePath(drawn, el.routing)}
          fill="none"
          stroke={el.stroke}
          strokeWidth={el.strokeWidth}
          strokeDasharray={dashArray(el.dash, el.strokeWidth)}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      )}
      {caps.map(
        (cap, i) =>
          cap && (
            <path
              key={i}
              d={cap.d}
              fill={capFillColor(cap.fill, el.stroke)}
              stroke={el.stroke}
              strokeWidth={el.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="none"
            />
          ),
      )}
      {!hideLabel && el.label && (
        <foreignObject x={mid.x - 150} y={mid.y - 100} width={300} height={200} pointerEvents="none" style={{ overflow: 'visible' }}>
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <span
              style={{
                pointerEvents: 'auto',
                background: '#ffffff',
                padding: '1px 6px',
                borderRadius: 4,
                color: labelColor(el.stroke),
                fontSize: el.fontSize,
                fontFamily: FONT_FAMILY,
                lineHeight: 1.25,
                textAlign: 'center',
                whiteSpace: 'pre-wrap',
                userSelect: 'none',
                maxWidth: 300,
              }}
            >
              {el.label}
            </span>
          </div>
        </foreignObject>
      )}
    </g>
  )
}

export const CurveView = memo(function CurveView({ el }: { el: CurveElement }) {
  const d = useMemo(() => bezierPath(el.points, el.closed), [el.points, el.closed])
  return (
    <g data-id={el.id}>
      <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(18, el.strokeWidth + 14)} pointerEvents="stroke" />
      <path
        d={d}
        fill={el.closed ? el.fill : 'none'}
        stroke={el.stroke}
        strokeWidth={el.strokeWidth}
        strokeDasharray={dashArray(el.dash, el.strokeWidth)}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents={el.closed && el.fill !== 'none' ? 'visiblePainted' : 'none'}
      />
    </g>
  )
})

export const PathView = memo(function PathView({ el }: { el: PathElement }) {
  const d = useMemo(
    () =>
      svgPathFromStroke(
        getStroke(el.points, {
          size: el.size,
          thinning: el.highlighter ? 0 : 0.6,
          smoothing: 0.5,
          streamline: 0.5,
          simulatePressure: el.simulatePressure,
          last: true,
        }),
      ),
    [el.points, el.size, el.highlighter, el.simulatePressure],
  )
  return (
    <path
      data-id={el.id}
      d={d}
      fill={el.stroke}
      opacity={el.opacity}
      stroke="transparent"
      strokeWidth={10}
      pointerEvents="all"
      style={el.highlighter ? { mixBlendMode: 'multiply' } : undefined}
    />
  )
})
