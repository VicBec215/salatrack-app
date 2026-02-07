import { redirect } from "next/navigation";

/**
 * Entry point:
 * We intentionally redirect to /test.
 * The real center resolution (last used slug, PWA quirks, etc.)
 * is handled client-side inside PageClientBoard to avoid breaking
 * auth/session behavior and mobile PWAs.
 */
export default function Home() {
  redirect("/test");
}