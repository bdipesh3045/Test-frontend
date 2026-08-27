"use client";

import { FirebaseError, type FirebaseOptions, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type Auth,
  type User,
} from "firebase/auth";
import { FormEvent, useEffect, useMemo, useState } from "react";

const CONFIG_STORAGE_KEY = "dreambuild.firebase.web-config";
const FIREBASE_APP_NAME = "dreambuild-auth-tester";

type AuthView = "signin" | "signup" | "forgot";

function parseFirebaseConfig(value: string): FirebaseOptions {
  let normalized = value.trim();
  normalized = normalized
    .replace(/^const\s+firebaseConfig\s*=\s*/, "")
    .replace(/;\s*$/, "")
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');

  const parsed = JSON.parse(normalized) as FirebaseOptions;
  const requiredKeys: Array<keyof FirebaseOptions> = ["apiKey", "authDomain", "projectId", "appId"];
  const missing = requiredKeys.filter((key) => !parsed[key]);
  if (missing.length) throw new Error(`Missing Firebase fields: ${missing.join(", ")}`);
  return parsed;
}

function readableError(error: unknown): string {
  if (!(error instanceof FirebaseError)) {
    return error instanceof Error ? error.message : "Something went wrong. Please try again.";
  }

  const messages: Record<string, string> = {
    "auth/account-exists-with-different-credential":
      "This email already uses a different sign-in method. Sign in with that method first.",
    "auth/email-already-in-use": "An account already exists for this email.",
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/missing-password": "Enter your password.",
    "auth/network-request-failed": "Network request failed. Check your connection and try again.",
    "auth/operation-not-allowed": "Enable this sign-in provider in Firebase Authentication.",
    "auth/popup-blocked": "Your browser blocked the Google sign-in popup.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
    "auth/unauthorized-domain":
      "Add this website's domain to Firebase Authentication → Settings → Authorized domains.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/weak-password": "Use a stronger password with at least 8 characters.",
  };
  return messages[error.code] ?? error.message;
}

function Field({
  label,
  name,
  type = "text",
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <label className="field" htmlFor={name}>
      <span>{label}</span>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required
      />
    </label>
  );
}

function ConfigSetup({ onSave }: { onSave: (config: FirebaseOptions) => void }) {
  const [configText, setConfigText] = useState(`{
  "apiKey": "",
  "authDomain": "",
  "projectId": "",
  "storageBucket": "",
  "messagingSenderId": "",
  "appId": ""
}`);
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      onSave(parseFirebaseConfig(configText));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The configuration is invalid.");
    }
  }

  return (
    <section className="auth-card setup-card" aria-labelledby="setup-title">
      <div className="card-heading">
        <span className="step-badge">Setup · one time</span>
        <h1 id="setup-title">Connect your Firebase project</h1>
        <p>Paste the web configuration from Firebase Project settings. It stays in this browser.</p>
      </div>

      <form onSubmit={submit} className="config-form">
        <label className="field" htmlFor="firebase-config">
          <span>Firebase web configuration</span>
          <textarea
            id="firebase-config"
            value={configText}
            onChange={(event) => setConfigText(event.target.value)}
            spellCheck={false}
            aria-describedby="config-help"
          />
        </label>
        <p id="config-help" className="helper-note">
          Project settings → General → Your apps → SDK setup and configuration
        </p>
        {error ? <div className="message error-message">{error}</div> : null}
        <button className="primary-button" type="submit">
          Save configuration and continue <span aria-hidden="true">→</span>
        </button>
      </form>

      <div className="safety-note">
        <span aria-hidden="true">i</span>
        <p>
          Paste only the Firebase <strong>web config</strong>. Never paste an Admin service-account
          JSON file here.
        </p>
      </div>
    </section>
  );
}

function AuthForms({ auth }: { auth: Auth }) {
  const [view, setView] = useState<AuthView>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const heading =
    view === "signup" ? "Create your account" : view === "forgot" ? "Reset your password" : "Welcome back";

  function switchView(next: AuthView) {
    setView(next);
    setMessage("");
    setError("");
    setPassword("");
    setConfirmPassword("");
  }

  async function googleSignIn() {
    setBusy(true);
    setError("");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitEmailAuth(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      if (view === "forgot") {
        await sendPasswordResetEmail(auth, email.trim());
        setMessage("If an account exists for this email, a password-reset link has been sent.");
        return;
      }

      if (view === "signup") {
        if (name.trim().length < 2) throw new Error("Enter your full name.");
        if (password.length < 8) throw new Error("Your password must contain at least 8 characters.");
        if (password !== confirmPassword) throw new Error("Passwords do not match.");
        if (!acceptedTerms) throw new Error("Accept the terms to create your account.");

        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(credential.user, { displayName: name.trim() });
        await sendEmailVerification(credential.user);
        setMessage("Account created. Check your email for the verification link.");
        return;
      }

      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      if (!credential.user.emailVerified) {
        setMessage("Signed in. Verify your email before connecting protected Django endpoints.");
      }
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="auth-heading">
      <div className="card-heading">
        <span className="eyebrow">DreamBuild account</span>
        <h1 id="auth-heading">{heading}</h1>
        <p>
          {view === "signup"
            ? "Create an account to save sites and build property proposals."
            : view === "forgot"
              ? "Enter your email and Firebase will send a secure reset link."
              : "Sign in to continue testing your property workspace."}
        </p>
      </div>

      {view !== "forgot" ? (
        <>
          <button className="google-button" type="button" onClick={googleSignIn} disabled={busy}>
            <span className="google-mark" aria-hidden="true">G</span> Continue with Google
          </button>
          <div className="divider"><span>or use email</span></div>
        </>
      ) : null}

      <form onSubmit={submitEmailAuth} className="auth-form">
        {view === "signup" ? (
          <Field label="Full name" name="full-name" value={name} onChange={setName} autoComplete="name" placeholder="Dipesh Sharma" />
        ) : null}
        <Field label="Email address" name="email" type="email" value={email} onChange={setEmail} autoComplete="email" placeholder="you@example.com" />
        {view !== "forgot" ? (
          <Field label="Password" name="password" type="password" value={password} onChange={setPassword} autoComplete={view === "signup" ? "new-password" : "current-password"} placeholder="At least 8 characters" />
        ) : null}
        {view === "signup" ? (
          <>
            <Field label="Confirm password" name="confirm-password" type="password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" placeholder="Repeat your password" />
            <label className="checkbox-row">
              <input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} />
              <span>I agree to the Terms and Privacy Policy.</span>
            </label>
          </>
        ) : null}

        {view === "signin" ? (
          <button className="text-button forgot-link" type="button" onClick={() => switchView("forgot")}>Forgot password?</button>
        ) : null}
        {error ? <div className="message error-message">{error}</div> : null}
        {message ? <div className="message success-message">{message}</div> : null}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Please wait…" : view === "signup" ? "Create account" : view === "forgot" ? "Send reset link" : "Sign in"}
          {!busy ? <span aria-hidden="true">→</span> : null}
        </button>
      </form>

      <div className="switch-prompt">
        {view === "signup" ? (
          <p>Already have an account? <button type="button" onClick={() => switchView("signin")}>Sign in</button></p>
        ) : view === "forgot" ? (
          <p>Remembered your password? <button type="button" onClick={() => switchView("signin")}>Back to sign in</button></p>
        ) : (
          <p>New to DreamBuild? <button type="button" onClick={() => switchView("signup")}>Create account</button></p>
        )}
      </div>
    </section>
  );
}

function AccountPanel({ auth, user }: { auth: Auth; user: User }) {
  const [busyAction, setBusyAction] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [, setRefreshCount] = useState(0);

  const providers = useMemo(
    () => user.providerData.map((provider) => provider.providerId === "google.com" ? "Google" : provider.providerId === "password" ? "Email/password" : provider.providerId).join(", "),
    [user],
  );

  async function runAction(label: string, action: () => Promise<void>) {
    setBusyAction(label);
    setMessage("");
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusyAction("");
    }
  }

  async function refreshUser() {
    await runAction("refresh", async () => {
      await user.reload();
      await user.getIdToken(true);
      setRefreshCount((count) => count + 1);
      setMessage(user.emailVerified ? "Account refreshed. Email is verified." : "Account refreshed. Email is not verified yet.");
    });
  }

  async function resendVerification() {
    await runAction("verify", async () => {
      await sendEmailVerification(user);
      setMessage("Verification email sent. Check your inbox.");
    });
  }

  async function createToken() {
    await runAction("token", async () => {
      setToken(await user.getIdToken(true));
      setMessage("Fresh Firebase ID token generated.");
    });
  }

  async function copyToken() {
    await navigator.clipboard.writeText(token);
    setMessage("Token copied. Treat it like a temporary password.");
  }

  const initial = (user.displayName || user.email || "U").charAt(0).toUpperCase();

  return (
    <section className="auth-card account-card" aria-labelledby="account-title">
      <div className="account-header">
        <div
          className="avatar"
          style={user.photoURL ? { backgroundImage: `url(${user.photoURL})` } : undefined}
          aria-label={user.displayName ? `${user.displayName} profile photo` : "User profile photo"}
        >
          {user.photoURL ? null : initial}
        </div>
        <div>
          <span className="step-badge success-badge">Authenticated</span>
          <h1 id="account-title">{user.displayName || "Firebase user"}</h1>
          <p>{user.email}</p>
        </div>
      </div>

      <dl className="account-details">
        <div><dt>Firebase UID</dt><dd>{user.uid}</dd></div>
        <div><dt>Provider</dt><dd>{providers || "Unknown"}</dd></div>
        <div><dt>Email status</dt><dd className={user.emailVerified ? "verified" : "unverified"}>{user.emailVerified ? "Verified" : "Not verified"}</dd></div>
      </dl>

      {!user.emailVerified ? (
        <div className="verification-callout">
          <div><strong>Verify your email</strong><p>Open the verification link, then refresh the account here.</p></div>
          <button type="button" onClick={resendVerification} disabled={Boolean(busyAction)}>{busyAction === "verify" ? "Sending…" : "Resend email"}</button>
        </div>
      ) : null}

      <div className="action-grid">
        <button type="button" className="secondary-button" onClick={refreshUser} disabled={Boolean(busyAction)}>{busyAction === "refresh" ? "Refreshing…" : "Refresh account"}</button>
        <button type="button" className="primary-button" onClick={createToken} disabled={Boolean(busyAction)}>{busyAction === "token" ? "Generating…" : "Generate ID token"}</button>
      </div>

      {token ? (
        <div className="token-box">
          <div className="token-heading"><span>Firebase ID token</span><button type="button" onClick={copyToken}>Copy token</button></div>
          <textarea value={token} readOnly aria-label="Firebase ID token" />
          <p>Later, send this as: <code>Authorization: Bearer &lt;token&gt;</code></p>
        </div>
      ) : null}
      {error ? <div className="message error-message">{error}</div> : null}
      {message ? <div className="message success-message">{message}</div> : null}
      <button className="logout-button" type="button" onClick={() => signOut(auth)}>Sign out</button>
    </section>
  );
}

export default function AuthTester() {
  const [config, setConfig] = useState<FirebaseOptions | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [authClient, setAuthClient] = useState<Auth | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [initializationError, setInitializationError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem(CONFIG_STORAGE_KEY);
      if (stored) {
        try {
          setConfig(JSON.parse(stored) as FirebaseOptions);
        } catch {
          window.localStorage.removeItem(CONFIG_STORAGE_KEY);
        }
      }
      setConfigLoaded(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!config) return;
    let unsubscribe = () => undefined;

    try {
      const existingApp = getApps().find((app) => app.name === FIREBASE_APP_NAME);
      const app = existingApp ?? initializeApp(config, FIREBASE_APP_NAME);
      const nextAuth = getAuth(app);
      setPersistence(nextAuth, browserLocalPersistence).catch(() => undefined);
      unsubscribe = onAuthStateChanged(nextAuth, (nextUser) => {
        setAuthClient(nextAuth);
        setUser(nextUser);
        setAuthReady(true);
      });
    } catch (caught) {
      window.setTimeout(() => {
        setInitializationError(readableError(caught));
        setAuthReady(true);
      }, 0);
    }
    return () => unsubscribe();
  }, [config]);

  function saveConfig(nextConfig: FirebaseOptions) {
    window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(nextConfig));
    window.location.reload();
  }

  function resetConfig() {
    window.localStorage.removeItem(CONFIG_STORAGE_KEY);
    window.location.reload();
  }

  return (
    <main className="site-shell">
      <section className="brand-panel">
        <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><span /></div><span>DreamBuild</span></div>
        <div className="brand-copy">
          <span className="test-label">Firebase authentication tester</span>
          <h2>Test identity before connecting your property backend.</h2>
          <p>Validate email signup, Google sign-in, verification, password reset, session persistence, and ID tokens in one focused screen.</p>
        </div>
        <div className="flow-list" aria-label="Authentication test flow">
          <div><span>01</span><p><strong>Connect</strong>Your Firebase web app</p></div>
          <div><span>02</span><p><strong>Authenticate</strong>Google or email/password</p></div>
          <div><span>03</span><p><strong>Inspect</strong>Generate a token for Django</p></div>
        </div>
        <p className="brand-footer">Test harness · No Django backend required</p>
      </section>

      <section className="workspace-panel">
        <header className="workspace-header">
          <span className="environment-pill"><i /> Test environment</span>
          {config ? <button type="button" onClick={resetConfig}>Change Firebase project</button> : null}
        </header>
        <div className="card-wrap">
          {!configLoaded ? <div className="loading-card">Loading tester…</div> : null}
          {configLoaded && !config ? <ConfigSetup onSave={saveConfig} /> : null}
          {config && initializationError ? (
            <section className="auth-card"><div className="message error-message">{initializationError}</div><button className="secondary-button" type="button" onClick={resetConfig}>Enter a different configuration</button></section>
          ) : null}
          {config && !initializationError && !authReady ? <div className="loading-card">Connecting to Firebase…</div> : null}
          {config && authReady && authClient && !user ? <AuthForms auth={authClient} /> : null}
          {config && authReady && authClient && user ? <AccountPanel auth={authClient} user={user} /> : null}
        </div>
        <p className="workspace-footer">Your Firebase web configuration is saved only in this browser.</p>
      </section>
    </main>
  );
}
