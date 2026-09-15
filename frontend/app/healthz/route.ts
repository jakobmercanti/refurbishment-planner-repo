export function GET() {
  return Response.json(
    { service: "renovation-fit-frontend", status: "ok" },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Renovation-Fit-Frontend": "ok",
      },
    },
  );
}
