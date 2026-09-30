import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Check, RefreshCw, Mail } from "lucide-react";
import { api, errorMessage, json } from "../lib/api";
import type { Category, Profile } from "../lib/api";
export function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([
      api<Profile>("/me/profile", {}, true),
      api<{ categories: Category[] }>("/categories"),
      api<{ interests: Category[] }>("/me/interests", {}, true),
    ])
      .then(([p, c, i]) => {
        if (active) {
          setProfile(p);
          setCategories(c.categories);
          setSelected(i.interests.map((item) => item.id));
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  function reload() {
    setLoading(true);
    setError("");
    setAttempt((value) => value + 1);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy("profile");
    setError("");
    setSuccess("");
    try {
      setProfile(
        await api<Profile>(
          "/me/profile",
          json("PATCH", {
            display_name: String(data.get("display_name")).trim(),
            bio: String(data.get("bio")).trim(),
          }),
          true,
        ),
      );
      setSuccess("Your profile has been updated.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  async function interests() {
    setBusy("interests");
    setError("");
    setSuccess("");
    try {
      const result = await api<{ interests: Category[] }>(
        "/me/interests",
        json("PUT", { category_ids: selected }),
        true,
      );
      setSelected(result.interests.map((item) => item.id));
      setSuccess("Your interests have been saved.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  async function verify() {
    setBusy("verify");
    setError("");
    setSuccess("");
    try {
      const result = await api<{ message: string }>(
        "/auth/email/verify/request",
        { method: "POST" },
        true,
      );
      setSuccess(result.message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  if (loading)
    return (
      <div className="empty-state" role="status">
        <RefreshCw className="spin" />
        <h2>Getting your space ready…</h2>
      </div>
    );
  if (!profile)
    return (
      <div className="empty-state">
        <h1>We couldn’t load your profile</h1>
        <p role="alert">{error}</p>
        <button className="button" onClick={() => reload()}>
          Try again
        </button>
      </div>
    );
  return (
    <div className="account-page">
      <p className="eyebrow">YOUR SPACE</p>
      <h1>Make it your own.</h1>
      <p className="muted">A little about you. A lot of possibilities.</p>
      <div className="profile-banner">
        <span className="avatar large">
          {(profile.display_name || profile.username).slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h2>{profile.display_name || profile.username}</h2>
          <p>@{profile.username}</p>
        </div>
        <span className="pill">
          <span className="status-dot" /> Your Opueh profile
        </span>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="notice success" role="status">
          {success}
        </p>
      )}
      <div className="account-grid">
        <section className="panel">
          <h2>The basics</h2>
          <p className="muted">Let people get to know you.</p>
          <form onSubmit={save}>
            <fieldset disabled={!!busy}>
              <label>
                Display name
                <input
                  name="display_name"
                  defaultValue={profile.display_name}
                  autoComplete="name"
                  required
                  maxLength={50}
                />
              </label>
              <label>
                Bio
                <textarea
                  name="bio"
                  defaultValue={profile.bio || ""}
                  maxLength={500}
                  rows={4}
                  placeholder="What’s your story?"
                />
                <small>
                  Up to 500 characters. Leave blank to clear your bio.
                </small>
              </label>
              <label>
                Email address
                <input value={profile.email} readOnly />
              </label>
              <div className="email-state">
                <Mail size={16} />
                {profile.email_verified
                  ? "Email verified"
                  : "Email not verified yet"}
              </div>
              <button className="button" type="submit">
                {busy === "profile" ? "Saving…" : "Save profile"}
              </button>
            </fieldset>
          </form>
          {!profile.email_verified && (
            <button className="text-link" disabled={!!busy} onClick={verify}>
              {busy === "verify" ? "Sending…" : "Send verification link"}
            </button>
          )}
          <button
            className="text-link"
            disabled={!!busy}
            onClick={() => reload()}
          >
            Refresh account status
          </button>
        </section>
        <section className="panel">
          <span className="form-overline">FOLLOW YOUR CURIOSITY</span>
          <h2>What are you into?</h2>
          <p className="muted">Choose 1 to 10 interests for your profile.</p>
          {categories.length ? (
            <div className="interest-grid">
              {categories.map((c) => (
                <button
                  key={c.id}
                  className={
                    selected.includes(c.id) ? "interest selected" : "interest"
                  }
                  aria-pressed={selected.includes(c.id)}
                  disabled={
                    !!busy ||
                    (!selected.includes(c.id) && selected.length >= 10)
                  }
                  onClick={() =>
                    setSelected((prev) =>
                      prev.includes(c.id)
                        ? prev.filter((id) => id !== c.id)
                        : [...prev, c.id],
                    )
                  }
                >
                  {c.name}
                  {selected.includes(c.id) && <Check size={15} />}
                </button>
              ))}
            </div>
          ) : (
            <p>No interests are available yet. Check back soon.</p>
          )}
          <p className="selection-count">{selected.length} of 10 selected</p>
          <button
            className="button"
            disabled={!!busy || selected.length < 1 || selected.length > 10}
            onClick={interests}
          >
            {busy === "interests" ? "Saving…" : "Save interests"}
          </button>
        </section>
      </div>
    </div>
  );
}
