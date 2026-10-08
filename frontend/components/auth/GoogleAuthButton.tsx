import { getGoogleAuthStartPath } from "@/lib/google-auth";
import { focusRing } from "@/components/auth/styles";

export type GoogleAuthReturnTo = "login" | "signup";

interface GoogleAuthButtonProps {
  returnTo: GoogleAuthReturnTo;
  dividerLabel?: string;
}

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      className="size-[18px]"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path
        fill="#4285F4"
        d="M21.35 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.42Z"
      />
      <path
        fill="#34A853"
        d="M12 21.7c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.7-1.72-5.47-4.04H3.28v2.53A9.75 9.75 0 0 0 12 21.7Z"
      />
      <path
        fill="#FBBC05"
        d="M6.53 13.77A5.86 5.86 0 0 1 6.22 12c0-.61.1-1.21.31-1.77V7.7H3.28A9.75 9.75 0 0 0 2.25 12c0 1.57.38 3.05 1.03 4.3l3.25-2.53Z"
      />
      <path
        fill="#EA4335"
        d="M12 6.19c1.43 0 2.72.49 3.73 1.45l2.8-2.8C16.84 3.25 14.63 2.3 12 2.3a9.75 9.75 0 0 0-8.72 5.4l3.25 2.53C7.3 7.91 9.46 6.19 12 6.19Z"
      />
    </svg>
  );
}

export function GoogleAuthButton({ returnTo, dividerLabel = "or" }: GoogleAuthButtonProps) {
  return (
    <div>
      <a
        href={getGoogleAuthStartPath(returnTo)}
        className={`inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-full border border-sn-fg/22 bg-sn-surface text-[15px] font-medium text-sn-fg transition-[background-color,border-color,transform] duration-200 ease-standard hover:border-sn-fg hover:bg-[color-mix(in_oklch,var(--color-sn-fg)_5%,var(--color-sn-surface))] active:scale-[0.98] ${focusRing}`}
      >
        <GoogleMark />
        <span>Continue with Google</span>
      </a>

      <div
        role="separator"
        aria-label={dividerLabel}
        className="my-6 flex items-center gap-3.5 text-[13px] text-sn-muted"
      >
        <span aria-hidden="true" className="h-px flex-1 bg-sn-border" />
        <span aria-hidden="true">{dividerLabel}</span>
        <span aria-hidden="true" className="h-px flex-1 bg-sn-border" />
      </div>
    </div>
  );
}
