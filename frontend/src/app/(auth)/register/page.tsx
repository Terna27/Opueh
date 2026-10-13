import type { Metadata } from "next";
import Link from "next/link";

import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create an Opueh account.",
};

export default function RegisterPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Create your account
        </h1>
        <p className="text-sm text-muted">
          Pick a username and a password. You can change your display name
          later.
        </p>
      </div>

      <RegisterForm />

      <p className="text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
