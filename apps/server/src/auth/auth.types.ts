/** İstek bağlamına (req.auth) yerleştirilen kimlik bilgisi — Clerk JWT'sinden
 *  veya misafir biletinden (X-Guest-Token) türetilir. */
export interface AuthContext {
  /** Clerk user id ya da misafir kimliği ("guest_<uuid>"). Guard kimliksiz isteği reddeder. */
  userId: string;
  /** Aktif Clerk organization id'si (workspace). Kişisel/misafir bağlamda null. */
  orgId: string | null;
  /** Aktif org'daki rol (örn. "org:admin"). Org yoksa null. */
  orgRole: string | null;
  /** Misafir bileti ile gelen kimlik (login'siz deneme). Yoksa Clerk kullanıcısı. */
  isGuest?: boolean;
}
