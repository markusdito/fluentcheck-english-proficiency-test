import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";
import { heading, subheading } from "@/components/auth/styles";

export const metadata: Metadata = { title: "SpeakNusa · Sign in" };

export default function LoginPage() {
  return (
    <div className="animate-in fade-in slide-in-from-right-full duration-480 ease-spring motion-reduce:animate-none">
      <h1 className={heading}>Sign in to SpeakNusa</h1>
      <p className={subheading}>Pick up your assessment or read your latest report.</p>
      <div className="mt-7">
        <LoginForm />
      </div>
    </div>
  );
}
