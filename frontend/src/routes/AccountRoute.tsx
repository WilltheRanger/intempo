import { useAuth } from "../hooks/useAuth";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Eyebrow } from "../components/ui/Eyebrow";

export function AccountRoute() {
  const { email, me, signOut } = useAuth();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Eyebrow>Account</Eyebrow>
        <h1 className="font-serif text-2xl text-ink">Your account</h1>
      </div>
      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-ink-mute">Email</span>
          <span className="text-[15px] text-ink">{email ?? "—"}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-ink-mute">Plan</span>
          <span className="text-[15px] capitalize text-ink">
            {me?.tier ?? "free"}
          </span>
        </div>
        <div>
          <Button variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}
