import Link from "next/link";
import type { InvitePerson } from "@/core/invitations";
import { UserAvatar } from "./UserAvatar";

const joined = (at: number) =>
  new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function Person({ person, note }: { person: InvitePerson; note: string }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <UserAvatar
        user={{ userId: person.userId, displayUsername: person.displayUsername, name: person.name, email: null, image: person.image }}
        size={28}
      />
      <span className="min-w-0 leading-tight">
        <span className="block truncate">
          {person.name}
          {person.displayUsername && <span className="text-muted-foreground"> @{person.displayUsername}</span>}
        </span>
        <span className="block text-xs text-muted-foreground">{note}</span>
      </span>
    </li>
  );
}

/** Who invited the user to Sidetrack, and who joined through their invites. */
export function InvitesPanel({ invitedBy, invited }: { invitedBy: InvitePerson | null; invited: InvitePerson[] }) {
  return (
    <section aria-labelledby="invites-heading" className="space-y-4 rounded-lg border border-border p-4">
      <h2 id="invites-heading" className="text-sm font-medium">
        Invites
      </h2>
      {invitedBy && (
        <div className="space-y-2">
          <h3 className="text-xs text-muted-foreground">Invited by</h3>
          <ul>
            <Person person={invitedBy} note={`You joined ${joined(invitedBy.joinedAt)}`} />
          </ul>
        </div>
      )}
      <div className="space-y-2">
        <h3 className="text-xs text-muted-foreground">You invited</h3>
        {invited.length ? (
          <ul className="space-y-2">
            {invited.map((p) => (
              <Person key={p.userId} person={p} note={`Joined ${joined(p.joinedAt)}`} />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
            Nobody yet.{" "}
            <Link href="/brief?open=invite-friend" className="font-medium text-foreground hover:underline">
              Invite a friend
            </Link>
            , or{" "}
            <Link href="/check-ins?open=share-day" className="font-medium text-foreground hover:underline">
              share your day
            </Link>{" "}
            with someone new.
          </p>
        )}
      </div>
    </section>
  );
}
