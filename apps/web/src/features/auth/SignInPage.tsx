import { useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useSignIn } from "@clerk/clerk-react";
import { AuthShell } from "./AuthShell";
import { TerminalChrome, AuthField, AuthButton, AuthError, AuthDivider } from "./auth-ui";
import { OAuthButtons } from "./OAuthButtons";
import { clerkError } from "./clerk-error";

type Step = "credentials" | "verify-device";

/** Clerk device verification (client trust): on a new device, even with a correct
 *  password the status returns `needs_client_trust` and emails a code. The SDK's
 *  SignInStatus type doesn't include this value yet — we compare strings. */
const NEEDS_DEVICE_VERIFICATION = new Set(["needs_client_trust", "needs_second_factor"]);

export function SignInPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("credentials");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  /** Prepare the email-code second step (device verification / 2FA-email). */
  const prepareEmailCode = async (): Promise<boolean> => {
    if (!signIn) return false;
    const factor = signIn.supportedSecondFactors?.find((f) => f.strategy === "email_code");
    if (!factor) return false;
    await signIn.prepareSecondFactor({
      strategy: "email_code",
      ...("emailAddressId" in factor && factor.emailAddressId
        ? { emailAddressId: factor.emailAddressId }
        : {}),
    });
    setStep("verify-device");
    setCode("");
    setError("");
    return true;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isLoaded || loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await signIn.create({ identifier: email, password });
      if (res.status === "complete") {
        await setActive({ session: res.createdSessionId });
        navigate("/start");
      } else if (NEEDS_DEVICE_VERIFICATION.has(res.status ?? "")) {
        // New device — proceed to the verification step using the emailed code.
        if (!(await prepareEmailCode())) {
          setError("This sign-in needs extra verification we don't support yet. Try Google/GitHub.");
        }
      } else {
        setError("An additional verification step is required.");
      }
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setLoading(false);
    }
  };

  const onVerifyDevice = async (e: FormEvent) => {
    e.preventDefault();
    if (!isLoaded || loading || !signIn) return;
    setError("");
    setLoading(true);
    try {
      const res = await signIn.attemptSecondFactor({ strategy: "email_code", code });
      if (res.status === "complete") {
        await setActive({ session: res.createdSessionId });
        navigate("/start");
      } else {
        setError("Code could not be verified. Try again or request a new code.");
      }
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setLoading(false);
    }
  };

  const onResendCode = async () => {
    if (!isLoaded || loading) return;
    setError("");
    setLoading(true);
    try {
      await prepareEmailCode();
    } catch (err) {
      setError(clerkError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="overflow-hidden rounded-[12px] border border-[color:var(--hairline)] bg-[var(--paper-raised)] shadow-[var(--shadow-card)]">
        <TerminalChrome label={step === "verify-device" ? "solarch@auth:~ verify-device" : "solarch@auth:~ login"} />
        <div className="p-6 sm:p-7">
          {step === "credentials" && (
            <>
              <h1 className="font-sans text-[23px] font-semibold tracking-[-0.02em] text-[color:var(--ink)]">
                Welcome back
              </h1>
              <p className="mt-1 font-mono text-[13.5px] text-[color:var(--ink-faint)]">
                // continue your architecture where you left off
              </p>

              <div className="mt-6 space-y-4">
                <OAuthButtons mode="signIn" />
                <AuthDivider />
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
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
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
                <div className="-mt-1 text-right">
                  <Link to="/forgot-password" className="font-mono text-[12.5px] text-[#ff6b1a] hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <AuthButton loading={loading}>Sign in</AuthButton>
              </form>

              <p className="mt-5 text-center font-mono text-[13.5px] text-[color:var(--ink-soft)]">
                Don&apos;t have an account?{" "}
                <Link to="/sign-up" className="text-[#ff6b1a] hover:underline">
                  Sign up
                </Link>
              </p>
            </>
          )}

          {step === "verify-device" && (
            <>
              <h1 className="font-sans text-[23px] font-semibold tracking-[-0.02em] text-[color:var(--ink)]">
                Verify this device
              </h1>
              <p className="mt-1 font-mono text-[13.5px] text-[color:var(--ink-faint)]">
                // new device detected — we sent a 6-digit code to{" "}
                <span className="text-[color:var(--ink-soft)]">{email}</span>
              </p>

              <form onSubmit={onVerifyDevice} className="mt-6 space-y-4">
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
                <AuthButton loading={loading}>Verify and sign in</AuthButton>
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
                  onClick={() => { setStep("credentials"); setCode(""); setError(""); }}
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
