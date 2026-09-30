import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import {
  ArrowUpRight,
  Radio,
  Video,
  MessageCircle,
  UserRound,
  Compass,
  LogOut,
  Menu,
  X,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api, errorMessage, getSession, setSession } from "./lib/api";
import { AuthPage, RecoveryPage } from "./pages/Auth";
import { AccountPage } from "./pages/Account";
import "./App.css";

const year = new Date().getFullYear();
function Shell() {
  const [session, updateSession] = useState(getSession);
  const [mobile, setMobile] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    const update = () => updateSession(getSession());
    window.addEventListener("opueh-session", update);
    return () => window.removeEventListener("opueh-session", update);
  }, []);
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await api("/auth/logout", { method: "POST" }, true);
      setSession(null);
      navigate("/login");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-shell">
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <Link to="/" className="brand" onClick={() => setMobile(false)}>
          <span className="brand-mark">o</span>opueh
          <span className="brand-dot">.</span>
        </Link>
        <button
          className="mobile-close icon-button"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        >
          <X size={20} />
        </button>
        <p className="nav-label">YOUR SPACE</p>
        <nav aria-label="Main navigation">
          <NavLink to="/" end onClick={() => setMobile(false)}>
            <Compass size={20} /> Discover
          </NavLink>
          <NavLink to="/account" onClick={() => setMobile(false)}>
            <UserRound size={20} /> My profile
          </NavLink>
        </nav>
        <p className="nav-label">COMING NEXT</p>
        <div className="future-nav">
          <span>
            <Video size={20} /> Reels <small>SOON</small>
          </span>
          <span>
            <Radio size={20} /> Live streams <small>SOON</small>
          </span>
          <span>
            <MessageCircle size={20} /> Messages <small>SOON</small>
          </span>
        </div>
        <div className="sidebar-bottom">
          <div className="tiny-label">A PLACE TO BELONG</div>
          <p>
            Your people.
            <br />
            Your perspective.
          </p>
          <span className="edition">WEB · FIRST EDITION</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-toggle icon-button"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </button>
            <span>Connect. Create. Be you.</span>
          </div>
          <div className="topbar-actions">
            {session ? (
              <>
                <Link className="user-link" to="/account">
                  <span className="avatar small">
                    {(session.user.display_name || session.user.username)
                      .slice(0, 1)
                      .toUpperCase()}
                  </span>
                  <span>@{session.user.username}</span>
                </Link>
                <button
                  className="icon-button"
                  disabled={busy}
                  onClick={logout}
                  aria-label="Sign out"
                >
                  <LogOut size={19} />
                </button>
              </>
            ) : (
              <>
                <Link className="quiet-link" to="/login">
                  Sign in
                </Link>
                <Link className="button compact" to="/register">
                  Join Opueh <ArrowUpRight size={16} />
                </Link>
              </>
            )}
          </div>
        </header>
        {error && (
          <div className="global-error" role="alert">
            {error}
          </div>
        )}
        <main>
          <Routes>
            <Route path="/" element={<Discover signedIn={!!session} />} />
            <Route
              path="/login"
              element={
                session ? (
                  <Navigate to="/account" replace />
                ) : (
                  <AuthPage mode="login" />
                )
              }
            />
            <Route
              path="/register"
              element={
                session ? (
                  <Navigate to="/account" replace />
                ) : (
                  <AuthPage mode="register" />
                )
              }
            />
            <Route
              path="/forgot-password"
              element={<RecoveryPage mode="forgot" />}
            />
            <Route
              path="/reset-password"
              element={<RecoveryPage mode="reset" />}
            />
            <Route
              path="/verify-email"
              element={<RecoveryPage mode="verify" />}
            />
            <Route
              path="/account"
              element={
                session ? (
                  <AccountPage key={session.user.id} />
                ) : (
                  <Navigate to="/login" replace />
                )
              }
            />
            <Route
              path="*"
              element={
                <div className="empty-state">
                  <h1>Page not found</h1>
                  <p>Let’s get you back to your space.</p>
                  <Link className="button" to="/">
                    Back to Discover
                  </Link>
                </div>
              }
            />
          </Routes>
        </main>
        <footer>
          © {year} Opueh <span>Made for real connection.</span>
        </footer>
      </div>
    </div>
  );
}
function Discover({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="discover">
      <div className="page-intro">
        <div>
          <p className="eyebrow">GOOD PEOPLE. GREAT CONVERSATIONS.</p>
          <h1>
            A little closer to
            <br />
            your world.
          </h1>
        </div>
        <span className="pill">
          <span className="status-dot" /> Your community starts here
        </span>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-tag">
            <Sparkles size={15} /> THIS IS OPUEH
          </span>
          <h2>
            Find your people.
            <br />
            Share your spark.
          </h2>
          <p>
            A space for the stories, ideas and connections that make you, you.
            Start with your profile. Make it your own.
          </p>
          <Link
            className="button light"
            to={signedIn ? "/account" : "/register"}
          >
            {signedIn ? "Make it your space" : "Create your account"}
            <ArrowUpRight size={18} />
          </Link>
          <span className="hero-footnote">
            A fresh start for something worth sharing.
          </span>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="art-disc">
            <span>
              hello
              <br />
              world<span className="art-period">.</span>
            </span>
          </div>
          <div className="float-tag tag-one">
            <Radio size={17} /> A new perspective
          </div>
          <div className="float-tag tag-two">
            <MessageCircle size={17} /> Real connection
          </div>
          <span className="art-star">✳</span>
        </div>
      </section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">ONE SPACE. MANY POSSIBILITIES.</p>
          <h2>There’s more on the horizon</h2>
        </div>
        <span className="muted">Building the community, together.</span>
      </div>
      <div className="feature-grid">
        {[
          {
            icon: Radio,
            title: "Go live. Be present.",
            copy: "Bring people together around a moment. Live streaming is coming next.",
            color: "green",
          },
          {
            icon: Video,
            title: "Small moments. Big stories.",
            copy: "A new way to share your everyday. Reels are on the roadmap.",
            color: "orange",
          },
          {
            icon: MessageCircle,
            title: "Keep the conversation going.",
            copy: "Chats and calls that bring your circle closer. Coming in a future release.",
            color: "blue",
          },
        ].map(({ icon: Icon, title, copy, color }) => (
          <article className={`feature-card ${color}`} key={title}>
            <div className="feature-top">
              <span className="feature-icon">
                <Icon size={23} />
              </span>
              <span className="coming">COMING SOON</span>
            </div>
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>
      <section className="welcome-strip">
        <ShieldCheck size={28} />
        <div>
          <h3>Start with a space that’s yours.</h3>
          <p>Create a profile and choose the interests that matter to you.</p>
        </div>
        <Link className="text-link" to={signedIn ? "/account" : "/register"}>
          Get started <ArrowUpRight size={17} />
        </Link>
      </section>
    </div>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
