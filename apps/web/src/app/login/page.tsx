import { redirect } from "next/navigation";

import { currentSession } from "../../server/auth/actions";
import { LoginForm } from "./login-form";
import "./login.css";

export const metadata = { title: "Sign in · DesiAuction" };

export default async function LoginPage() {
  const session = await currentSession();
  if (session !== null) {
    redirect("/account");
  }
  return (
    <main className="login">
      <div className="login-panel">
        <h1>DesiAuction</h1>
        <p className="login-sub">Sign in with your mobile number.</p>
        <LoginForm />
      </div>
    </main>
  );
}
