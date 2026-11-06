import { AuthShell, Alert } from "@/components/ui";
import { peekInvite } from "@/lib/invites";
import { AcceptForm } from "./accept-form";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await peekInvite(token);
  if (!invite) {
    return (
      <AuthShell title="This link has expired">
        <Alert tone="info">Invite links work once and expire after 72 hours. Ask an administrator for a new one.</Alert>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={`Welcome, ${invite.name.split(" ")[0]}`} subtitle={`Create a password for ${invite.email}.`}>
      <AcceptForm token={token} email={invite.email} />
    </AuthShell>
  );
}
