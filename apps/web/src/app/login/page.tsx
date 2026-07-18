import { redirect } from "next/navigation";

import { currentSession } from "../../server/auth/actions";
import { LoginForm } from "./login-form";
import { PasskeyLogin } from "./passkey-login";
import "./login.css";

export const metadata = { title: "Sign in · DesiAuction" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [session, params] = await Promise.all([currentSession(), searchParams]);
  if (session !== null) {
    redirect("/home");
  }
  return (
    <main className="login">
      <div className="login-panel">
        <h1>DesiAuction</h1>
        <p className="login-sub">
          {params.next !== undefined
            ? "Sign in to continue where you were headed."
            : "Sign in with your mobile number."}
        </p>
        <LoginForm {...(params.next !== undefined ? { next: params.next } : {})} />
        <PasskeyLogin />
      </div>
    </main>
  );
}
