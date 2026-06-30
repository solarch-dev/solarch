type ClerkErr = { code?: string; longMessage?: string; message?: string };

function clerkErrors(err: unknown): ClerkErr[] {
  return (err as { errors?: ClerkErr[] })?.errors ?? [];
}

/** Extracts a readable message from a Clerk error object. */
export function clerkError(err: unknown): string {
  const e = clerkErrors(err)[0];
  return e?.longMessage ?? e?.message ?? "Something went wrong. Please try again.";
}

/** OTP submitted after email was already verified (double-click / stale code). */
export function isVerificationAlreadyVerified(err: unknown): boolean {
  return clerkErrors(err).some((e) => {
    const code = e.code?.toLowerCase() ?? "";
    const msg = `${e.longMessage ?? ""} ${e.message ?? ""}`.toLowerCase();
    return (
      code === "verification_already_verified" ||
      (code.includes("already") && code.includes("verif")) ||
      msg.includes("already been verified") ||
      msg.includes("already verified")
    );
  });
}
