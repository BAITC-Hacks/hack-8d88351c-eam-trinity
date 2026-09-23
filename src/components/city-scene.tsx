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
        fill="#7893b3"
        opacity=".5"
        transform="translate(5 5)"
      />
      <path
        d={`M-17 0 L-17 ${-h} L0 ${9 - h} L0 9Z`}
        fill={tone ? "#d9e8f6" : "#d2e1ef"}
      />
      <path
        d={`M0 9 L0 ${9 - h} L22 ${-2 - h} L22 -2Z`}
        fill={tone ? "#8eafd0" : "#9fbdd8"}
      />
      <path
        d={`M-17 ${-h} L5 ${-11 - h} L22 ${-2 - h} L0 ${9 - h}Z`}
        fill={tone ? "#ffffff" : "#eef7ff"}
      />
      {Array.from({ length: Math.floor(h / 10) }, (_, i) => (
        <g
          key={i}
          stroke={tone ? "#709cc5" : "#7398ba"}
          strokeWidth="2"
          opacity=".65"
        >
          <path d={`M-12 ${-7 - i * 10} l8 4 M5 ${-i * 10} l12 -6`} />
        </g>
      ))}
    </g>
  );
}

// Architectural silhouettes establish the city's identity; the scene remains a
// schematic, not a geographic map or a separate source of simulation data.
function Landmark({ variant }: { variant: "tower" | "arch" | "pyramid" }) {
  if (variant === "tower")
    return (
      <g transform="translate(0 63)" aria-hidden="true">
        <ellipse cy="4" rx="26" ry="12" fill="#bfd4ea" opacity=".5" />
        <path d="M-22 0 L0 -12 L23 0 L0 12Z" fill="#fbfdff" stroke="#bed2e9" />
        <path
          d="M-5 0 L-8 -60 L0 -72 L8 -60 L5 0Z"
          fill="#d2e5f8"
          stroke="#90b4d7"
        />
        <path d="M-2 1 L-2 -67 M3 1 L3 -67" stroke="#fff" strokeWidth="3" />
        <path
          d="M-5 -5 Q-16 -40 -15 -65 M5 -5 Q16 -40 15 -65"
          fill="none"
          stroke="#8fb6dc"
          strokeWidth="2"
        />
        <circle cy="-73" r="19" fill="url(#sphere-glass)" stroke="#87afe0" />
        <ellipse
          cy="-73"
          rx="9"
          ry="18"
          fill="none"
          stroke="#e6f4ff"
          opacity=".85"
        />
        <path
          d="M-18 -77 Q0 -66 18 -77 M-17 -67 Q0 -59 17 -67"
          fill="none"
          stroke="#d8edff"
        />
        <ellipse cx="-6" cy="-81" rx="6" ry="4" fill="#fff" opacity=".8" />
      </g>
    );
  if (variant === "pyramid")
    return (
      <g transform="translate(0 59)" aria-hidden="true">
        <path d="M-33 0 L0 -53 L34 0 L0 17Z" fill="#e7f3ff" stroke="#b6cfe8" />
        <path d="M0 -53 L34 0 L0 17Z" fill="#a8c9e8" />
        <path
          d="M0 -53 V17 M-23 -16 L0 -5 L25 -14 M-13 -32 L0 -25 L15 -30"
          fill="none"
          stroke="#f8fcff"
          strokeWidth="1.5"
        />
      </g>
    );
  return (
    <g transform="translate(0 56)" aria-hidden="true">
      <path
        d="M-28 0 V-56 Q0 -83 28 -56 V0 L17 6 V-49 Q0 -64 -17 -49 V6Z"
        fill="#bed7ee"
        stroke="#96b8d8"
      />
      <path d="M-28 -56 Q0 -83 28 -56 L19 -61 Q0 -77 -19 -61Z" fill="#fff" />
      <path d="M-23 -52 V0 M23 -52 V0" stroke="#eff8ff" strokeWidth="3" />
      <path
        d="M-28 -27 L-17 -21 M17 -21 L28 -27 M-28 -40 L-17 -34 M17 -34 L28 -40"
        stroke="#789fc9"
      />
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
        <radialGradient id="sphere-glass" cx="30%" cy="25%" r="75%">
          <stop offset="0" stopColor="#f5fbff" />
          <stop offset=".5" stopColor="#9acaff" />
          <stop offset="1" stopColor="#518bd2" />
        </radialGradient>
        <pattern id="grid" width="42" height="24" patternUnits="userSpaceOnUse">
          <path
            d="M0 12 L21 0 L42 12 L21 24Z"
            fill="none"
            stroke="#8fb2df"
            strokeWidth=".6"
            opacity=".18"
          />
        </pattern>
        <filter id="district-shadow">
          <feDropShadow
            dx="0"
            dy="15"
            stdDeviation="12"
            floodColor="#547aaf"
            floodOpacity=".14"
          />
        </filter>
      </defs>
      <rect width="880" height="475" fill="url(#grid)" />
      <ellipse
        cx="480"
        cy="366"
        rx="300"
        ry="190"
        fill="#b5d6ff"
        opacity=".12"
      />
      {model.districts.map((d, i) => {
        const [x, y] = positions[i];
        const active = selected === d.id;
        const value = result.indicators[d.id][metric];
        const critical = value < 40;
        const color = critical ? "#a45d13" : "#2463d4";
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
                fill="#d9e6f4"
                stroke="#c2d4e8"
              />
              <path
                className="district-ground"
                d="M0 0 L166 85 L0 171 L-166 85Z"
                fill={active ? "#dbeaff" : "#edf4fc"}
                stroke={active ? "#3677d8" : "#c6d8ec"}
                strokeWidth={active ? 2 : 1}
              />
            </g>
            <path
              d="M-113 58 L109 114 M-53 28 L58 142"
              stroke="#d3e0ed"
              strokeWidth="12"
            />
            <path
              d="M-113 58 L109 114 M-53 28 L58 142"
              stroke="#ffffff"
              strokeWidth="1"
              strokeDasharray="4 8"
              opacity=".5"
            />
            <path
              d="M-105 91 l35 -19 42 22 -34 19Z M55 52 l28 -15 38 20 -28 15Z"
              fill="#d7e7f4"
            />
            {[
              [0, 41, 45],
              [-51, 58, 34],
              [57, 85, 60],
              [-6, 110, 42],
              [-65, 100, 22],
              [57, 124, 24],
            ].map(([bx, by, h], j) =>
              j === 0 && (i === 0 || i === 1 || i === 4) ? (
                <Landmark
                  key={j}
                  variant={i === 0 ? "tower" : i === 1 ? "pyramid" : "arch"}
                />
              ) : (
                <Building
                  key={j}
                  x={bx}
                  y={by}
                  h={h + (i === 0 ? 15 : 0)}
                  tone={(i + j) % 3 === 0 ? 1 : 0}
                />
              ),
            )}
            {[
              [-113, 83],
              [-99, 95],
              [96, 74],
              [110, 84],
              [18, 132],
            ].map(([tx, ty], j) => (
              <g key={j}>
                <path d={`M${tx} ${ty} v-9`} stroke="#849eb6" strokeWidth="2" />
                <ellipse
                  cx={tx}
                  cy={ty - 13}
                  rx="7"
                  ry="10"
                  fill={j % 2 ? "#b4ccd9" : "#c3d6e2"}
                />
              </g>
            ))}
            {local.length > 0 && (
              <g transform="translate(111 4)">
                <circle r="14" fill="#2463d4" />
                <text
                  textAnchor="middle"
                  y="5"
                  fill="#ffffff"
                  fontWeight="700"
                  fontSize="13"
                >
                  {local.length}
                </text>
              </g>
            )}
            <g className="district-label" transform="translate(-78 155)">
              <rect
                className="label-card"
                x="-7"
                y="-16"
                width="176"
                height="48"
                rx="9"
                stroke={active ? "#a5c4ee" : "#d5e2f2"}
                fill={active ? "#f4f8ff" : "#ffffff"}
                opacity=".96"
              />
              <circle cx="0" cy="0" r="3" fill={color} />
              <text
                x="11"
                y="5"
                fill={active ? "#194d96" : "#28496e"}
                fontSize="16"
                fontWeight="600"
              >
                {d.name}
              </text>
              <text
                x="154"
                y="5"
                textAnchor="end"
                fill={color}
                fontSize="14"
                className="numeric"
              >
                {format(value)}
              </text>
              <path
                d="M0 19 H154"
                stroke="#dfe8f4"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <rect
                x="0"
                y="17.5"
                width={(154 * value) / 100}
                height="3"
                rx="1.5"
                fill={color}
                style={{ transition: "width .3s ease, fill .2s ease" }}
              />
            </g>
          </g>
        );
      })}
      <g transform="translate(30 365)" opacity=".6">
        <path
          d="M0 28 L0 0 L-5 8 M0 0 L5 8 M0 28 L25 41"
          stroke="#678ab6"
          fill="none"
        />
        <text x="-4" y="-10" fill="#678ab6" fontSize="10">
          N
        </text>
      </g>
    </svg>
  );
}
