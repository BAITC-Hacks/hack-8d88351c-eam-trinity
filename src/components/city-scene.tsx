"use client";
import {
  model,
  type DistrictId,
  type MetricId,
  type Result,
  type Decision,
  format,
} from "@/lib/model/engine";
const positions = [
  [155, 65],
  [440, 65],
  [725, 65],
  [298, 260],
  [582, 260],
];
function Building({
  x,
  y,
  h,
  tone = 0,
}: {
  x: number;
  y: number;
  h: number;
  tone?: number;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d={`M-17 0 L0 9 L22 -2 L5 -11Z`}
        fill="#071017"
        opacity=".5"
        transform="translate(5 5)"
      />
      <path
        d={`M-17 0 L-17 ${-h} L0 ${9 - h} L0 9Z`}
        fill={tone ? "#395763" : "#2a414c"}
      />
      <path
        d={`M0 9 L0 ${9 - h} L22 ${-2 - h} L22 -2Z`}
        fill={tone ? "#263d48" : "#1c303b"}
      />
      <path
        d={`M-17 ${-h} L5 ${-11 - h} L22 ${-2 - h} L0 ${9 - h}Z`}
        fill={tone ? "#719091" : "#526a73"}
      />
      {Array.from({ length: Math.floor(h / 10) }, (_, i) => (
        <g
          key={i}
          stroke={tone ? "#b8d7b4" : "#6d9f9f"}
          strokeWidth="2"
          opacity=".65"
        >
          <path d={`M-12 ${-7 - i * 10} l8 4 M5 ${-i * 10} l12 -6`} />
        </g>
      ))}
    </g>
  );
}
export function CityScene({
  result,
  selected,
  metric,
  decisions,
  onSelect,
}: {
  result: Result;
  selected: DistrictId;
  metric: MetricId;
  decisions: Decision[];
  onSelect: (id: DistrictId) => void;
}) {
  return (
    <svg
      className="city-svg"
      viewBox="-35 0 950 475"
      role="img"
      aria-label="Интерактивная схема пяти районов города"
    >
      <defs>
        <pattern id="grid" width="42" height="24" patternUnits="userSpaceOnUse">
          <path
            d="M0 12 L21 0 L42 12 L21 24Z"
            fill="none"
            stroke="#42616d"
            strokeWidth=".6"
            opacity=".14"
          />
        </pattern>
        <filter id="district-shadow">
          <feDropShadow
            dx="0"
            dy="15"
            stdDeviation="12"
            floodColor="#000"
            floodOpacity=".3"
          />
        </filter>
      </defs>
      <rect width="880" height="650" fill="url(#grid)" />
      <ellipse
        cx="480"
        cy="366"
        rx="300"
        ry="190"
        fill="#48d7c5"
        opacity=".025"
      />
      {model.districts.map((d, i) => {
        const [x, y] = positions[i];
        const active = selected === d.id;
        const value = result.indicators[d.id][metric];
        const critical = value < 40;
        const color = critical ? "#edb374" : "#65cdbb";
        const local = decisions.filter((m) => m.district_id === d.id);
        return (
          <g
            key={d.id}
            transform={`translate(${x} ${y})`}
            className={`district ${active ? "selected" : ""}`}
            tabIndex={0}
            role="button"
            aria-label={`Район ${d.name}, ${metric}: ${format(value)}`}
            aria-pressed={active}
            onClick={() => onSelect(d.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(d.id);
              }
            }}
          >
            <g filter="url(#district-shadow)">
              <path
                d="M-166 85 L0 171 L166 85 L166 99 L0 185 L-166 99Z"
                fill="#101e27"
                stroke="#2a424d"
              />
              <path
                className="district-ground"
                d="M0 0 L166 85 L0 171 L-166 85Z"
                fill={active ? "#244039" : "#1c2d32"}
                stroke={active ? "#7adcca" : "#3e555d"}
                strokeWidth={active ? 2 : 1}
              />
            </g>
            <path
              d="M-113 58 L109 114 M-53 28 L58 142"
              stroke="#39474d"
              strokeWidth="12"
            />
            <path
              d="M-113 58 L109 114 M-53 28 L58 142"
              stroke="#8a9598"
              strokeWidth="1"
              strokeDasharray="4 8"
              opacity=".5"
            />
            <path
              d="M-105 91 l35 -19 42 22 -34 19Z M55 52 l28 -15 38 20 -28 15Z"
              fill="#315447"
            />
            {[
              [0, 41, 45],
              [-51, 58, 34],
              [57, 85, 60],
              [-6, 110, 42],
              [-65, 100, 22],
              [57, 124, 24],
            ].map(([bx, by, h], j) => (
              <Building
                key={j}
                x={bx}
                y={by}
                h={h + (i === 0 ? 15 : 0)}
                tone={(i + j) % 3 === 0 ? 1 : 0}
              />
            ))}
            {[
              [-113, 83],
              [-99, 95],
              [96, 74],
              [110, 84],
              [18, 132],
            ].map(([tx, ty], j) => (
              <g key={j}>
                <path d={`M${tx} ${ty} v-9`} stroke="#688379" strokeWidth="2" />
                <ellipse
                  cx={tx}
                  cy={ty - 13}
                  rx="7"
                  ry="10"
                  fill={j % 2 ? "#517b5c" : "#3c6957"}
                />
              </g>
            ))}
            {local.length > 0 && (
              <g transform="translate(111 4)">
                <circle r="14" fill="#65d7c1" />
                <text
                  textAnchor="middle"
                  y="5"
                  fill="#082722"
                  fontWeight="700"
                  fontSize="13"
                >
                  {local.length}
                </text>
              </g>
            )}
            <g className="district-label" transform="translate(-69 153)">
              <rect
                x="-7"
                y="-16"
                width="158"
                height="48"
                rx="8"
                fill="#101b23"
                opacity=".96"
              />
              <circle cx="0" cy="0" r="3" fill={color} />
              <text
                x="11"
                y="5"
                fill={active ? "#effff9" : "#cedcdd"}
                fontSize="15"
                fontWeight="600"
              >
                {d.name}
              </text>
              <text
                x="139"
                y="5"
                textAnchor="end"
                fill={color}
                fontSize="13"
                className="numeric"
              >
                {format(value)}
              </text>
              <path
                d="M0 19 H139"
                stroke="#2c3a40"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <path
                d={`M0 19 H${(139 * value) / 100}`}
                stroke={color}
                strokeWidth="3"
                strokeLinecap="round"
              />
            </g>
          </g>
        );
      })}
      <g transform="translate(65 558)" opacity=".6">
        <path
          d="M0 28 L0 0 L-5 8 M0 0 L5 8 M0 28 L25 41"
          stroke="#a5b9bb"
          fill="none"
        />
        <text x="-4" y="-10" fill="#a5b9bb" fontSize="10">
          N
        </text>
      </g>
    </svg>
  );
}
