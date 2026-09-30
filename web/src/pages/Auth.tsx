import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { api, errorMessage, json, setSession } from "../lib/api";
import type { AuthResult } from "../lib/api";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const register = mode === "register";
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    const payload = register
      ? {
          email: String(data.get("email")).trim(),
          username: String(data.get("username")).trim(),
          display_name: String(data.get("display_name")).trim(),
          password: data.get("password"),
        }
      : {
          identifier: String(data.get("identifier")).trim(),
          password: data.get("password"),
        };
    try {
      const result = await api<AuthResult>(
        `/auth/${mode}`,
        json("POST", payload),
      );
      setSession(result);
      navigate("/account", { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <div className="auth-story">
        <p className="eyebrow">YOUR NEXT CHAPTER</p>
        <h1>
          {register
            ? "Good things start with connection."
            : "Your people are one hello away."}
        </h1>
        <p>
          A place to express yourself, find common ground and make meaningful
          connections.
        </p>
        <div className="story-circle">
          say
          <br />
          hello.
        </div>
        <span className="muted">Your perspective belongs here.</span>
      </div>
      <section className="form-card">
        <span className="form-overline">WELCOME TO OPUEH</span>
        <h2>{register ? "Make yourself at home" : "Welcome back"}</h2>
        <p>
          {register
            ? "Create your account and find your space."
            : "Sign in to continue to your profile."}
        </p>
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            {register ? (
              <>
                <label>
                  Display name
                  <input
                    name="display_name"
                    autoComplete="name"
                    maxLength={50}
                    placeholder="What should we call you?"
                  />
                </label>
                <label>
                  Username
                  <input
                    name="username"
                    autoComplete="username"
                    required
                    pattern="[a-zA-Z0-9_]{3,30}"
                    minLength={3}
                    maxLength={30}
                    placeholder="your_username"
                  />
                  <small>3–30 letters, numbers or underscores.</small>
                </label>
                <label>
                  Email address
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    required
                    placeholder="you@example.com"
                  />
                </label>
              </>
            ) : (
              <label>
                Email or username
                <input
                  name="identifier"
                  autoComplete="username"
                  required
                  placeholder="you@example.com"
                />
              </label>
            )}
            <label>
              Password
              <div className="password-field">
                <input
                  name="password"
                  type={show ? "text" : "password"}
                  autoComplete={register ? "new-password" : "current-password"}
                  required
                  minLength={register ? 8 : undefined}
                  maxLength={128}
                  placeholder={
                    register ? "At least 8 characters" : "Enter your password"
                  }
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={show ? "Hide password" : "Show password"}
                  onClick={() => setShow(!show)}
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            {!register && (
              <Link className="forgot-link" to="/forgot-password">
                Forgot password?
              </Link>
            )}
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <button className="button full" type="submit">
              {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
              <ArrowRight size={17} />
            </button>
          </fieldset>
        </form>
        <p className="form-switch">
          {register ? "Already part of Opueh?" : "New around here?"}{" "}
          <Link to={register ? "/login" : "/register"}>
            {register ? "Sign in" : "Create an account"}
          </Link>
        </p>
        <p className="session-note">
          For this first release, reloading the page signs you out.
        </p>
      </section>
    </div>
  );
}
export function RecoveryPage({
  mode,
}: {
  mode: "forgot" | "reset" | "verify";
}) {
  // Remove one-time credentials from the address bar immediately, keeping them only in memory.
  const [token] = useState(
    () => new URL(window.location.href).searchParams.get("token") || "",
  );
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("token")) {
      url.searchParams.delete("token");
      window.history.replaceState(
        window.history.state,
        "",
        url.pathname + url.search + url.hash,
      );
    }
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setMessage("");
    const path =
      mode === "forgot"
        ? "/auth/password/forgot"
        : mode === "reset"
          ? "/auth/password/reset"
          : "/auth/email/verify";
    const payload =
      mode === "forgot"
        ? { email: String(data.get("email")).trim() }
        : mode === "reset"
          ? { token, new_password: data.get("new_password") }
          : { token };
    try {
      const result = await api<{ message: string }>(
        path,
        json("POST", payload),
      );
      if (mode === "reset") setSession(null);
      setMessage(result.message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const title =
    mode === "forgot"
      ? "Let’s get you back in"
      : mode === "reset"
        ? "Choose a new password"
        : "Verify your email";
  return (
    <div className="recovery-wrap">
      <section className="form-card">
        <span className="form-overline">ACCOUNT SUPPORT</span>
        <h1>{title}</h1>
        <p>
          {mode === "forgot"
            ? "Enter your email to request a recovery link."
            : mode === "verify"
              ? "Confirm your email address to complete verification."
              : "Use a unique password with at least 8 characters."}
        </p>
        <form onSubmit={submit}>
          <fieldset disabled={busy || !!message}>
            {mode === "forgot" ? (
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                />
              </label>
            ) : !token ? (
              <p className="notice error" role="alert">
                This link is missing its token. Request a new link and open it
                again.
              </p>
            ) : mode === "reset" ? (
              <label>
                New password
                <input
                  name="new_password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
              </label>
            ) : null}
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="notice success" role="status">
                {message}
              </p>
            )}
            <button
              className="button full"
              disabled={mode !== "forgot" && !token}
            >
              {busy
                ? "Please wait…"
                : mode === "forgot"
                  ? "Send recovery link"
                  : mode === "reset"
                    ? "Update password"
                    : "Verify email"}
            </button>
          </fieldset>
        </form>
        <Link className="text-link" to="/login">
          Back to sign in
        </Link>
      </section>
    </div>
  );
}
