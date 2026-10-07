"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { container } from "./styles";

/* outlined pill; a dark fill sweeps in from the left on hover and focus */
const pill =
  "relative isolate inline-flex min-h-11 items-center overflow-hidden rounded-full border border-sn-fg/40 px-5 py-2.5 text-sm font-medium whitespace-nowrap text-sn-fg transition-[color,border-color,transform] duration-240 ease-standard hover:-translate-y-px hover:border-sn-fg hover:text-sn-surface focus-visible:border-sn-fg focus-visible:text-sn-surface active:scale-[0.97] before:absolute before:inset-0 before:-z-10 before:origin-left before:scale-x-0 before:rounded-[inherit] before:bg-sn-fg before:transition-transform before:duration-320 before:ease-spring hover:before:scale-x-100 focus-visible:before:scale-x-100";

/* text darkens and a thin underline draws in from the left */
const navLink =
  "relative inline-flex min-h-11 items-center px-1 py-2.5 text-sm text-sn-muted transition-colors duration-200 ease-standard hover:text-sn-fg focus-visible:text-sn-fg after:absolute after:inset-x-1 after:bottom-[9px] after:h-[1.5px] after:origin-right after:scale-x-0 after:rounded-[1px] after:bg-current after:transition-transform after:duration-160 after:ease-standard hover:after:origin-left hover:after:scale-x-100 hover:after:duration-280 hover:after:ease-spring focus-visible:after:origin-left focus-visible:after:scale-x-100";

const glassShadow =
  "shadow-[inset_0_1.5px_1px_rgb(255_255_255/0.85),inset_0_-2px_4px_rgb(255_255_255/0.28),inset_0_0_2px_1px_rgb(255_255_255/0.55),inset_0_0_10px_4px_rgb(255_255_255/0.22),0_6px_24px_rgb(17_17_26/0.06),0_12px_40px_rgb(17_17_26/0.05)]";

const links = [
  { href: "#journey", label: "How it works" },
  { href: "#rubric", label: "Rubric" },
  { href: "#roles", label: "Roles" },
];

/* Displacement map for the glass pill: content bulges near the rim (Chromium only). */
function lensMap(w: number, h: number, r: number, bezel: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const bx = w / 2 - r;
  const by = h / 2 - r;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - w / 2;
      const py = y + 0.5 - h / 2;
      const qx = Math.abs(px) - bx;
      const qy = Math.abs(py) - by;
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const len = Math.sqrt(ox * ox + oy * oy);
      const dist = len + Math.min(Math.max(qx, qy), 0) - r;
      let nx = 0;
      let ny = 0;
      if (len > 0) {
        nx = (ox / len) * (px < 0 ? -1 : 1);
        ny = (oy / len) * (py < 0 ? -1 : 1);
      } else if (qx > qy) nx = px < 0 ? -1 : 1;
      else ny = py < 0 ? -1 : 1;
      const t = Math.min(Math.max(-dist / bezel, 0), 1);
      const s = dist > 0 ? 0 : Math.pow(1 - t, 2.2);
      const i = (y * w + x) * 4;
      d[i] = 128 - nx * s * 127;
      d[i + 1] = 128 - ny * s * 127;
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

function AccountPill() {
  const session = useSession();
  if (session.isPending) {
    return (
      <span className={pill} role="status" aria-label="Checking session">
        &nbsp;
      </span>
    );
  }
  if (session.data) {
    return (
      <Link
        className={pill}
        href={session.data.role === "ADMIN" ? "/admin" : "/dashboard"}
      >
        Dashboard
      </Link>
    );
  }
  return (
    <Link className={pill} href="/login">
      Sign in
    </Link>
  );
}

export function LandingNav() {
  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const filterRef = useRef<SVGFilterElement>(null);
  const feImageRef = useRef<SVGFEImageElement>(null);
  const [island, setIsland] = useState(false);
  const [open, setOpen] = useState(false);
  const [lens, setLens] = useState(false);

  /* island engages once the bar overlaps the hero title or art; hysteresis stops flicker */
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>("[data-island-target]"),
    );
    const onScroll = () => {
      const nb = nav.getBoundingClientRect().bottom;
      const edge = Math.min(
        ...targets.map((el) => el.getBoundingClientRect().top),
      );
      const overlap = nb - edge;
      setIsland((was) => (was ? overlap >= 2 : overlap >= 6));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  /* magnifier lens on the pill, only where backdrop-filter accepts an SVG filter */
  useEffect(() => {
    const nav = navRef.current;
    const filt = filterRef.current;
    const feImg = feImageRef.current;
    if (
      !island ||
      !nav ||
      !filt ||
      !feImg ||
      !CSS.supports("backdrop-filter", "url(#nav-lens) blur(1px)")
    )
      return;
    let lastW = 0;
    let lastH = 0;
    let raf = 0;
    const rebuild = () => {
      raf = 0;
      const w = Math.round(nav.offsetWidth);
      const h = Math.round(nav.offsetHeight);
      if (!w || !h || (w === lastW && h === lastH)) return;
      lastW = w;
      lastH = h;
      const r = Math.min(
        parseFloat(getComputedStyle(nav).borderTopLeftRadius) || h / 2,
        h / 2,
      );
      const url = lensMap(w, h, r, Math.min(26, h / 2));
      if (!url) return;
      for (const el of [filt, feImg]) {
        el.setAttribute("width", String(w));
        el.setAttribute("height", String(h));
      }
      feImg.setAttribute("href", url);
      setLens(true);
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(rebuild);
    };
    const ro = new ResizeObserver(queue);
    ro.observe(nav);
    queue();
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [island]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !burgerRef.current?.contains(t))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <svg
        width="0"
        height="0"
        style={{ position: "absolute" }}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <filter
            ref={filterRef}
            id="nav-lens"
            filterUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="1000"
            height="60"
            colorInterpolationFilters="sRGB"
          >
            <feImage
              ref={feImageRef}
              x="0"
              y="0"
              width="1000"
              height="60"
              preserveAspectRatio="none"
              result="map"
            />
            <feDisplacementMap in="SourceGraphic" in2="map" scale="36" xChannelSelector="R" yChannelSelector="G" result="dispR" />
            <feColorMatrix in="dispR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale="32" xChannelSelector="R" yChannelSelector="G" result="dispG" />
            <feColorMatrix in="dispG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale="28" xChannelSelector="R" yChannelSelector="G" result="dispB" />
            <feColorMatrix in="dispB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
            <feBlend in="r" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="b" mode="screen" />
          </filter>
        </defs>
      </svg>
      <header
        ref={navRef}
        // every morphable value is declared in both states so the island interpolates each frame
        className={`fixed inset-x-0 z-20 mx-auto border transition-all duration-450 ease-spring before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-[radial-gradient(120%_160%_at_12%_-20%,rgb(255_255_255/0.55),transparent_55%),linear-gradient(180deg,rgb(255_255_255/0.5),rgb(255_255_255/0.1)_45%,rgb(255_255_255/0)_62%,rgb(255_255_255/0.12))] before:transition-opacity before:duration-450 before:ease-spring ${
          island
            ? `top-3 max-w-[min(1120px,calc(100%-32px))] rounded-[28px] border-sn-fg/8 sm:rounded-[50px] before:opacity-100 ${glassShadow} ${
                lens
                  ? "bg-white/20 [backdrop-filter:url(#nav-lens)_blur(5px)_saturate(1.5)]"
                  : "bg-white/40 backdrop-blur-md backdrop-saturate-140"
              }`
            : "top-0 max-w-full rounded-none border-transparent before:opacity-0"
        }`}
      >
        <div className={`${container} relative flex items-center justify-between transition-[padding] duration-450 ease-spring ${island ? "py-2.5 sm:px-5!" : "py-[18px]"}`}>
          <div className="flex items-center gap-1">
            <button
              ref={burgerRef}
              className="group/burger -ml-2.5 inline-flex size-11 cursor-pointer items-center justify-center text-sn-fg sm:hidden"
              type="button"
              aria-expanded={open}
              aria-controls="mobile-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((o) => !o)}
            >
              <svg className="size-5.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M4 8h16" className="origin-center transition-transform duration-300 ease-spring [transform-box:fill-box] group-aria-expanded/burger:translate-y-1 group-aria-expanded/burger:rotate-45" />
                <path d="M4 16h16" className="origin-center transition-transform duration-300 ease-spring [transform-box:fill-box] group-aria-expanded/burger:-translate-y-1 group-aria-expanded/burger:-rotate-45" />
              </svg>
            </button>
            <Link className="inline-flex items-baseline gap-2" href="/" aria-label="SpeakNusa home">
              <span className="text-[17px] font-normal tracking-[-0.01em] lowercase min-[381px]:text-[19px]">
                <b>speak</b>nusa
              </span>
            </Link>
          </div>
          <nav aria-label="Sections" className="hidden items-center gap-8 sm:flex">
            {links.map((l) => (
              <a key={l.href} href={l.href} className={navLink}>
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <AccountPill />
          </div>
          <div
            ref={menuRef}
            // stays mounted so it can animate: grows from the hamburger corner, links rise in one by one
            className={`group/menu absolute top-[calc(100%+8px)] left-0 flex min-w-[220px] origin-[24px_0] flex-col rounded-[28px] border border-sn-fg/8 bg-white/60 p-3 shadow-[inset_0_0_2px_1px_rgb(255_255_255/0.55),0_6px_24px_rgb(17_17_26/0.08),0_12px_40px_rgb(17_17_26/0.06)] backdrop-blur-lg backdrop-saturate-140 sm:hidden ${
              open
                ? "visible translate-y-0 scale-100 opacity-100 transition-[opacity,transform,visibility] duration-300 ease-spring"
                : "pointer-events-none invisible -translate-y-2 scale-[0.94] opacity-0 transition-[opacity,transform,visibility] duration-200 ease-standard"
            }`}
            data-open={open || undefined}
            id="mobile-menu"
          >
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="flex min-h-11 -translate-y-1.5 items-center p-3 text-[15px] text-sn-fg opacity-0 transition-[opacity,transform] duration-150 ease-standard group-data-open/menu:translate-y-0 group-data-open/menu:opacity-100 group-data-open/menu:duration-300 group-data-open/menu:ease-spring group-data-open/menu:nth-1:delay-60 group-data-open/menu:nth-2:delay-100 group-data-open/menu:nth-3:delay-140"
              >
                {l.label}
              </a>
            ))}
          </div>
        </div>
      </header>
    </>
  );
}
