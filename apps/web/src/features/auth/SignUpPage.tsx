import { useState, useEffect, useCallback, useMemo, useRef, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useSignUp, TaskChooseOrganization } from "@clerk/clerk-react";
import { scorePassword, MIN_PASSWORD_LENGTH, MIN_PASSWORD_SCORE } from "./password-strength";
import { PasswordStrength } from "./PasswordStrength";
import { AuthShell } from "./AuthShell";
import { TerminalChrome, AuthField, AuthButton, AuthError, LegalAcceptLabel, AuthDivider } from "./auth-ui";
import { OAuthButtons } from "./OAuthButtons";
import { clerkError, isVerificationAlreadyVerified } from "./clerk-error";
import {
  isSignUpEmailVerified,
  signUpNeedsLegalAccepted,
  signUpNeedsOrganization,
  signUpPendingAfterEmail,
  signUpSessionId,
  toSignUpSnapshot,
  type SignUpSnapshot,
} from "./sign-up-flow";

type Step = "register" | "verify" | "organization";

export function SignUpPage() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Terms checkbox is pre-checked (consistent with OAuth's "by continuing you agree"
  // wording) — user can uncheck it, which then surfaces a warning.
  const [legalAccepted, setLegalAccepted] = useState(true);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("register");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const strength = useMemo(() => scorePassword(password, [email]), [password, email]);

  const activateAndStart = useCallback(
    async (resource: SignUpSnapshot) => {
      const sessionId = signUpSessionId(resource);
      if (sessionId && setActive) await setActive({ session: sessionId });
      navigate("/start");
      return true;
    },
    [navigate, setActive],
  );

  const proceedAfterEmailVerified = useCallback(
    async (resource: SignUpSnapshot): Promise<boolean> => {
      if (!isSignUpEmailVerified(resource)) return false;

      if (resource.status === "complete") {
        return activateAndStart(resource);
      }

      if (resource.isTransferable) {
        setError("This email is already registered. Please sign in.");
        return true;
      }

      if (signUpNeedsLegalAccepted(resource)) {
        return false;
      }

      if (signUpNeedsOrganization(resource)) {
        const sessionId = signUpSessionId(resource);
        if (sessionId && setActive) await setActive({ session: sessionId });
        setStep("organization");
        setError("");
        return true;
      }

      if (signUpSessionId(resource)) {
        return activateAndStart(resource);
      }

      if (signUpPendingAfterEmail(resource)) {
        setError("Accept the terms below, then continue.");
        return true;
      }

      return false;
    },
    [activateAndStart, setActive],
  );

  /** Apply missing Clerk fields (legal_accepted) then continue. */
  const finishMissingRequirements = useCallback(async (): Promise<boolean> => {
    if (!signUp) return false;

    if (signUpNeedsLegalAccepted(toSignUpSnapshot(signUp))) {
      await signUp.update({ legalAccepted: true });
    }

    return proceedAfterEmailVerified(toSignUpSnapshot(signUp));
  }, [signUp, proceedAfterEmailVerified]);

  // Resume: email already verified (refresh / second code submit).
  useEffect(() => {
    if (!isLoaded || !signUp || step !== "verify") return;
    if (!isSignUpEmailVerified(toSignUpSnapshot(signUp))) return;
    void (async () => {
      setLoading(true);
      try {
        if (await finishMissingRequirements()) return;
      } finally {
        setLoading(false);
      }
    })();
  }, [isLoaded, signUp, step, finishMissingRequirements]);

  // OAuth return: catch the half-finished sign-up that falls back to /sign-up from
  // Google/GitHub missing legal_accepted — pressing OAuth counts as accepting the
  // terms (OAuthLegalNote), so close the gap and finish the flow. Don't show an empty
  // register form and bounce the user back for no reason. (one-shot: avoid an update
  // loop on StrictMode/dep changes)
  const oauthResumeAttempted = useRef(false);
  useEffect(() => {
    if (oauthResumeAttempted.current) return;
    if (!isLoaded || !signUp || step !== "register") return;
    const snap = toSignUpSnapshot(signUp);
    if (snap.status !== "complete" && !signUpPendingAfterEmail(snap)) return;
    oauthResumeAttempted.current = true;
    void (async () => {
      setLoading(true);
      try {
        await finishMissingRequirements();
      } catch (err) {
        setError(clerkError(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [isLoaded, signUp, step, finishMissingRequirements]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!isLoaded || loading) return;
    if (!legalAccepted) {
      setError("Please accept the Terms of Service and Privacy Policy.");
      return;
    }
    // Validate password rules client-side — avoid a round-trip to Clerk just to be rejected.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (strength.score < MIN_PASSWORD_SCORE) {
      setError(strength.warning || "Password is too weak — add length or make it less predictable.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await signUp.create({ emailAddress: email, password, legalAccepted: true });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setStep("verify");
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setLoading(false);
    }
  };

  const onVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (!isLoaded || loading || !signUp) return;
    setError("");
    setLoading(true);
    try {
      if (isSignUpEmailVerified(toSignUpSnapshot(signUp))) {
        if (await finishMissingRequirements()) return;
      }

      const res = await signUp.attemptEmailAddressVerification({ code });
      if (await finishMissingRequirements()) return;
      if (await proceedAfterEmailVerified(toSignUpSnapshot(res))) return;
      if (await proceedAfterEmailVerified(toSignUpSnapshot(signUp))) return;
      setError("Code could not be verified. Try again or request a new code.");
    } catch (err) {
      if (isVerificationAlreadyVerified(err)) {
        if (await finishMissingRequirements()) return;
        setError("Email already verified. Accept terms if shown, or sign in.");
        return;
      }
      setError(clerkError(err));
    } finally {
      setLoading(false);
    }
  };

  const onContinueAfterVerified = async () => {
    if (!legalAccepted) {
      setError("Please accept the Terms of Service and Privacy Policy.");
      return;
    }
    if (!isLoaded || loading || !signUp) return;
    setError("");
    setLoading(true);
    try {
      if (await finishMissingRequirements()) return;
      setError("Could not complete sign-up. Try signing in.");
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setLoading(false);
    }
  };

  const onResendCode = async () => {
    if (!isLoaded || loading || !signUp) return;
    setError("");
    setLoading(true);
    try {
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setLoading(false);
    }
  };

  const emailAlreadyVerified = isLoaded && signUp && isSignUpEmailVerified(toSignUpSnapshot(signUp));

  return (
    <AuthShell>
      <div className="overflow-hidden rounded-[12px] border border-[color:var(--hairline)] bg-[var(--paper-raised)] shadow-[var(--shadow-card)]">
        <TerminalChrome
          label={
            step === "organization"
              ? "solarch@auth:~ workspace"
              : step === "verify"
                ? "solarch@auth:~ verify"
                : "solarch@auth:~ register"
          }
        />
        <div className="p-6 sm:p-7">
          {step === "register" && (
            <>
              <h1 className="font-sans text-[23px] font-semibold tracking-[-0.02em] text-[color:var(--ink)]">
                Create account
              </h1>
              <p className="mt-1 font-mono text-[13.5px] text-[color:var(--ink-faint)]">
                // set up your first architecture in minutes
              </p>

              <div className="mt-6 space-y-4">
                <OAuthButtons mode="signUp" />
                <AuthDivider />
              </div>

              <form onSubmit={onCreate} className="space-y-4">
                <AuthError message={error} />
                <AuthField
                  label="Email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@company.com"
                  autoFocus
                  autoComplete="email"
                />
                <AuthField
                  label="Password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="at least 8 characters"
                  autoComplete="new-password"
                />
                <PasswordStrength password={password} strength={strength} />
                <label className="flex items-start gap-3 text-left">
                  <input
                    type="checkbox"
                    checked={legalAccepted}
                    onChange={(e) => setLegalAccepted(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-[color:var(--hairline)] accent-[#ff6b1a]"
                  />
                  <LegalAcceptLabel />
                </label>
                <div id="clerk-captcha" />
                <AuthButton loading={loading}>Create account</AuthButton>
              </form>

              <p className="mt-5 text-center font-mono text-[13.5px] text-[color:var(--ink-soft)]">
                Already have an account?{" "}
                <Link to="/sign-in" className="text-[#ff6b1a] hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          )}

          {step === "verify" && (
            <>
              <h1 className="font-sans text-[23px] font-semibold tracking-[-0.02em] text-[color:var(--ink)]">
                {emailAlreadyVerified ? "Almost done" : "Verify your email"}
              </h1>
              <p className="mt-1 font-mono text-[13.5px] text-[color:var(--ink-faint)]">
                {emailAlreadyVerified
                  ? "// email verified — accept terms to finish"
                  : <>// we sent a 6-digit code to <span className="text-[color:var(--ink-soft)]">{email}</span></>}
              </p>

              <div className="mt-6 space-y-4">
                <AuthError message={error} />
                {!emailAlreadyVerified && (
                  <form onSubmit={onVerify} className="space-y-4">
                    <AuthField
                      label="Verification code"
                      value={code}
                      onChange={setCode}
                      placeholder="123456"
                      autoFocus
                      inputMode="numeric"
                      maxLength={6}
                      autoComplete="one-time-code"
                    />
                    <AuthButton loading={loading}>Verify and continue</AuthButton>
                  </form>
                )}
                {emailAlreadyVerified && (
                  <>
                    <label className="flex items-start gap-3 text-left">
                      <input
                        type="checkbox"
                        checked={legalAccepted}
                        onChange={(e) => setLegalAccepted(e.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-[color:var(--hairline)] accent-[#ff6b1a]"
                      />
                      <LegalAcceptLabel />
                    </label>
                    <AuthButton loading={loading} type="button" onClick={() => void onContinueAfterVerified()}>
                      Continue
                    </AuthButton>
                  </>
                )}
              </div>

              <p className="mt-5 text-center font-mono text-[13.5px] text-[color:var(--ink-soft)]">
                {!emailAlreadyVerified && (
                  <>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void onResendCode()}
                      className="text-[#ff6b1a] hover:underline disabled:opacity-50"
                    >
                      resend code
                    </button>
                    {" · "}
                  </>
                )}
                <button
                  type="button"
                  onClick={() => { setStep("register"); setCode(""); setError(""); }}
                  className="text-[#ff6b1a] hover:underline"
                >
                  go back
                </button>
                {" · "}
                <Link to="/sign-in" className="text-[#ff6b1a] hover:underline">
                  sign in
                </Link>
              </p>
            </>
          )}

          {step === "organization" && (
            <>
              <h1 className="font-sans text-[23px] font-semibold tracking-[-0.02em] text-[color:var(--ink)]">
                Choose a workspace
              </h1>
              <p className="mt-1 font-mono text-[13.5px] text-[color:var(--ink-faint)]">
                // create or join an organization to continue
              </p>
              <AuthError message={error} />
              <div className="mt-6 min-h-[280px]">
                <TaskChooseOrganization redirectUrlComplete="/start" />
              </div>
            </>
          )}
        </div>
      </div>
    </AuthShell>
  );
}
