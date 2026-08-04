import { api } from "./api";

export async function signOut() {
  try {
    await api.post("/auth/logout");
  } finally {
    window.location.href = "/";
  }
}
