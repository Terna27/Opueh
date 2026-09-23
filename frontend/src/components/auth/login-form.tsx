"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginRequest } from "@/lib/auth/client";
import { useSession } from "@/lib/auth/session-context";

import { FormError } from "./form-error";

/**
 * The sign-in form.
 *
 * Validates only what the browser can know — that the fields are filled in.
 * Everything else is the backend's verdict, and its message is shown as it
 * arrives. Inventing a per-field mapping here would mean guessing which field
 * `VALIDATION_ERROR` referred to, and being wrong about it.
 */
export function LoginForm() {
  const router = useRouter();
  const { adoptUser } = useSession();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    identifier?: string;
    password?: string;
  }>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const errors = {
      identifier:
        identifier.trim() === "" ? "Enter your email or username." : undefined,
      password: password === "" ? "Password is required." : undefined,
    };
    setFieldErrors(errors);

    if (errors.identifier || errors.password) {
      // Stale: it described the previous attempt, not this one.
      setFormError(undefined);
      return;
    }

    setSubmitting(true);
    setFormError(undefined);

    const result = await loginRequest(identifier.trim(), password);

    if (result.ok) {
      adoptUser(result.user);
      // The header reads the session from context, so it updates immediately;
      // the refresh re-renders anything server-rendered that depends on it.
      router.push("/");
      router.refresh();
      // `submitting` is deliberately not reset: the form is on its way out,
      // and re-enabling the button would allow a second submit in the gap.
      return;
    }

    setSubmitting(false);
    // Wrong credentials, a suspended account, or an unreachable API — the
    // backend's own sentence, which the proxy passed through untouched.
    setFormError(result.error.message);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Input
        label="Email or username"
        name="identifier"
        autoComplete="username"
        autoFocus
        required
        value={identifier}
        error={fieldErrors.identifier}
        onChange={(event) => setIdentifier(event.target.value)}
      />

      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        error={fieldErrors.password}
        onChange={(event) => setPassword(event.target.value)}
      />

      <FormError message={formError} />

      <Button
        type="submit"
        size="lg"
        loading={submitting}
        // Keeps its label while loading so it does not appear to change
        // identity mid-request.
        className="w-full"
      >
        Log in
      </Button>
    </form>
  );
}
