import { Link } from "react-router-dom";
import { Plus, ArrowRight } from "lucide-react";

import { useAuth } from "../hooks/useAuth";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Eyebrow } from "../components/ui/Eyebrow";

export function HomeRoute() {
  const { email } = useAuth();
  const name = email ? email.split("@")[0] : "there";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2.5">
        <span className="h-6 w-[3px] rounded-sm bg-ink" aria-hidden />
        <h1 className="font-serif text-2xl italic text-ink">
          Good to see you, {name}
        </h1>
      </div>

      <Card className="flex flex-col gap-3">
        <Eyebrow>Start practicing</Eyebrow>
        <p className="text-[15px] text-ink-soft">
          Photograph a piece, play it through, and see exactly where you
          rushed or dragged.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link to="/scores/new">
            <Button trailingIcon={<Plus size={15} strokeWidth={1.5} />}>
              New recording
            </Button>
          </Link>
          <Link to="/scores">
            <Button variant="ghost">Your scores</Button>
          </Link>
        </div>
      </Card>

      <Card className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <Eyebrow>Recent sessions</Eyebrow>
          <p className="text-sm text-ink-mute">
            Nothing yet — your analyses will show up here.
          </p>
        </div>
        <Link
          to="/scores"
          className="text-amber-deep"
          aria-label="Go to scores"
        >
          <ArrowRight size={18} strokeWidth={1.5} />
        </Link>
      </Card>
    </div>
  );
}
