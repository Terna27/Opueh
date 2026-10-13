import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Container } from "@/components/layout/container";
import { Avatar } from "@/components/ui/avatar";
import { ErrorState } from "@/components/ui/error-state";
import { isProfileMissing } from "@/lib/api/errors";
import { fetchPublicProfile } from "@/lib/api/profile";

/*
 * A public profile. Anyone may read it, signed in or not.
 *
 * A Server Component calling the API contract directly, rather than a Client
 * Component going through a proxy route. The public profile needs no token, so
 * none of the reasons the proxy exists apply: nothing here has to rotate a
 * cookie, and rendering on the server means the profile is in the HTML rather
 * than arriving after a spinner.
 *
 * `params` is a Promise in this version of Next and must be awaited.
 */

type PublicProfilePageProps = PageProps<"/u/[username]">;

export async function generateMetadata({
  params,
}: PublicProfilePageProps): Promise<Metadata> {
  const { username } = await params;
  const result = await fetchPublicProfile(username);

  if (!result.ok) {
    // A missing profile must not leak into the title: the response for an
    // unknown, deleted, suspended and banned username is identical on purpose,
    // and a title that said which would undo that.
    return { title: "Profile" };
  }

  return {
    title: result.data.display_name,
    description: result.data.bio ?? undefined,
  };
}

export default async function PublicProfilePage({
  params,
}: PublicProfilePageProps) {
  const { username } = await params;
  const result = await fetchPublicProfile(username);

  if (!result.ok) {
    // The API answers USER_NOT_FOUND for unknown, deleted, suspended and
    // banned usernames alike, deliberately saying nothing about account state.
    // That becomes the 404 page. Every other failure stays an error, because
    // "this person does not exist" and "Opueh is down" are not the same
    // sentence to a reader.
    if (isProfileMissing(result.error)) {
      notFound();
    }

    return (
      <Container className="flex flex-1 flex-col py-10 sm:py-14">
        <ErrorState
          title="Could not load this profile"
          description={result.error.message}
        />
      </Container>
    );
  }

  const profile = result.data;

  return (
    <Container className="flex flex-1 flex-col py-10 sm:py-14">
      <article className="flex max-w-2xl flex-col gap-6">
        <div className="flex items-center gap-4">
          <Avatar name={profile.display_name} size="xl" />
          <div className="flex flex-col gap-0.5">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {profile.display_name}
            </h1>
            <p className="text-sm text-muted">@{profile.username}</p>
          </div>
        </div>

        {profile.bio ? (
          // `whitespace-pre-line` because a bio is prose: the backend keeps
          // interior newlines when it trims, so the line breaks are content the
          // author put there and collapsing them would lose it.
          <p className="text-base whitespace-pre-line text-foreground">
            {profile.bio}
          </p>
        ) : (
          <p className="text-sm text-muted">
            {profile.display_name} hasn&apos;t written a bio yet.
          </p>
        )}

        <p className="text-sm text-muted">
          Joined{" "}
          <time dateTime={profile.created_at}>
            {new Date(profile.created_at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
            })}
          </time>
        </p>
      </article>
    </Container>
  );
}
