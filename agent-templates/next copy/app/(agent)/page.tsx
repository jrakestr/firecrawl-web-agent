import { redirect } from "next/navigation";

/** MLB predictions board is the public landing page. Agent UI lives at /agent. */
export default function HomePage() {
  redirect("/predictions");
}
