export interface AdminNavigationItem {
  href: string;
  label: string;
  exact?: boolean;
}

export const adminNavigationItems: AdminNavigationItem[] = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/submissions", label: "Submissions" },
  { href: "/admin/questions", label: "Questions" },
  { href: "/admin/settings", label: "Settings" },
];

export function isAdminNavigationItemActive(
  pathname: string,
  item: AdminNavigationItem,
) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}
