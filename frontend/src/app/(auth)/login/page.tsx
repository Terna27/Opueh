import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "@/components/auth/login-form";
import { safeNext } from "@/lib/account/next-param";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to your Opueh account.",
};

/*
 * `searchParams` is read on the server and handed to the form as a prop, rather
 * than the form calling `useSearchParams` itself. The hook would force a client
 * boundary and a Suspense wrapper around an otherwise static page; doing it
 * here keeps the redirect target a server-validated string that the form only
 * has to obey.
 *
 * It is validated with `safeNext` before it goes anywhere near a navigation —
 * see that function for why the check is an allowlist rather than a
 * `startsWith("/")`.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : undefined);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Log in
        </h1>
        <p className="text-sm text-muted">
          Welcome back. Enter your details to continue.
        </p>
      </div>

      <LoginForm next={next} />

      <p className="text-sm text-muted">
        No account yet?{" "}
        <Link href="/register" className="font-medium text-primary underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
