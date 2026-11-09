import { redirect } from "next/navigation";

// The site has no public face: the home page is the sign-in page.
export default function Home() {
  redirect("/login");
}
