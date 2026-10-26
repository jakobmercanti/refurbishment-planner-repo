"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { downloadCFD } from "@/lib/climoptix";
import {
  LEVEL_COLOURS,
  parseResidualLog,
  type ResidualSample,
} from "@/lib/climoptixWorkflow";

interface ConvergenceLog {
  file: File | null;
  samples: ResidualSample[];
  reading: boolean;
  error: string;
  truncated: boolean;
  request?: symbol;
}
const EMPTY_LOG: ConvergenceLog = {
  file: null,
  samples: [],
  reading: false,
  error: "",
  truncated: false,
};

/** Session-only external logs: never saved as verified results or solver state. */
export function useConvergenceLogs() {
  const [logs, setLogs] = useState(new Map<string, ConvergenceLog>());
  const reads = useRef(new Map<string, symbol>());
  useEffect(() => {
    const pending = reads.current;
    return () => pending.clear();
  }, []);

  const importLog = async (studyId: string, file: File) => {
    const request = Symbol();
    reads.current.set(studyId, request);
    setLogs(
      (previous) =>
        new Map([
          ...[...previous].filter(([id]) => id !== studyId).slice(-2),
          [
            studyId,
            {
              ...(previous.get(studyId) ?? EMPTY_LOG),
              reading: true,
              error: "",
              request,
            },
          ],
        ]),
    );
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error("Solver logs must be at most 8 MB.");
      const text = await file.text();
      if (reads.current.get(studyId) !== request) return;
      const result = parseResidualLog(text);
      if (!result.samples.length)
        throw new Error(
          "No OpenFOAM residual records were found in this file.",
        );
      setLogs((previous) =>
        previous.get(studyId)?.request === request
          ? new Map(previous).set(studyId, {
              file,
              ...result,
              reading: false,
              error: "",
            })
          : previous,
      );
    } catch (error) {
      if (reads.current.get(studyId) !== request) return;
      setLogs((previous) =>
        previous.get(studyId)?.request === request
          ? new Map(previous).set(studyId, {
              ...previous.get(studyId)!,
              reading: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Cannot read this log.",
            })
          : previous,
      );
    } finally {
      if (reads.current.get(studyId) === request) reads.current.delete(studyId);
    }
  };
  const clearLog = (studyId: string) => {
    reads.current.delete(studyId);
    setLogs((previous) => {
      const next = new Map(previous);
      next.delete(studyId);
      return next;
    });
  };
  return { logs, importLog, clearLog };
}

export function ClimoptixConvergence({
  state = EMPTY_LOG,
  onImport,
  onClear,
  name,
  workerSource,
}: {
  state?: ConvergenceLog;
  onImport: (file: File) => void;
  onClear: () => void;
  name?: string;
  workerSource?: string;
}) {
  const [selectedFields, setSelectedFields] = useState<string[] | null>(null);
  const [metric, setMetric] = useState<"initial" | "final">("initial");
  const { series, maxIteration } = useMemo(() => {
    const grouped = new Map<string, ResidualSample[]>();
    let maxIteration = 1;
    for (const sample of state.samples) {
      const values = grouped.get(sample.field) ?? [];
      const previous = values[values.length - 1];
      // OpenFOAM can solve p repeatedly within one outer iteration. Joining all
      // corrections produces the misleading vertical fan shown in the report.
      if (previous?.iteration === sample.iteration) values[values.length - 1] = { ...previous, final: sample.final };
      else values.push({ ...sample });
      grouped.set(sample.field, values);
      maxIteration = Math.max(maxIteration, sample.iteration);
    }
    return { series: [...grouped], maxIteration };
  }, [state.samples]);
  const defaults = series.filter(([field]) => ["Ux", "Uy", "Uz", "p"].includes(field)).map(([field]) => field);
  const activeFields = selectedFields ?? (defaults.length ? defaults : series.slice(0,4).map(([field]) => field));
  const shown = series.filter(([field]) => activeFields.includes(field));
  return (
    <section
      className="cfx-convergence"
      aria-label={workerSource ? "Worker convergence history" : "Imported convergence history"}
    >
      <details open><summary>Convergence{name ? ` · ${name}` : ""} · residuals</summary>
      <p className="cfx-caption">{workerSource || "External log · unverified · session only"}</p>
      {!workerSource && <p className="cfx-caption">Import an OpenFOAM log to inspect external residuals; imported logs are not verified worker results.</p>}
      {!workerSource && <label className="cfx-file">
        {state.reading ? "Reading solver log…" : "Import solver log"}
        <input
          type="file"
          accept=".log,.txt,text/plain"
          aria-label="Import solver log"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onImport(file);
          }}
        />
      </label>}
      {state.reading && <p role="status">Reading solver log…</p>}
      {state.error && (
        <p role="alert" className="cfx-error">
          {state.error}
        </p>
      )}
      {state.truncated && (
        <p role="status" className="cfx-caption">
          Display limited to 20,000 records and 32 fields. Download keeps the
          complete imported log.
        </p>
      )}
      {(state.file || state.reading) && (
        <div className="cfx-actions">
          {state.file && (
            <>
              <span className="cfx-log-name">{state.file.name}</span>
              <button
                onClick={() => {
                  if (state.file) downloadCFD(state.file, state.file.name);
                }}
              >
                Download original log
              </button>
            </>
          )}
          <button onClick={onClear}>Clear log</button>
        </div>
      )}
      {!state.samples.length ? (
        <p>No residual samples.</p>
      ) : (
        <>
          <div className="cfx-grid"><label>Residuals to display<select aria-label="Residuals to display" value="" onChange={event => {
            const field=event.target.value;
            setSelectedFields(field==="all"?series.map(([name])=>name):field==="defaults"?null:activeFields.includes(field)?activeFields.filter(name=>name!==field):[...activeFields,field]);
          }}>
            <option value="">Add or remove a residual graph…</option><option value="defaults">Restore default graphs · Ux, Uy, Uz, p</option><option value="all">Show all residual graphs</option>
            {series.map(([field]) => <option key={field} value={field}>{activeFields.includes(field)?"✓ Remove":"Add"} {field}</option>)}
          </select></label><label>Residual measure<select aria-label="Residual measure" value={metric} onChange={event=>setMetric(event.target.value as typeof metric)}><option value="initial">Initial residuals</option><option value="final">Final linear-solver residuals</option></select></label></div>
          <p className="cfx-caption">One initial value per field and outer step; final values use the last correction in that step. Zero values sit at the display floor 10⁻¹²; original logs are unchanged.</p>
          {!shown.length&&<p>No graphs selected. Add a residual from the dropdown.</p>}
          <div className="cfx-residual-grid">{shown.map(([graphField]) => <figure key={graphField}><figcaption>{graphField} · {metric === "initial" ? "Initial residuals" : "Final linear-solver residuals"}</figcaption>
          <svg
            viewBox="0 0 360 220"
            role="img"
            aria-label={`${metric === "initial" ? "Residual" : "Final residual"} graph for ${graphField}`}
          >
            {[-12, -9, -6, -3, 0].map((tick) => {
              const y = 185 - (tick + 12) * 13;
              return (
                <g key={tick}>
                  <line
                    x1="47"
                    x2="345"
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    opacity=".15"
                  />
                  <text x="3" y={y + 4} fill="currentColor" fontSize="11">
                    10^{tick}
                  </text>
                </g>
              );
            })}
            {shown.filter(([field])=>field===graphField).map(([field, data]) => {
              const i = series.findIndex(([name]) => name === field);
              const stride = Math.max(1, Math.ceil(data.length / 1000));
              const point = (sample: ResidualSample) => [
                47 + (sample.iteration / maxIteration) * 298,
                185 -
                  (Math.max(
                    -12,
                    Math.min(0, Math.log10(Math.max(1e-12, sample[metric]))),
                  ) +
                    12) *
                    13,
              ];
              const points = data
                .filter((_, j) => j % stride === 0 || j === data.length - 1)
                .map((sample) => point(sample).join(","))
                .join(" ");
              const [x, y] = point(data[data.length - 1]);
              const colour = LEVEL_COLOURS[i % LEVEL_COLOURS.length];
              return (
                <g key={field}>
                  <polyline
                    points={points}
                    fill="none"
                    stroke={colour}
                    strokeWidth="2"
                  />
                  <circle cx={x} cy={y} r="2.5" fill={colour}>
                    <title>{`${field}: ${data[data.length - 1][metric].toExponential(2)}`}</title>
                  </circle>
                </g>
              );
            })}
            <text x="47" y="210" fill="currentColor" fontSize="11">
              0
            </text>
            <text
              x="345"
              y="210"
              textAnchor="end"
              fill="currentColor"
              fontSize="11"
            >
              {maxIteration} iterations / time steps
            </text>
          </svg>
          </figure>)}</div>
          <ul className="cfx-residual-legend">
            {shown.map(([field, data]) => (
              <li key={field}>
                <i
                  style={{
                    background: LEVEL_COLOURS[series.findIndex(([name]) => name === field) % LEVEL_COLOURS.length],
                  }}
                />
                {field}: {data[data.length - 1][metric].toExponential(2)}
              </li>
            ))}
          </ul>
        </>
      )}
      </details>
    </section>
  );
}
