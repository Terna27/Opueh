import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to your Opueh account.",
};

export default function LoginPage() {
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

      <LoginForm />

      <p className="text-sm text-muted">
        No account yet?{" "}
        <Link href="/register" className="font-medium text-primary underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
