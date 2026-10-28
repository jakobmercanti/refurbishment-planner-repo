# Local native OpenCFD development environment

This is local development tooling, not a production deployment or an adjoint
solver. The optimisation capability remains disabled until the moving-boundary
law, coupled adjoint, gradients and optimisation lifecycle have been validated.

## Installed environment — 27 October 2026

- Windows WSL 2.7.10.0, Linux kernel 6.18.33.2-microsoft-standard-WSL2.
- Ubuntu-22.04, Ubuntu 22.04.5 LTS, WSL2. No restart was required.
- Default Linux user: `climoptix` (unprivileged, no password configured). Use
  `wsl -d Ubuntu-22.04 -u root` only for package administration.
- GCC/G++ 11.4.0 and CMake 3.22.1; MPI and native OpenFOAM development headers.
- OpenCFD `openfoam2312`, `openfoam2312-dev`, `openfoam2312-source` and
  `openfoam2312-tools`: **2312.260127-2** from OpenCFD's signed Jammy repository.
- OpenFOAM runtime: `v2312`, build `linux64GccDPInt32Opt`.
- Linux uv 0.10.9 and Python 3.12.13. These do not replace Windows Python or uv.

The repository configuration is `openfoam-jammy.sources`. Its signing key is
scoped to that source, in `/usr/share/keyrings/climoptix-openfoam.gpg`, with
fingerprint `DC93 C096 1741 22E2 56DA 2406 3386 DD74 948D 208F` (OpenCFD's
published key). No unsigned-package exception was used. The apt package version
is recorded explicitly; matching the v2312 branch does not imply bit-identical
binaries to the production Docker image.

## Build and Python paths

In Ubuntu:

```bash
source /usr/lib/openfoam/openfoam2312/etc/bashrc
cd '/mnt/c/Users/Dell/Documents/ChatGPT/Online refurbishment planner'
export PYTHONPATH=.
export OMP_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1
```

The isolated Linux project environment is
`/home/climoptix/.local/share/climoptix/planner-venv`. The uv tool environment is
`/home/climoptix/.local/share/climoptix/dev-tools`. Dependencies were installed
with the current `uv.lock`, `--frozen --extra cfd --python 3.12`, and
`UV_PROJECT_ENVIRONMENT` set to the Linux environment. **Do not run a plain uv
sync from Linux against the Windows `.venv`.**

No global shell profile was modified. No HTTP server, worker queue, Railway
release or production simulation was started.

## Native compilation check

```bash
cd deployment/native-dev/compile-check
wmake
climoptixNativeCompileCheck
```

This compiles and links against the actual installed OpenFOAM library, checks a
known nonsymmetric 2-by-2 linear solve, and exits unsuccessfully if the solution
is wrong. It is only a compiler/ABI check, **not** CFD or adjoint verification.
The executable is installed in `FOAM_USER_APPBIN`; generated build files are
ignored locally in this directory.

## Real native primal acceptance

From the repository root with the environment above:

```bash
/home/climoptix/.local/share/climoptix/planner-venv/bin/python \
  deployment/native-dev/verify_native.py \
  --output-directory /home/climoptix/.local/share/climoptix/runtime-acceptance-new
```

Choose a new output directory. The script refuses any existing one and never
deletes accepted output. It runs the trusted laminar fixture through the same
`compile_case`, meshing, quality checks, `simpleFoam`, resource limits and native
artifact packaging as the existing worker. It enables one plane in each X/Y/Z
orientation, rebinds the authoritative fingerprints, and verifies conservation,
residuals, native probes, physical plane coordinates and numeric U/p sampling
for every retained slice. It runs as the development user, not root. It
explicitly records `adjointValidated: false`.

The first run exposed a real sampling issue: OpenCFD's `cuttingPlane` uses an
iso-surface algorithm whose snapping can move points off the requested plane.
The strict numerical reader correctly rejected that geometry. Both the worker
compiler and settings exporter now use the geometric `plane` cutter instead;
the reader's tolerances were not relaxed, and old output was not rewritten.
Already retained off-plane output is not repaired by this source change.

The corrected measured run used 16,000 cells, converged at iteration 67 with all
reported initial U/p residuals below 1e-4, and had relative flux imbalance
3.999994779926361e-11. Three final slices and six retained slices (iterations 50
and 67) passed numeric sampling; their normal coordinate spans were exactly
zero. Complete probe/flux telemetry passed. Elapsed time was 14.43 seconds;
maximum child-process RSS was 108,840 KiB. These are measurements of this local
**ordinary laminar run**, not performance claims for an adjoint or optimisation.

The retained result is
`/home/climoptix/.local/share/climoptix/runtime-acceptance-20261027-2/runtime-acceptance.json`.
Windows-side evidence is in `.local-logs/native-adjoint-*`.

## Regression checks

With the fresh native archive, 241 focused backend tests passed (slice reader,
numeric comparisons, adjoint preparation, worker and settings export). There
were no failures or skips; one existing Starlette/httpx deprecation warning
remains. The new helper and changed exporters passed Ruff. Native C++
compilation/linking passed independently. Existing-output refusal was checked
with a before/after SHA-256 comparison of the retained acceptance summary.

To repeat from the repository root in Ubuntu, use a **new** pytest temporary
directory; pytest may clean an existing `--basetemp`:

```bash
export UV_PROJECT_ENVIRONMENT=/home/climoptix/.local/share/climoptix/planner-venv
export CFD_NATIVE_ARCHIVE=/home/climoptix/.local/share/climoptix/runtime-acceptance-20261027-2/laminar-case/native-case.zip
/home/climoptix/.local/share/climoptix/dev-tools/bin/uv run pytest \
  tests/test_cfd_slices.py tests/test_climoptix_adjoint.py \
  tests/test_openfoam_worker.py tests/test_climoptix.py \
  -q -p no:cacheprovider \
  --basetemp=/home/climoptix/.local/share/climoptix/pytest-native-env-new
```

## Remaining native-adjoint implementation

The presence of the stock `adjointOptimisationFoam` binary is not evidence that
it implements the required finite-size moving inlet/outlet mask derivative.
Next milestones remain the actual fixed-mesh wall-exchange law, its full
normalisation/outlet derivatives, a consistently coupled converged adjoint,
native finite-difference verification and checkpointed multi-step execution.
Do not change `canRun` merely because this environment passes acceptance.
