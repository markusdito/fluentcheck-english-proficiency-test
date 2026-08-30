import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";

describe("GoogleAuthButton", () => {
  it.each([
    ["login", "/backend-api/auth/google/start?returnTo=login"],
    ["signup", "/backend-api/auth/google/start?returnTo=signup"],
  ] as const)("links the %s flow to the backend start endpoint", (returnTo, href) => {
    render(<GoogleAuthButton returnTo={returnTo} />);

    const link = screen.getByRole("link", { name: "Continue with Google" });
    expect(link).toHaveAttribute("href", href);
    expect(screen.getByRole("separator", { name: "or" })).toBeInTheDocument();
    expect(screen.getByText("or")).toBeVisible();
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
