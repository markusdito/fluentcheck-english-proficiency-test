import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/SignupForm";
import { heading, subheading } from "@/components/auth/styles";

export const metadata: Metadata = { title: "SpeakNusa · Create account" };

export default function SignupPage() {
  return (
    <div className="animate-in fade-in slide-in-from-left-full duration-480 ease-spring motion-reduce:animate-none">
      <h1 className={heading}>Create your account</h1>
      <p className={subheading}>One account for every assessment and every report.</p>
      <div className="mt-7">
        <SignupForm />
      </div>
    </div>
  );
}
