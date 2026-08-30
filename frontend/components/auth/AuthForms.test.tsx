import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/auth/LoginForm";
import { SignupForm } from "@/components/auth/SignupForm";

const mocks = vi.hoisted(() => ({
  clear: vi.fn(),
  post: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  setQueryData: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refresh,
    replace: mocks.replace,
  }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    clear: mocks.clear,
    setQueryData: mocks.setQueryData,
  }),
}));

vi.mock("@/lib/api", () => ({
  api: { post: mocks.post },
  ApiError: class ApiError extends Error {
    statusCode = 500;
  },
}));

afterEach(() => {
  window.history.replaceState(null, "", "/login");
  vi.clearAllMocks();
});

describe("LoginForm", () => {
  it("shows allowlisted Google errors, removes only google_error, and keeps the form usable", async () => {
    window.history.replaceState(null, "", "/login?google_error=cancelled&from=google#retry");

    const view = render(<LoginForm />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Google sign-in was cancelled. You can try again or use email and password.",
    );
    expect(window.location.search).toBe("?from=google");
    expect(window.location.hash).toBe("#retry");

    const googleLink = screen.getByRole("link", { name: "Continue with Google" });
    const emailField = screen.getByLabelText(/^Email/);
    expect(googleLink).toHaveAttribute(
      "href",
      "/backend-api/auth/google/start?returnTo=login",
    );
    expect(googleLink.compareDocumentPosition(emailField)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByRole("separator", { name: "or" })).toBeInTheDocument();

    view.rerender(<LoginForm />);
    expect(screen.getByRole("alert")).toHaveTextContent("Google sign-in was cancelled");
  });

  it("ignores an unallowlisted Google error while removing it from the URL", async () => {
    window.history.replaceState(
      null,
      "",
      "/login?google_error=provider_details_should_not_render",
    );

    render(<LoginForm />);

    expect(await screen.findByLabelText(/^Email/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.location.search).toBe("");
    expect(screen.queryByText(/provider_details_should_not_render/)).not.toBeInTheDocument();
  });

  it("preserves email/password validation", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});

describe("SignupForm", () => {
  it("uses the signup returnTo value and places Google auth before the fields", () => {
    render(<SignupForm />);

    const googleLink = screen.getByRole("link", { name: "Continue with Google" });
    const usernameField = screen.getByLabelText(/^Username/);
    expect(googleLink).toHaveAttribute(
      "href",
      "/backend-api/auth/google/start?returnTo=signup",
    );
    expect(googleLink.compareDocumentPosition(usernameField)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByRole("separator", { name: "or" })).toBeInTheDocument();
  });
});
