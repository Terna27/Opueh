"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ProfileForm } from "@/components/account/profile-form";
import { ErrorState } from "@/components/ui/error-state";
import { Spinner } from "@/components/ui/spinner";
import { fetchMyProfile } from "@/lib/account/client";
import type { MyProfile } from "@/lib/api/types";

/*
 * Edit your profile.
 *
 * A Client Component fetching through the proxy rather than a Server
 * Component reading the token itself. That is not incidental: an access
 * cookie that has expired has to be rotated, and rotating means WRITING
 * cookies — which a Server Component cannot do. Going through the proxy route
 * is what keeps a stale access token from turning this page into an error.
 */

export default function ProfileSettingsPage() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  // Bumped to re-run the fetch. A counter rather than a boolean so repeated
  // retries each take effect.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // A retry can be in flight while the previous attempt answers, and a late
    // reply must not overwrite the newer one.
    let current = true;

    void fetchMyProfile().then((result) => {
      if (!current) return;

      if (result.ok) {
        setProfile(result.data);
        setLoadError(undefined);
        return;
      }

      setLoadError(result.error.message);
    });

    return () => {
      current = false;
    };
  }, [attempt]);

  /**
   * Show the spinner again rather than the previous failure while the new
   * attempt is in flight. An event handler, not an effect body.
   */
  function retry() {
    setLoadError(undefined);
    setProfile(null);
    setAttempt((previous) => previous + 1);
  }

  if (loadError) {
    return (
      <ErrorState
        title="Could not load your profile"
        description={loadError}
        onRetry={retry}
      />
    );
  }

  if (profile === null) {
    return (
      <div className="flex min-h-[20rem] items-center justify-center">
        <Spinner size="lg" label="Loading your profile" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Profile
        </h1>
        <p className="text-sm text-muted">
          This is how you appear to everyone else on Opueh. Your username
          (@{profile.username}) cannot be changed yet.
        </p>
        <p className="text-sm">
          <Link
            href={`/u/${profile.username}`}
            className="font-medium text-primary underline"
          >
            View your public profile
          </Link>
        </p>
      </div>

      <ProfileForm profile={profile} onSaved={setProfile} />
    </div>
  );
}
