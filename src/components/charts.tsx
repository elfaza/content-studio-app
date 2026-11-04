"use client";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
export function ViewsChart({
  points,
}: {
  points: { date: string; views: number | null; platform?: string }[];
}) {
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points}>
          <defs>
            <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--chart)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(v) => String(v).slice(5)}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 13 }}
            minTickGap={35}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 13 }}
            width={42}
          />
          <Tooltip
            contentStyle={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 10,
              color: "var(--text)",
            }}
            labelStyle={{ color: "var(--text)" }}
          />
          <Area
            isAnimationActive={false}
            type="linear"
            dataKey="views"
            name="Recorded views"
            stroke="var(--chart)"
            strokeWidth={2}
            fill="url(#viewsFill)"
            connectNulls={false}
            dot={{ r: 4, fill: "var(--chart)" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function CategoryChart({
  points,
}: {
  points: { category: string; views: number }[];
}) {
  return (
    <div className="chart small-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} layout="vertical">
          <XAxis type="number" hide />
          <YAxis
            dataKey="category"
            type="category"
            width={100}
            tick={{ fill: "var(--muted)", fontSize: 13 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 10,
            }}
          />
          <Bar
            dataKey="views"
            fill="var(--chart)"
            radius={[0, 4, 4, 0]}
            barSize={14}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
