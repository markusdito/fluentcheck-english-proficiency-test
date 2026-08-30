import { describe, expect, it } from "vitest";
import { getGoogleAuthErrorMessage } from "@/lib/google-auth";

describe("getGoogleAuthErrorMessage", () => {
  it("maps an allowlisted cancellation code to friendly copy", () => {
    expect(getGoogleAuthErrorMessage("cancelled")).toBe(
      "Google sign-in was cancelled. You can try again or use email and password.",
    );
  });

  it("maps account conflicts without exposing provider details", () => {
    expect(getGoogleAuthErrorMessage("account_conflict")).toBe(
      "An account with this email already exists. Sign in with email and password instead.",
    );
  });

  it("maps provider failures and inactive accounts to safe copy", () => {
    expect(getGoogleAuthErrorMessage("provider_error")).toBe(
      "Google sign-in is temporarily unavailable. Please try again later.",
    );
    expect(getGoogleAuthErrorMessage("account_inactive")).toBe(
      "This account is no longer active. Please contact support.",
    );
  });

  it("does not render unallowlisted provider errors", () => {
    expect(getGoogleAuthErrorMessage("provider_response_contains_sensitive_data")).toBeNull();
    expect(getGoogleAuthErrorMessage(null)).toBeNull();
  });
});
