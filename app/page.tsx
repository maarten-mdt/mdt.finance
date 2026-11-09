// The site has no public face: the home page is the sign-in page itself. It's served directly
// (not a redirect) so Railway's health check on "/" gets a normal 200 response.
export { default } from "./login/page";
export const dynamic = "force-dynamic";
