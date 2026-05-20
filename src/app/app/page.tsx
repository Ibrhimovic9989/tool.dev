import { redirect } from "next/navigation";

// /app was an earlier route name — keep it as a redirect so old links still
// work. Everything happens in /builder now.
export default function AppRedirect() {
  redirect("/builder");
}
