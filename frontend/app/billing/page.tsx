import { redirect } from "next/navigation";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
type BillingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const params = await searchParams;
  const query = new URLSearchParams({ tab: "plans" });
  const checkout = typeof params.checkout === "string" ? params.checkout : "";
  if (checkout === "success" || checkout === "cancelled") query.set("checkout", checkout);
  redirect(`${base}/account/?${query.toString()}`);
}
