/** Minimal Clerk SignUp snapshot for post-verify routing (avoids @clerk/types dep). */
export type SignUpSnapshot = {
  status: string | null;
  createdSessionId: string | null;
  unverifiedFields: string[];
  missingFields: string[];
  isTransferable: boolean;
  existingSession?: { sessionId: string } | null;
  verifications?: {
    emailAddress?: { status?: string | null } | null;
  } | null;
};

export function isSignUpEmailVerified(s: SignUpSnapshot): boolean {
  const status = s.verifications?.emailAddress?.status;
  if (status === "verified") return true;
  return !s.unverifiedFields.includes("email_address");
}

export function signUpSessionId(s: SignUpSnapshot): string | null {
  return s.createdSessionId ?? s.existingSession?.sessionId ?? null;
}

export function signUpNeedsLegalAccepted(s: SignUpSnapshot): boolean {
  if (s.status !== "missing_requirements") return false;
  return s.missingFields.includes("legal_accepted");
}

export function signUpNeedsOrganization(s: SignUpSnapshot): boolean {
  if (s.status !== "missing_requirements") return false;
  return s.missingFields.includes("organization");
}

/** Clerk sign-up with email verified but requirements pending (e.g. legal_accepted). */
export function signUpPendingAfterEmail(s: SignUpSnapshot): boolean {
  return isSignUpEmailVerified(s) && s.status === "missing_requirements";
}

export function toSignUpSnapshot(s: {
  status: string | null;
  createdSessionId: string | null;
  unverifiedFields?: string[] | null;
  missingFields?: string[] | null;
  isTransferable?: boolean;
  existingSession?: { sessionId: string } | null;
  verifications?: SignUpSnapshot["verifications"];
}): SignUpSnapshot {
  return {
    status: s.status,
    createdSessionId: s.createdSessionId,
    unverifiedFields: s.unverifiedFields ?? [],
    missingFields: s.missingFields ?? [],
    isTransferable: s.isTransferable ?? false,
    existingSession: s.existingSession,
    verifications: s.verifications,
  };
}
