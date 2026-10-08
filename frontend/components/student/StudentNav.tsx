"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, LogOut, UserRound } from "lucide-react";
import { signOut } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { container, focusRing, meta } from "./styles";

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase();
}

const item =
  "min-h-11 gap-3 rounded-[10px] px-3 py-2 text-[15px] font-medium text-sn-fg focus:bg-sn-fg/6 focus:text-sn-fg [&_svg]:size-[18px]!";

interface StudentNavProps {
  name: string;
  email: string;
  label?: string;
  /** Role home; admins land on /admin. */
  homeHref?: string;
}

export function StudentNav({ name, email, label = "Student", homeHref = "/dashboard" }: StudentNavProps) {
  const queryClient = useQueryClient();
  return (
    <header className="sticky top-0 z-10 border-b border-sn-border bg-sn-bg/92 backdrop-blur-md">
      <div className={`${container} flex items-center justify-between gap-5 py-3.5`}>
        <Link className={`inline-flex items-baseline gap-2 rounded ${focusRing}`} href="/" aria-label="SpeakNusa home">
          <span className="text-[17px] font-normal lowercase tracking-[-0.01em] min-[381px]:text-[19px]">
            <b className="font-bold">speak</b>nusa
          </span>
          <span className={meta}>{label}</span>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={`grid size-11 cursor-pointer place-items-center rounded-full border border-sn-navy/24 bg-sn-field-navy p-0 text-[15px] font-semibold tracking-[0.02em] text-sn-navy transition-colors duration-200 hover:border-sn-navy data-popup-open:border-sn-navy ${focusRing}`}
            aria-label={`Account menu for ${name}`}
          >
            <span aria-hidden="true">{initials(name)}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            className="w-[min(264px,calc(100vw-40px))] rounded-2xl bg-sn-surface p-2 font-albert text-sn-fg shadow-[0_12px_32px_color-mix(in_oklch,var(--color-sn-navy)_14%,transparent)] ring-sn-border"
          >
            <div className="mb-2 grid gap-0.5 border-b border-sn-border px-3 pt-2 pb-3">
              <span className="truncate text-[15px] font-semibold">{name}</span>
              <span className="truncate text-[13px] text-sn-muted">{email}</span>
            </div>
            <DropdownMenuItem className={item} render={<Link href={homeHref} />}>
              <LayoutGrid strokeWidth={1.6} aria-hidden="true" />
              {homeHref === "/admin" ? "Admin panel" : "Dashboard"}
            </DropdownMenuItem>
            <DropdownMenuItem className={item} render={<Link href="/profile" />}>
              <UserRound strokeWidth={1.6} aria-hidden="true" />
              Profile &amp; settings
            </DropdownMenuItem>
            <DropdownMenuSeparator className="mx-0 my-2 bg-sn-border" />
            <DropdownMenuItem className={item} onClick={() => void signOut(queryClient)}>
              <LogOut strokeWidth={1.6} aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
