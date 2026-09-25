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
 *
 * `next` is where to go after signing in — the page the visitor was trying to
 * reach before the guard sent them here. It arrives already validated by
 * `safeNext` on the server, so this component only has to fall back when it is
 * absent.
 */
export function LoginForm({ next }: { next?: string | null }) {
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
      // No router.refresh() alongside this push. It refreshes the current
      // route and clears that route's client cache, which supersedes the push
      // while it is still an uncommitted transition — the navigation is then
      // dropped and the user is left staring at the login form, signed in. The
      // push requests the destination as a fresh render, so anything
      // server-rendered there reads the new cookies anyway.
      //
      // `next` is the page they were headed for before the guard intervened,
      // already validated server-side. Home is the fallback for the ordinary
      // case of someone who simply came to log in.
      router.push(next ?? "/");
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
