"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { InterestPicker } from "@/components/account/interest-picker";
import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Spinner } from "@/components/ui/spinner";
import {
  fetchCategories,
  fetchMyInterests,
  saveMyInterests,
} from "@/lib/account/client";
import type { ApiError } from "@/lib/api/errors";
import type { Category } from "@/lib/api/types";
import { validateInterestCount } from "@/lib/validation";

/*
 * Onboarding: choose what you want to watch.
 *
 * A Client Component because it is a form over fetched data. It sits inside
 * the (app) group, so the session has already been established by the time it
 * renders — this page never has to ask whether anyone is signed in.
 *
 * Client-side rather than server-side for the same reason the profile page is:
 * a stale access cookie has to be rotated, rotating writes cookies, and a
 * Server Component cannot write them.
 *
 * The existing interests are loaded and preselected rather than the page
 * starting blank. Someone who already chose and comes back to change their
 * mind should see what they have, not an empty form that silently replaces
 * their selection with whatever they pick this time.
 */

type OnboardingData =
  | { ok: true; categories: Category[]; selected: string[] }
  | { ok: false; error: ApiError };

/**
 * Both requests, or the first failure.
 *
 * Neither depends on the other, so they go together rather than in sequence.
 * Module scope, outside the component: it takes no arguments and closes over
 * no state, and keeping it here is what stops it from being recreated on every
 * render and re-triggering the effect that calls it.
 */
async function fetchOnboarding(): Promise<OnboardingData> {
  const [categoriesResult, interestsResult] = await Promise.all([
    fetchCategories(),
    fetchMyInterests(),
  ]);

  if (!categoriesResult.ok) return { ok: false, error: categoriesResult.error };
  if (!interestsResult.ok) return { ok: false, error: interestsResult.error };

  return {
    ok: true,
    categories: categoriesResult.data,
    selected: interestsResult.data.map((category) => category.id),
  };
}

export default function OnboardingPage() {
  const router = useRouter();

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  // Bumped to re-run the fetch. A counter rather than a boolean so repeated
  // retries each take effect.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // A retry can start before the previous attempt answers, and a late reply
    // must not overwrite the newer one.
    let current = true;

    void fetchOnboarding().then((next) => {
      if (!current) return;

      if (next.ok) {
        setCategories(next.categories);
        setSelected(next.selected);
        setLoadError(undefined);
        return;
      }

      setLoadError(next.error.message);
    });

    return () => {
      current = false;
    };
  }, [attempt]);

  /**
   * Show the spinner again rather than the previous failure while the new
   * attempt is in flight.
   *
   * This is an event handler, not an effect body, so setting state here is
   * simply the thing that happened — there is no render cascade to avoid.
   */
  function retry() {
    setLoadError(undefined);
    setCategories(null);
    setAttempt((previous) => previous + 1);
  }

  async function handleSubmit() {
    const countError = validateInterestCount(selected.length);
    if (countError) {
      setSaveError(countError);
      return;
    }

    setSaving(true);
    setSaveError(undefined);

    const result = await saveMyInterests(selected);

    if (!result.ok) {
      setSaving(false);
      // The backend's own sentence — a bad id, too many, an unreachable API.
      setSaveError(result.error.message);
      return;
    }

    // No router.refresh() alongside this. Refresh re-renders the CURRENT route
    // and clears its client cache, which supersedes the push while it is still
    // an uncommitted transition — the navigation is then dropped.
    router.push("/");
  }

  if (loadError) {
    return (
      <ErrorState
        title="Could not load categories"
        description={loadError}
        onRetry={retry}
      />
    );
  }

  if (categories === null) {
    return (
      <div className="flex min-h-[20rem] items-center justify-center">
        <Spinner size="lg" label="Loading categories" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          What do you want to watch?
        </h1>
        <p className="text-sm text-muted">
          Pick a few topics and we&apos;ll use them to shape what you see. You
          can change these at any time.
        </p>
      </div>

      <InterestPicker
        categories={categories}
        selected={selected}
        onChange={setSelected}
        disabled={saving}
      />

      <FormError message={saveError} />

      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="lg"
          loading={saving}
          disabled={selected.length === 0}
          onClick={() => void handleSubmit()}
        >
          Continue
        </Button>
        {selected.length === 0 ? (
          <span className="text-sm text-muted">
            Choose at least one to continue.
          </span>
        ) : null}
      </div>
    </div>
  );
}
