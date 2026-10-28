// Native build/ABI acceptance only. This is not a CFD or adjoint solver.
#include "scalarMatrices.H"
#include "IOstreams.H"
#include <cmath>

int main()
{
    Foam::scalarSquareMatrix matrix(2, Foam::Zero);
    matrix(0, 0) = 4;
    matrix(0, 1) = 1;
    matrix(1, 0) = 2;
    matrix(1, 1) = 3;
    Foam::scalarField rhs(2);
    rhs[0] = 6;
    rhs[1] = 8;
    Foam::LUsolve(matrix, rhs);
    if
    (
        !std::isfinite(rhs[0]) || !std::isfinite(rhs[1])
     || std::abs(rhs[0] - 1) > 1e-12 || std::abs(rhs[1] - 2) > 1e-12
    )
    {
        Foam::Info << "Native matrix compile/link check failed" << Foam::endl;
        return 1;
    }
    Foam::Info << "OpenCFD native compile/link check passed"
        << " (algebra only, not CFD/adjoint validation)" << Foam::endl;
    return 0;
}
