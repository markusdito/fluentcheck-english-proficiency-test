import type { Metadata } from "next";
import { Newsreader, Public_Sans, Geist_Mono, Albert_Sans } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { AssessmentStartProvider } from "@/components/providers/AssessmentStartProvider";
import { REDUCE_MOTION_SCRIPT } from "@/lib/preferences";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

const albertSans = Albert_Sans({
  variable: "--font-albert-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SpeakNusa · English speaking assessment",
  description:
    "Record video responses to expert-crafted prompts and get band scores from a jury of language professionals.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${publicSans.variable} ${geistMono.variable} ${albertSans.variable} h-full antialiased`}
      // the inline script may add `reduce-motion` before hydration
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: REDUCE_MOTION_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <QueryProvider>
          <AssessmentStartProvider>
            {children}
            <Toaster />
          </AssessmentStartProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
