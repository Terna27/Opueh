"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { registerRequest } from "@/lib/auth/client";
import { useSession } from "@/lib/auth/session-context";
import {
  DISPLAY_NAME_MAX_LENGTH,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validateUsername,
} from "@/lib/validation";

import { FormError } from "./form-error";

type FieldErrors = {
  email?: string;
  username?: string;
  display_name?: string;
  password?: string;
};

/**
 * The sign-up form.
 *
 * Validation is the shared `src/lib/validation.ts` rules, which mirror the
 * backend's own — they exist for exactly this, so a user is told about a bad
 * username before a round trip rather than after one. They are an affordance,
 * not a guarantee: the backend re-validates everything and its verdict is the
 * one that counts, which is why its message is what gets shown on rejection.
 */
export function RegisterForm() {
  const router = useRouter();
  const { adoptUser } = useSession();

  const [values, setValues] = useState({
    email: "",
    username: "",
    display_name: "",
    password: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  function update(field: keyof typeof values, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const errors: FieldErrors = {
      email: validateEmail(values.email),
      username: validateUsername(values.username),
      display_name: validateDisplayName(values.display_name),
      password: validatePassword(values.password),
    };
    setFieldErrors(errors);

    if (Object.values(errors).some((message) => message !== undefined)) {
      setFormError(undefined);
      return;
    }

    setSubmitting(true);
    setFormError(undefined);

    const result = await registerRequest({
      email: values.email.trim(),
      username: values.username.trim(),
      // The backend substitutes the username when this is empty, so an empty
      // string is sent rather than omitting the field — the Go decoder
      // rejects unknown fields, and a missing one is indistinguishable from
      // an empty one to it anyway.
      display_name: values.display_name.trim(),
      password: values.password,
    });

    if (result.ok) {
      // Registering signs the user in: the API returns a token pair, and the
      // proxy has already stored it, so there is no reason to ask them to log
      // in again with the password they just chose.
      adoptUser(result.user);
      // No router.refresh() here. It refreshes the CURRENT route — /register —
      // and clears that route's client cache, which supersedes this push while
      // it is still an uncommitted transition. The result was that registering
      // never navigated at all: the user stayed on the form, signed in, with no
      // sign that anything had happened. The push already requests the
      // destination as a fresh render, so it picks up the new cookies on its
      // own.
      //
      // Onboarding, not home. Registering is the one moment the app knows for
      // certain that a user has never chosen any interests — the endpoint
      // itself cannot say so, because an empty selection is a valid state for
      // someone who deliberately cleared theirs. Asking here is the only point
      // at which the question is unambiguous, and it never nags anyone twice.
      router.push("/onboarding");
      return;
    }

    setSubmitting(false);
    // A taken username or email arrives here as the backend's own sentence.
    setFormError(result.error.message);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        autoFocus
        required
        value={values.email}
        error={fieldErrors.email}
        onChange={(event) => update("email", event.target.value)}
      />

      <Input
        label="Username"
        name="username"
        autoComplete="username"
        required
        value={values.username}
        error={fieldErrors.username}
        helperText="3-30 characters. Letters, digits and underscores."
        onChange={(event) => update("username", event.target.value)}
      />

      <Input
        label="Display name"
        name="display_name"
        autoComplete="nickname"
        value={values.display_name}
        error={fieldErrors.display_name}
        helperText={`Optional. Shown on your profile. Up to ${DISPLAY_NAME_MAX_LENGTH} characters.`}
        onChange={(event) => update("display_name", event.target.value)}
      />

      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        value={values.password}
        error={fieldErrors.password}
        helperText="At least 8 characters."
        onChange={(event) => update("password", event.target.value)}
      />

      <FormError message={formError} />

      <Button type="submit" size="lg" loading={submitting} className="w-full">
        Create account
      </Button>
    </form>
  );
}
