/**
 * apps/web/src/pages/login.ts — Supabase Auth login page.
 */

import { getSupabase } from "../auth/index.js";
import { signInWithEmailMagicLink, signInWithGoogle } from "../auth/index.js";

export async function mountLogin(container: HTMLElement): Promise<() => void> {
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();

  // Already logged in → redirect
  if (session?.user) {
    window.location.href = "/reviews";
    return () => {};
  }

  container.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <div class="login-logo">
          <h1 class="login-brand">FatedFortress</h1>
          <p class="login-tagline">Review-centered task marketplace</p>
        </div>

        <div class="login-divider"><span>Sign in</span></div>

        <form class="login-form" id="magic-form">
          <div class="form-field">
            <label for="email">Email</label>
            <input type="email" id="email" required placeholder="you@example.com" autocomplete="email" />
          </div>
          <button type="submit" class="btn btn--primary btn--lg btn--full" id="magic-btn">
            Send magic link
          </button>
          <p class="login-hint">No password needed — you'll get an email with a secure link.</p>
        </form>

        <div class="login-divider"><span>or</span></div>

        <button class="btn btn--secondary btn--lg btn--full" id="google-btn">
          Continue with Google
        </button>

        <p class="login-legal">
          By signing in, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  `;

  // Magic link
  container.querySelector("#magic-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = (container.querySelector("#email") as HTMLInputElement).value.trim();
    const btn = container.querySelector("#magic-btn") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Sending...";
    try {
      await signInWithEmailMagicLink(email);
      container.querySelector(".login-form")?.setHTML("Check your email for a magic link!");
    } catch (err: any) {
      btn.disabled = false;
      btn.textContent = "Send magic link";
      alert(`Failed to send: ${err.message}`);
    }
  });

  // Google OAuth
  container.querySelector("#google-btn")?.addEventListener("click", async () => {
    const btn = container.querySelector("#google-btn") as HTMLButtonElement;
    btn.disabled = true;
    try {
      await signInWithGoogle();
    } catch (err: any) {
      btn.disabled = false;
      alert(`Google sign-in failed: ${err.message}`);
    }
  });

  return () => {};
}
