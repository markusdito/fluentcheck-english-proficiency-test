"use client";

import Link from "next/link";
import { signOut } from "@/lib/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";

interface AccountMenuProps {
  name?: string;
  email?: string;
  isAdmin?: boolean;
  showDashboard?: boolean;
  navigationItems?: Array<{
    href: string;
    label: string;
    current?: boolean;
  }>;
  navigationClassName?: string;
}

export function AccountMenu({
  name,
  email,
  isAdmin,
  showDashboard = true,
  navigationItems,
  navigationClassName,
}: AccountMenuProps) {
  const queryClient = useQueryClient();
  const initial = (name?.trim().charAt(0) ?? "?").toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="default"
            className="h-10 gap-2 px-2"
            aria-label="Account menu"
          />
        }
      >
        <Avatar size="sm">
          <AvatarFallback className="bg-ink text-[11px] font-semibold text-paper">
            {initial}
          </AvatarFallback>
        </Avatar>
        {name ? (
          <span className="hidden max-w-32 truncate text-sm font-medium text-ink-soft sm:block">
            {name}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-56">
        {email ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
        ) : null}
        {navigationItems?.length ? (
          <DropdownMenuGroup className={navigationClassName}>
            <DropdownMenuLabel>Admin navigation</DropdownMenuLabel>
            {navigationItems.map((item) => (
              <DropdownMenuItem
                key={item.href}
                className={
                  item.current
                    ? "bg-accent font-medium text-accent-foreground"
                    : undefined
                }
                render={
                  <Link
                    href={item.href}
                    aria-current={item.current ? "page" : undefined}
                  />
                }
              >
                {item.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
        ) : null}
        <DropdownMenuItem render={<Link href="/profile" />}>
          Profile
        </DropdownMenuItem>
        {showDashboard ? (
          <DropdownMenuItem render={<Link href="/dashboard" />}>
            Dashboard
          </DropdownMenuItem>
        ) : null}
        {isAdmin && !navigationItems?.length ? (
          <DropdownMenuItem render={<Link href="/admin" />}>
            Admin panel
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => void signOut(queryClient)}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
