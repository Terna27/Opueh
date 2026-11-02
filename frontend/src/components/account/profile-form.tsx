"use client";

import { useState, type FormEvent } from "react";

import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveMyProfile } from "@/lib/account/client";
import type { MyProfile, ProfilePatchRequest } from "@/lib/api/types";
import {
  BIO_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  validateBio,
  validateProfileDisplayName,
} from "@/lib/validation";

export type ProfileFormProps = {
  profile: MyProfile;
  /** The saved profile, so the page can reflect it without refetching. */
  onSaved: (profile: MyProfile) => void;
};

/*
 * Editing display name and bio.
 *
 * The patch it sends contains only the fields the user actually changed, and
 * that is the whole subtlety of this form. Upstream the fields are pointers, so
 * an omitted `bio` leaves the existing bio alone while `bio: ""` erases it.
 * Sending both fields on every save would mean that editing a display name
 * silently wiped a bio the user never touched — and the failure would look like
 * data loss with no action that obviously caused it.
 *
 * The Save button is disabled while nothing has changed, which is not just
 * polish: a patch with no fields in it is a 400 from the backend ("at least one
 * field must be supplied"), so offering the button would be offering a request
 * that cannot succeed.
 */

export function ProfileForm({ profile, onSaved }: ProfileFormProps) {
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [fieldErrors, setFieldErrors] = useState<{
    display_name?: string;
    bio?: string;
  }>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  // Compared trimmed, because that is what the backend stores and therefore
  // what it would return: typing a trailing space is not a change worth
  // sending, and treating it as one would fire a request that saves nothing.
  const displayNameChanged = displayName.trim() !== profile.display_name;
  const bioChanged = bio.trim() !== (profile.bio ?? "");
  const hasChanges = displayNameChanged || bioChanged;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const errors = {
      display_name: validateProfileDisplayName(displayName),
      bio: validateBio(bio),
    };
    setFieldErrors(errors);

    if (errors.display_name || errors.bio) {
      setFormError(undefined);
      return;
    }

    const patch: ProfilePatchRequest = {};
    if (displayNameChanged) {
      // Trimmed on the way out: leading and trailing whitespace is not part of
      // a name, and the backend would trim it anyway.
      patch.display_name = displayName.trim();
    }
    if (bioChanged) {
      // Sent as typed, NOT trimmed: the backend trims the ends but keeps
      // interior newlines, because a bio is prose and its line breaks are
      // content. An empty string is a deliberate clear.
      patch.bio = bio;
    }

    if (Object.keys(patch).length === 0) {
      // Unreachable while the button is disabled, but the guard is what makes
      // that true rather than merely likely.
      return;
    }

    setSaving(true);
    setFormError(undefined);

    const result = await saveMyProfile(patch);

    if (!result.ok) {
      setSaving(false);
      // The backend's own sentence. A bio over the limit, a display name that
      // is only whitespace, an unreachable API — each says what it means, and
      // none of them is guessed at here.
      setFormError(result.error.message);
      return;
    }

    onSaved(result.data);
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <Input
        label="Display name"
        name="display_name"
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        error={fieldErrors.display_name}
        helperText={`Shown on your profile. Up to ${DISPLAY_NAME_MAX_LENGTH} characters.`}
        autoComplete="name"
        required
      />

      <Textarea
        label="Bio"
        name="bio"
        value={bio}
        onChange={(event) => setBio(event.target.value)}
        error={fieldErrors.bio}
        helperText={`Up to ${BIO_MAX_LENGTH} characters. Clear it to remove your bio.`}
        rows={5}
      />

      <FormError message={formError} />

      <div className="flex items-center gap-3">
        <Button type="submit" loading={saving} disabled={!hasChanges}>
          Save changes
        </Button>
        {!hasChanges ? (
          <span className="text-sm text-muted">Nothing to save yet.</span>
        ) : null}
      </div>
    </form>
  );
}
