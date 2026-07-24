import { useParams } from "react-router-dom";

import { StubPage } from "../components/StubPage";

export function ResultRoute() {
  const { id } = useParams();
  return (
    <StubPage eyebrow="Tempo verdict" title="Your analysis">
      The verdict screen for analysis{" "}
      <span className="font-medium text-ink">{id}</span> — headline, annotated
      score, and trend — is built in Batch 7.
    </StubPage>
  );
}
