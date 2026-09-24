# Renovation Fit

Renovation Fit is an engineering-first platform that determines whether a real product fits
inside a measured room. The authoritative path is deterministic: verified measurements,
manufacturer specifications, explicit uncertainty intervals, geometry, fit rules, and only then
CAD/browser visualisation. The browser app includes an interactive millimetre floor-plan editor
for drawing, dragging, or entering arbitrary bathroom polygons before validation. Doors and
windows attach to measured wall offsets, including single- and double-leaf doors.

Milestone 1 uses an L-shaped bathroom, an inward-opening door, a window, a vanity obstacle, and a
parametric shower enclosure. It produces reproducible `FIT`, `VERIFY`, and `FAIL` results with
numeric explanations.

## Truth hierarchy

1. Verified user measurements
2. Verified manufacturer dimensions
3. Deterministic geometry
4. Explicit uncertainty calculations
5. CAD representation
6. Browser visualisation
7. Optional generative rendering

Visual output never feeds back into fit decisions. When uncertainty can change the result, the
engine returns `VERIFY`, never an unjustified `FIT`.

## Repository layout

- `geometry/`: authoritative domain, geometry, uncertainty, fixture, and fit-rule code
- `cad/`: headless FreeCAD adapter and worker
- `backend/`: FastAPI transport layer
- `frontend/`: Next.js floor-plan editor and React Three Fiber engineering viewer
- `database/`: versioned persistence records, separate from the geometry kernel
- `fixtures/`: serialised regression inputs
- `tests/`: deterministic regression suite
- `docs/`: architectural and engineering decisions

## Start the application locally

The simplest way to start both parts of the application is the included launcher.

1. Open PowerShell.
2. Go to the folder that contains `start-local.cmd` (not an older copied checkout):

   ```powershell
   cd "C:\Users\Dell\Documents\ChatGPT\Online refurbishment planner"
   ```

3. Start the application and open it in your browser:

   ```powershell
   .\start-local.cmd
   ```

The `.cmd` launcher automatically starts PowerShell with the temporary permission needed to run the project script. If you prefer to run the PowerShell script directly, use:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1 -OpenBrowser
```

The application opens at `http://localhost:3000`. The engineering backend is available at `http://127.0.0.1:8000/docs`.

### Open it on a phone on the same Wi-Fi

Keep the application running on the computer, then open the **Open on same Wi-Fi** address printed by the start script in the phone browser. For example: `http://192.168.68.104:3000`.

The frontend securely proxies engineering requests to the backend on the computer, so port 8000 does not need to be exposed to the network. If the page does not open, allow Node.js through Windows Firewall for private networks and confirm that both devices are connected to the same Wi-Fi.

The launcher starts the frontend and backend in the background. If either one is already running, it leaves that service running and uses it. If a different application is occupying port 8000, the launcher identifies the owning process instead of starting a second backend that cannot bind. Startup logs are saved in `.local-logs`; a failed backend start also prints its recent error output directly in the terminal.

### Stop or restart

To stop the local application, run:

```powershell
Get-NetTCPConnection -LocalPort 3000,8000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
```

Then use `./start-local.cmd` again to restart it.

## Manual local development

```powershell
uv sync
uv run pytest
uv run uvicorn backend.app.main:app --reload
```

In another terminal:

```powershell
cd frontend
pnpm install
pnpm dev
```

Generate the demonstration CAD model with an installed FreeCAD command line:

```powershell
uv run python -m cad.generator --demo cad/output/l_shaped_bathroom.FCStd
```

The internal authoritative unit is always millimetres. See `docs/UNITS.md` and
`docs/GEOMETRY.md` before changing geometry code.

Current milestone boundaries and known limitations are recorded in `docs/LIMITATIONS.md`.
