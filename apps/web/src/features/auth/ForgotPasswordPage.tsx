import { useState, useMemo, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useSignIn } from "@clerk/clerk-react";
import { Check } from "lucide-react";
import { AuthShell } from "./AuthShell";
import { TerminalChrome, AuthField, AuthButton, AuthError } from "./auth-ui";
import { clerkError } from "./clerk-error";
import { scorePassword, MIN_PASSWORD_LENGTH, MIN_PASSWORD_SCORE } from "./password-strength";
import { PasswordStrength } from "./PasswordStrength";

type Step = "request" | "code" | "password";

export function ForgotPasswordPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [step, setStep] = useState<Step>("request");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const strength = useMemo(() => scorePassword(password, [email]), [password, email]);

  // 1) Email → sends Clerk OTP code.
  const onRequest = async (e: FormEvent) => {
    e.preventDefault();
    if (!isLoaded || loading || !signIn) return;
    setError("");
    setLoading(true);
    try {
      await signIn.create({ strategy: "reset_password_email_code", identifier: email });
      setStep("code");
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setLoading(false);
    }
  };

  // 2) VERIFY code (passwordless) → needs_new_password → go to password step.
  const onVerifyCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!isLoaded || loading || !signIn) return;
    setError("");
    setLoading(true);
    try {
      const res = await signIn.attemptFirstFactor({ strategy: "reset_password_email_code", code });
      if (res.status === "needs_new_password") {
        setStep("password");
        return;
      }
      if (res.status === "complete") {
        await setActive({ session: res.createdSessionId });
        navigate("/start");
        return;
      }
      setError("Code could not be verified. Try again or request a new code.");
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setLoading(false);
    }
  };

  // 3) New password + confirm → resetPassword → sign in.
  const onSetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!isLoaded || loading || !signIn) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (strength.score < MIN_PASSWORD_SCORE) {
      setError(strength.warning || "Password is too weak — add length or make it less predictable.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await signIn.resetPassword({ password });
      if (res.status === "complete") {
        await setActive({ session: res.createdSessionId });
        navigate("/start");
        return;
      }
      if (res.status === "needs_second_factor") {
        setError("Two-factor authentication is required. Please sign in instead.");
        return;
      }
      setError("Could not reset password. Try again.");
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setLoading(false);
    }
  };

  const onResendCode = async () => {
    if (!isLoaded || loading || !signIn) return;
    setError("");
    setLoading(true);
    try {
      await signIn.create({ strategy: "reset_password_email_code", identifier: email });
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setLoading(false);
    }
  };

  const confirmTouched = confirm.length > 0;
  const confirmOk = confirmTouched && password === confirm;

  return (
    <AuthShell>
      <div className="overflow-hidden rounded-[12px] border border-[color:var(--hairline)] bg-[var(--paper-raised)] shadow-[var(--shadow-card)]">
        <TerminalChrome
          label={
            step === "password"
              ? "solarch@auth:~ reset"
              : step === "code"
                ? "solarch@auth:~ verify"
                : "solarch@auth:~ recover"
          }
        />
        <div className="p-6 sm:p-7">
          {step === "request" && (
            <>
              <h1 className="font-sans text-[23px] font-semibold tracking-[-0.02em] text-[color:var(--ink)]">
                Reset password
              </h1>
              <p className="mt-1 font-mono text-[13.5px] text-[color:var(--ink-faint)]">
                // we&apos;ll email you a 6-digit code
              </p>

              <form onSubmit={onRequest} className="mt-6 space-y-4">
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
                <div id="clerk-captcha" />
                <AuthButton loading={loading}>Send reset code</AuthButton>
              </form>

              <p className="mt-5 text-center font-mono text-[13.5px] text-[color:var(--ink-soft)]">
                Remembered it?{" "}
                <Link to="/sign-in" className="text-[#ff6b1a] hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          )}

          {step === "code" && (
            <>
              <h1 className="font-sans text-[23px] font-semibold tracking-[-0.02em] text-[color:var(--ink)]">
                Enter your code
              </h1>
              <p className="mt-1 font-mono text-[13.5px] text-[color:var(--ink-faint)]">
                // sent to <span className="text-[color:var(--ink-soft)]">{email}</span>
              </p>

              <form onSubmit={onVerifyCode} className="mt-6 space-y-4">
                <AuthError message={error} />
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
                <AuthButton loading={loading}>Verify code</AuthButton>
              </form>

              <p className="mt-5 text-center font-mono text-[13.5px] text-[color:var(--ink-soft)]">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void onResendCode()}
                  className="text-[#ff6b1a] hover:underline disabled:opacity-50"
                >
                  resend code
                </button>
                {" · "}
                <button
                  type="button"
                  onClick={() => { setStep("request"); setCode(""); setError(""); }}
                  className="text-[#ff6b1a] hover:underline"
                >
                  go back
                </button>
              </p>
            </>
          )}

          {step === "password" && (
            <>
              <h1 className="font-sans text-[23px] font-semibold tracking-[-0.02em] text-[color:var(--ink)]">
                Set a new password
              </h1>
              <p className="mt-1 font-mono text-[13.5px] text-[color:var(--ink-faint)]">
                // choose a strong password you don&apos;t use elsewhere
              </p>

              <form onSubmit={onSetPassword} className="mt-6 space-y-4">
                <AuthError message={error} />
                <AuthField
                  label="New password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="at least 8 characters"
                  autoFocus
                  autoComplete="new-password"
                />
                <PasswordStrength password={password} strength={strength} />
                <AuthField
                  label="Confirm password"
                  type="password"
                  value={confirm}
                  onChange={setConfirm}
                  placeholder="re-enter password"
                  autoComplete="new-password"
                />
                {confirmTouched && (
                  <div className="-mt-2 flex items-center gap-1.5 font-mono text-[12.5px]">
                    <span className="grid size-3.5 place-items-center">
                      {confirmOk ? (
                        <Check className="size-3.5 text-[#16a34a]" strokeWidth={2.5} />
                      ) : (
                        <span className="size-1.5 rounded-full bg-[#dc2626]" />
                      )}
                    </span>
                    <span className={confirmOk ? "text-[#16a34a]" : "text-[#dc2626]"}>
                      {confirmOk ? "Passwords match" : "Passwords do not match"}
                    </span>
                  </div>
                )}
                <AuthButton loading={loading}>Reset password</AuthButton>
              </form>

              <p className="mt-5 text-center font-mono text-[13.5px] text-[color:var(--ink-soft)]">
                <button
                  type="button"
                  onClick={() => { setStep("code"); setError(""); }}
                  className="text-[#ff6b1a] hover:underline"
                >
                  go back
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </AuthShell>
  );
}
