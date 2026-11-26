"use client";

import { ArrowUpRight, Check } from "lucide-react";
import {
  useEffect,
  useId,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  axisTicks,
  formatDollars,
  type ChartPoint,
  type HeroBlock,
  type HeroFollowUp,
} from "@/lib/hero-scenarios";

interface HeroDemoCardProps {
  blocks: HeroBlock[];
  /** How many blocks have streamed in so far. */
  shown: number;
  /** False when the answer appears complete, without the streaming motion. */
  animate: boolean;
  onFollowUp: (followUp: HeroFollowUp) => void;
  onInteract: () => void;
}

export function HeroDemoCard({
  blocks,
  shown,
  animate,
  onFollowUp,
  onInteract,
}: HeroDemoCardProps) {
  return (
    <div className="demo-card" data-animate={animate ? "" : undefined}>
      {blocks.slice(0, shown).map((block, index) => (
        <div className={`demo-block demo-block-${block.kind}`} key={index}>
          <Block
            block={block}
            animate={animate}
            onFollowUp={onFollowUp}
            onInteract={onInteract}
          />
        </div>
      ))}
    </div>
  );
}

function Block({
  block,
  animate,
  onFollowUp,
  onInteract,
}: {
  block: HeroBlock;
  animate: boolean;
  onFollowUp: (followUp: HeroFollowUp) => void;
  onInteract: () => void;
}) {
  switch (block.kind) {
    case "header":
      return (
        <>
          <p className="demo-card-title">{block.title}</p>
          <p>{block.subtitle}</p>
        </>
      );
    case "metrics":
      return (
        <dl className="demo-metrics">
          {block.items.map((item) => (
            <div className="demo-metric" key={item.label}>
              <dt>{item.label}</dt>
              <dd>
                <strong>
                  <CountUp value={item.value} animate={animate} />
                </strong>
                <small>{item.note}</small>
              </dd>
            </div>
          ))}
        </dl>
      );
    case "line":
      return <LineChart {...block} />;
    case "bars":
      return <BarChart {...block} />;
    case "dishes":
      return (
        <ul className="demo-dishes">
          {block.items.map((dish) => (
            <li key={dish.title}>
              <span>{dish.title}</span>
              <small>
                {dish.course} · {dish.time}
              </small>
            </li>
          ))}
        </ul>
      );
    case "checklist":
      return <Checklist {...block} onInteract={onInteract} />;
    case "table":
      return (
        <div className="demo-table">
          <p className="demo-block-title">{block.title}</p>
          <table>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.day}>
                  <th scope="row">{row.day}</th>
                  <td>{row.session}</td>
                  <td>{row.distance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "followups":
      return (
        <div className="demo-followups">
          <p className="demo-block-title">Related queries</p>
          {block.items.map((followUp) => (
            <button
              type="button"
              key={followUp.label}
              onClick={() => onFollowUp(followUp)}
            >
              <span>{followUp.label}</span>
              <ArrowUpRight aria-hidden="true" />
            </button>
          ))}
        </div>
      );
  }
}

function CountUp({ value, animate }: { value: number; animate: boolean }) {
  const [current, setCurrent] = useState(animate ? 0 : value);

  useEffect(() => {
    if (!animate) return;
    const startedAt = performance.now();
    let frame = requestAnimationFrame(function tick(now: number) {
      const progress = Math.min(1, (now - startedAt) / 900);
      const eased = 1 - (1 - progress) ** 3;
      setCurrent(Math.round((value * eased) / 100) * 100);
      if (progress < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [animate, value]);

  return <>{formatDollars(animate ? current : value)}</>;
}

const PLOT_INSET = 7;

function percent(value: number): string {
  return `${value.toFixed(2)}%`;
}

/** A Catmull-Rom curve through the points, as cubic Bézier segments. */
function smoothPath(xs: number[], ys: number[]): string {
  let path = `M ${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`;
  for (let i = 0; i < xs.length - 1; i += 1) {
    const beforeX = xs[i - 1] ?? xs[i];
    const beforeY = ys[i - 1] ?? ys[i];
    const afterX = xs[i + 2] ?? xs[i + 1];
    const afterY = ys[i + 2] ?? ys[i + 1];
    const coordinates = [
      xs[i] + (xs[i + 1] - beforeX) / 6,
      ys[i] + (ys[i + 1] - beforeY) / 6,
      xs[i + 1] - (afterX - xs[i]) / 6,
      ys[i + 1] - (afterY - ys[i]) / 6,
      xs[i + 1],
      ys[i + 1],
    ];
    path += ` C ${coordinates.map((value) => value.toFixed(2)).join(" ")}`;
  }
  return path;
}

function chartScale(points: ChartPoint[]) {
  const max = Math.max(...points.map((point) => point.value));
  const ticks = axisTicks(max);
  const top = Math.max(max * 1.1, ticks[ticks.length - 1]);
  return { ticks, top };
}

function LineChart({
  unit,
  summary,
  points,
}: {
  unit: string;
  summary: string;
  points: ChartPoint[];
}) {
  const gradientId = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  const { ticks, top } = chartScale(points);
  const xs = points.map(
    (_, index) =>
      PLOT_INSET + (index / (points.length - 1)) * (100 - PLOT_INSET * 2),
  );
  const ys = points.map((point) => 100 - (point.value / top) * 100);
  const line = smoothPath(xs, ys);
  const last = points.length - 1;
  const area = `${line} L ${xs[last].toFixed(2)} 100 L ${xs[0].toFixed(2)} 100 Z`;
  const active = hovered ?? last;

  function track(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    let nearest = 0;
    for (let index = 1; index < xs.length; index += 1) {
      if (Math.abs(xs[index] - x) < Math.abs(xs[nearest] - x)) nearest = index;
    }
    setHovered(nearest);
  }

  return (
    <figure className="demo-chart">
      <figcaption>{unit}</figcaption>
      <div className="demo-chart-body">
        <div className="demo-chart-yaxis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ bottom: percent((tick / top) * 100) }}>
              {tick}
            </span>
          ))}
        </div>
        <div
          className="demo-chart-plot"
          role="img"
          aria-label={summary}
          data-hovering={hovered === null ? undefined : ""}
          onPointerMove={track}
          onPointerDown={track}
          onPointerLeave={() => setHovered(null)}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" className="demo-chart-fade-start" />
                <stop offset="1" className="demo-chart-fade-end" />
              </linearGradient>
            </defs>
            {ticks.map((tick) => (
              <line
                key={tick}
                className="demo-chart-grid"
                x1="0"
                x2="100"
                y1={100 - (tick / top) * 100}
                y2={100 - (tick / top) * 100}
              />
            ))}
            <path className="demo-chart-area" d={area} fill={`url(#${gradientId})`} />
            <path className="demo-chart-line" d={line} pathLength={1} />
          </svg>
          <span
            className="demo-chart-guide"
            style={{ left: percent(xs[active]) }}
          />
          <span
            className="demo-chart-dot"
            style={{ left: percent(xs[active]), top: percent(ys[active]) }}
          />
          <span
            className="demo-chart-tip"
            data-side={active > last / 2 ? "left" : "right"}
            style={{ left: percent(xs[active]), top: percent(ys[active]) }}
          >
            <strong>{points[active].detail}</strong>
            <small>{points[active].label}</small>
          </span>
        </div>
      </div>
      <div className="demo-chart-xaxis" aria-hidden="true">
        {points.map((point, index) => (
          <span
            key={point.label}
            data-active={index === hovered ? "" : undefined}
            style={{ left: percent(xs[index]) }}
          >
            {point.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

function BarChart({
  unit,
  summary,
  points,
}: {
  unit: string;
  summary: string;
  points: ChartPoint[];
}) {
  const { ticks, top } = chartScale(points);

  return (
    <figure className="demo-chart demo-chart-bars">
      <figcaption>{unit}</figcaption>
      <div className="demo-chart-body">
        <div className="demo-chart-yaxis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ bottom: percent((tick / top) * 100) }}>
              {tick}
            </span>
          ))}
        </div>
        <div className="demo-chart-plot" role="img" aria-label={summary}>
          {ticks.map((tick) => (
            <span
              key={tick}
              className="demo-bar-grid"
              style={{ bottom: percent((tick / top) * 100) }}
            />
          ))}
          <div className="demo-bar-row">
            {points.map((point, index) => (
              <span className="demo-bar-column" key={point.label}>
                <span
                  className="demo-bar"
                  style={{
                    height: percent((point.value / top) * 100),
                    animationDelay: `${index * 70}ms`,
                  }}
                >
                  <span className="demo-bar-tip">{point.detail}</span>
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="demo-chart-xaxis demo-chart-xaxis-even" aria-hidden="true">
        {points.map((point) => (
          <span key={point.label}>{point.label}</span>
        ))}
      </div>
    </figure>
  );
}

function Checklist({
  title,
  groups,
  onInteract,
}: {
  title: string;
  groups: Array<{ label: string; items: string[] }>;
  onInteract: () => void;
}) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const total = groups.reduce((count, group) => count + group.items.length, 0);

  function toggle(item: string) {
    onInteract();
    setChecked((current) => {
      const next = new Set(current);
      if (!next.delete(item)) next.add(item);
      return next;
    });
  }

  return (
    <div className="demo-checklist" role="group" aria-label={title}>
      <div className="demo-checklist-heading">
        <span className="demo-block-title">{title}</span>
        <span className="demo-checklist-count" aria-live="polite">
          {checked.size} of {total} in the basket
        </span>
      </div>
      <div className="demo-checklist-groups">
        {groups.map((group) => (
          <div key={group.label}>
            <p>{group.label}</p>
            {group.items.map((item) => (
              <label key={item}>
                <input
                  type="checkbox"
                  checked={checked.has(item)}
                  onChange={() => toggle(item)}
                />
                <span className="demo-checkbox" aria-hidden="true">
                  <Check />
                </span>
                <span>{item}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
